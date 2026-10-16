import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Quote } from "./providers/yahoo.js";
let directory: string;
let db: (typeof import("./db.js"))["db"];
let alerts: typeof import("./alerts.js");
const monitors: Array<
  ReturnType<(typeof import("./alerts.js"))["createAlertMonitor"]>
> = [];
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "terminal-alerts-"));
  process.env.DATA_DIR = directory;
  db = (await import("./db.js")).db;
  alerts = await import("./alerts.js");
});
beforeEach(() => {
  db.exec("DELETE FROM price_alert_events; DELETE FROM price_alerts;");
});
afterEach(() => {
  monitors.splice(0).forEach((m) => m.stop());
  vi.restoreAllMocks();
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});
const quote = (price = 100, changePercent: number | null = 2): Quote =>
  ({
    symbol: "AAPL",
    price,
    changePercent,
    source: "test",
    currency: "USD",
    time: null,
  }) as Quote;
function create(condition = "PRICE_ABOVE", threshold = 100) {
  db.prepare(
    "INSERT INTO price_alerts (symbol,condition,threshold,label,created_at) VALUES ('AAPL',?,?,'Target',?)",
  ).run(condition, threshold, new Date().toISOString());
  return alerts.activeAlerts();
}
const history = () =>
  db.prepare("SELECT * FROM price_alert_events ORDER BY id").all() as any[];
describe("price alert evaluation", () => {
  it("includes threshold equality for both prices and daily percentage moves", () => {
    for (const [condition, threshold, sample] of [
      ["PRICE_ABOVE", 100, quote(100)],
      ["PRICE_BELOW", 100, quote(100)],
      ["CHANGE_ABOVE", 2, quote(100, 2)],
      ["CHANGE_BELOW", -5, quote(100, -5)],
    ] as const)
      expect(alerts.matchesAlert({ condition, threshold }, sample)).toBe(
        threshold,
      );
    expect(
      alerts.matchesAlert(
        { condition: "PRICE_ABOVE", threshold: 101 },
        quote(),
      ),
    ).toBeNull();
    expect(
      alerts.matchesAlert(
        { condition: "CHANGE_BELOW", threshold: -5 },
        quote(100, -4),
      ),
    ).toBeNull();
  });
  it("does not trigger on missing, zero or non-finite fields", () => {
    for (const sample of [
      quote(NaN),
      quote(0),
      { ...quote(), price: null },
      quote(100, null),
      quote(100, Infinity),
    ])
      expect(
        alerts.matchesAlert(
          { condition: "CHANGE_ABOVE", threshold: 1 },
          sample,
        ),
      ).toBeNull();
  });
  it("fires once atomically, persists its event and allows explicit rearming", () => {
    const snapshot = create();
    expect(alerts.evaluateAlerts(snapshot, [quote()])).toBe(1);
    expect(alerts.evaluateAlerts(snapshot, [quote()])).toBe(0);
    expect(alerts.activeAlerts()).toHaveLength(0);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      value: 100,
      price: 100,
      observed_at: null,
      source: "test",
    });
    db.prepare("UPDATE price_alerts SET armed=1,revision=revision+1").run();
    expect(alerts.evaluateAlerts(alerts.activeAlerts(), [quote()])).toBe(1);
    expect(history()).toHaveLength(2);
  });
  it("does not fire a stale rule snapshot after an edit, pause or delete", () => {
    const snapshot = create();
    db.prepare(
      "UPDATE price_alerts SET threshold=200,revision=revision+1",
    ).run();
    expect(alerts.evaluateAlerts(snapshot, [quote(300)])).toBe(0);
    const edited = alerts.activeAlerts();
    db.prepare("UPDATE price_alerts SET armed=0,revision=revision+1").run();
    expect(alerts.evaluateAlerts(edited, [quote(300)])).toBe(0);
    db.prepare("DELETE FROM price_alerts").run();
    expect(alerts.evaluateAlerts(snapshot, [quote(300)])).toBe(0);
    expect(history()).toHaveLength(0);
  });
  it("rolls back disarming if history cannot be written", () => {
    const snapshot = create();
    db.exec(
      "CREATE TRIGGER fail_alert_event BEFORE INSERT ON price_alert_events BEGIN SELECT RAISE(ABORT, 'event write failed'); END;",
    );
    try {
      expect(() => alerts.evaluateAlerts(snapshot, [quote()])).toThrow(
        "event write failed",
      );
      expect(alerts.activeAlerts()).toHaveLength(1);
      expect(history()).toHaveLength(0);
    } finally {
      db.exec("DROP TRIGGER fail_alert_event;");
    }
  });
  it("retains event snapshots when a rule is deleted", () => {
    const snapshot = create();
    alerts.evaluateAlerts(snapshot, [quote()]);
    db.prepare("DELETE FROM price_alerts").run();
    expect(history()[0]).toMatchObject({
      alert_id: null,
      symbol: "AAPL",
      threshold: 100,
    });
  });
});
describe("background alert monitor", () => {
  it("coalesces simultaneous checks and does not consume quote budget while idle", async () => {
    let resolve!: (quotes: Quote[]) => void;
    const load = vi.fn(
      () =>
        new Promise<Quote[]>((r) => {
          resolve = r;
        }),
    );
    const monitor = alerts.createAlertMonitor(load);
    monitors.push(monitor);
    await monitor.check();
    expect(load).not.toHaveBeenCalled();
    create();
    const first = monitor.check(),
      second = monitor.check();
    expect(first).toBe(second);
    await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(1);
    resolve([quote()]);
    expect((await first).triggered).toBe(1);
    expect(history()).toHaveLength(1);
  });
  it("keeps rules armed through failures and recovers on the next check", async () => {
    create();
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([quote()]);
    const monitor = alerts.createAlertMonitor(load);
    monitors.push(monitor);
    await monitor.check();
    expect(alerts.activeAlerts()).toHaveLength(1);
    expect(monitor.status().lastError).toContain("failed");
    expect((await monitor.check()).deferred).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    clock += 15001;
    await monitor.check();
    expect(history()).toHaveLength(1);
    expect(monitor.status().lastError).toBeNull();
  });
  it("reports missing daily-change fields without firing", async () => {
    create("CHANGE_ABOVE", 1);
    const monitor = alerts.createAlertMonitor(async () => [quote(100, null)]);
    monitors.push(monitor);
    await monitor.check();
    expect(history()).toHaveLength(0);
    expect(monitor.status().missingSymbols).toEqual(["AAPL"]);
  });
  it("loads persisted rules when started after a restart", async () => {
    create();
    const monitor = alerts.createAlertMonitor(async () => [quote()]);
    monitors.push(monitor);
    monitor.start();
    await vi.waitFor(() => expect(history()).toHaveLength(1));
    expect(monitor.status().running).toBe(true);
    monitor.stop();
    expect(monitor.status().running).toBe(false);
  });
});

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
beforeEach(async () => {
  await db.exec("DELETE FROM price_alert_events; DELETE FROM price_alerts;");
});
afterEach(() => {
  monitors.splice(0).forEach((m) => m.stop());
  vi.restoreAllMocks();
});
afterAll(async () => {
  await db.close();
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
async function create(condition = "PRICE_ABOVE", threshold = 100) {
  await db
    .prepare(
      "INSERT INTO price_alerts (symbol,condition,threshold,label,created_at) VALUES ('AAPL',?,?,'Target',?)",
    )
    .run(condition, threshold, new Date().toISOString());
  return await alerts.activeAlerts();
}
const history = async () =>
  (await db
    .prepare("SELECT * FROM price_alert_events ORDER BY id")
    .all()) as any[];
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
  it("fires once atomically, persists its event and allows explicit rearming", async () => {
    const snapshot = await create();
    expect(await alerts.evaluateAlerts(snapshot, [quote()])).toBe(1);
    expect(await alerts.evaluateAlerts(snapshot, [quote()])).toBe(0);
    expect(await alerts.activeAlerts()).toHaveLength(0);
    expect(await history()).toHaveLength(1);
    expect((await history())[0]).toMatchObject({
      value: 100,
      price: 100,
      observed_at: null,
      source: "test",
    });
    await db
      .prepare("UPDATE price_alerts SET armed=1,revision=revision+1")
      .run();
    expect(
      await alerts.evaluateAlerts(await alerts.activeAlerts(), [quote()]),
    ).toBe(1);
    expect(await history()).toHaveLength(2);
  });
  it("does not fire a stale rule snapshot after an edit, pause or delete", async () => {
    const snapshot = await create();
    await db
      .prepare("UPDATE price_alerts SET threshold=200,revision=revision+1")
      .run();
    expect(await alerts.evaluateAlerts(snapshot, [quote(300)])).toBe(0);
    const edited = await alerts.activeAlerts();
    await db
      .prepare("UPDATE price_alerts SET armed=0,revision=revision+1")
      .run();
    expect(await alerts.evaluateAlerts(edited, [quote(300)])).toBe(0);
    await db.prepare("DELETE FROM price_alerts").run();
    expect(await alerts.evaluateAlerts(snapshot, [quote(300)])).toBe(0);
    expect(await history()).toHaveLength(0);
  });
  it("rolls back disarming if history cannot be written", async () => {
    const snapshot = await create();
    await db.exec(
      "CREATE TRIGGER fail_alert_event BEFORE INSERT ON price_alert_events BEGIN SELECT RAISE(ABORT, 'event write failed'); END;",
    );
    try {
      await expect(alerts.evaluateAlerts(snapshot, [quote()])).rejects.toThrow(
        "event write failed",
      );
      expect(await alerts.activeAlerts()).toHaveLength(1);
      expect(await history()).toHaveLength(0);
    } finally {
      await db.exec("DROP TRIGGER fail_alert_event;");
    }
  });
  it("retains event snapshots when a rule is deleted", async () => {
    const snapshot = await create();
    await alerts.evaluateAlerts(snapshot, [quote()]);
    await db.prepare("DELETE FROM price_alerts").run();
    expect((await history())[0]).toMatchObject({
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
    await create();
    const first = monitor.check(),
      second = monitor.check();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledTimes(1);
    resolve([quote()]);
    expect((await first).triggered).toBe(1);
    expect(await history()).toHaveLength(1);
  });
  it("keeps rules armed through failures and recovers on the next check", async () => {
    await create();
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue([quote()]);
    const monitor = alerts.createAlertMonitor(load);
    monitors.push(monitor);
    await monitor.check();
    expect(await alerts.activeAlerts()).toHaveLength(1);
    expect(monitor.status().lastError).toContain("failed");
    expect((await monitor.check()).deferred).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    clock += 15001;
    await monitor.check();
    expect(await history()).toHaveLength(1);
    expect(monitor.status().lastError).toBeNull();
  });
  it("reports missing daily-change fields without firing", async () => {
    await create("CHANGE_ABOVE", 1);
    const monitor = alerts.createAlertMonitor(async () => [quote(100, null)]);
    monitors.push(monitor);
    await monitor.check();
    expect(await history()).toHaveLength(0);
    expect(monitor.status().missingSymbols).toEqual(["AAPL"]);
  });
  it("loads persisted rules when started after a restart", async () => {
    await create();
    const monitor = alerts.createAlertMonitor(async () => [quote()]);
    monitors.push(monitor);
    monitor.start();
    await vi.waitFor(async () => expect(await history()).toHaveLength(1));
    expect(monitor.status().running).toBe(true);
    monitor.stop();
    expect(monitor.status().running).toBe(false);
  });
});
it('repeats volume alerts only after cooldown, with one event across concurrent snapshots',async()=>{await create();await db.prepare('UPDATE price_alerts SET metric=?,threshold=?,repeat_seconds=?').run('volume',1000,60);let rules=await alerts.activeAlerts();const q={...quote(),volume:1000};const now=new Date('2026-01-01T00:00:00Z');expect((await Promise.all([alerts.evaluateAlerts(rules,[q],now),alerts.evaluateAlerts(rules,[q],now)])).reduce((a,b)=>a+b,0)).toBe(1);rules=await alerts.activeAlerts();expect(rules).toHaveLength(1);expect(await alerts.evaluateAlerts(rules,[q],new Date(now.getTime()+59000))).toBe(0);expect(await alerts.evaluateAlerts(rules,[q],new Date(now.getTime()+60000))).toBe(1);expect((await history()).every(r=>r.metric==='volume')).toBe(true);expect(alerts.alertValue({condition:'PRICE_ABOVE',metric:'volume'},{...q,volume:null})).toBeNull();});

it('records successful-evaluation gaps once without fabricating missed intraday triggers',async()=>{
 await db.exec("DELETE FROM research_records WHERE kind='alert-gap';");await create('PRICE_ABOVE',200);await db.prepare("UPDATE price_alerts SET last_checked_at='2026-10-20T10:00:00.000Z'").run();
 const rules=await alerts.activeAlerts();await alerts.evaluateAlerts(rules,[quote(100)],new Date('2026-10-20T12:00:00.000Z'));
 expect(await history()).toHaveLength(0);const gaps=await db.prepare("SELECT * FROM research_records WHERE kind='alert-gap'").all();expect(gaps).toHaveLength(1);expect(JSON.parse(gaps[0].payload)).toMatchObject({from:'2026-10-20T10:00:00.000Z',to:'2026-10-20T12:00:00.000Z'});
 await alerts.evaluateAlerts(await alerts.activeAlerts(),[quote(100)],new Date('2026-10-20T12:00:15.000Z'));expect(await db.prepare("SELECT * FROM research_records WHERE kind='alert-gap'").all()).toHaveLength(1);
});

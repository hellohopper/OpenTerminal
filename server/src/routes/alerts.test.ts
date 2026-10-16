import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { Request, Response } from "express";
let directory: string;
let db: (typeof import("../db.js"))["db"];
let router: (typeof import("./alerts.js"))["alertsRouter"];
let service: typeof import("../alerts.js");
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "terminal-alert-routes-"));
  process.env.DATA_DIR = directory;
  db = (await import("../db.js")).db;
  router = (await import("./alerts.js")).alertsRouter;
  service = await import("../alerts.js");
});
beforeEach(() => {
  db.exec("DELETE FROM price_alert_events; DELETE FROM price_alerts;");
});
afterAll(() => {
  service.alertMonitor.stop();
  db.close();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});
function call(
  method: string,
  path: string,
  body?: unknown,
  params = {},
  query = {},
) {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
  const layer = (router as any).stack.find(
    (l: any) => l.route?.path === path && l.route.methods[method],
  );
  layer.route.stack[0].handle(
    { body, params, query } as Request,
    res as unknown as Response,
  );
  return res;
}
const rule = {
  symbol: "aapl",
  condition: "PRICE_ABOVE",
  threshold: 100,
  label: " Target ",
};
const all = () => call("get", "/").json.mock.calls[0][0].alerts;
describe("price alert API", () => {
  it("creates, edits, pauses, rearms and deletes persisted rules", () => {
    const created = call("post", "/", rule);
    expect(created.status).toHaveBeenCalledWith(201);
    const id = created.json.mock.calls[0][0].id;
    expect(all()[0]).toMatchObject({
      symbol: "AAPL",
      label: "Target",
      armed: 1,
    });
    call("put", "/:id", { armed: false }, { id });
    expect(all()[0].armed).toBe(0);
    call(
      "put",
      "/:id",
      { condition: "CHANGE_BELOW", threshold: -5, armed: true },
      { id },
    );
    expect(all()[0]).toMatchObject({
      condition: "CHANGE_BELOW",
      threshold: -5,
      armed: 1,
      revision: 2,
    });
    call("delete", "/:id", undefined, { id });
    expect(all()).toEqual([]);
  });
  it("rejects invalid numeric thresholds, symbols and unknown edit fields", () => {
    for (const input of [
      { ...rule, threshold: 0 },
      { ...rule, threshold: Infinity },
      { ...rule, condition: "CHANGE_BELOW", threshold: 5 },
      { ...rule, condition: "CHANGE_BELOW", threshold: -101 },
      { ...rule, symbol: "../" },
    ])
      expect(call("post", "/", input).status).toHaveBeenCalledWith(400);
    const id = call("post", "/", rule).json.mock.calls[0][0].id;
    expect(
      call("put", "/:id", { revision: 100 }, { id }).status,
    ).toHaveBeenCalledWith(400);
    expect(
      call("put", "/:id", { armed: false }, { id: 999999 }).status,
    ).toHaveBeenCalledWith(404);
  });
  it("limits distinct enabled symbols on creation and rearming", () => {
    for (let i = 0; i < 20; i++)
      expect(
        call("post", "/", { ...rule, symbol: `S${i}` }).status,
      ).toHaveBeenCalledWith(201);
    expect(
      call("post", "/", { ...rule, symbol: "EXTRA" }).status,
    ).toHaveBeenCalledWith(409);
    const id = call("post", "/", { ...rule, symbol: "EXTRA", armed: false })
      .json.mock.calls[0][0].id;
    expect(
      call("put", "/:id", { armed: true }, { id }).status,
    ).toHaveBeenCalledWith(409);
    expect(all().find((r: any) => r.id === id).armed).toBe(0);
  });
  it("bounds the total number of saved rules, including paused rules", () => {
    for (let i = 0; i < 100; i++) call("post", "/", { ...rule, armed: false });
    expect(call("post", "/", rule).status).toHaveBeenCalledWith(409);
    expect(all()).toHaveLength(100);
  });
  it("delivers events by a monotonic cursor and preserves history after deletion", () => {
    const id = call("post", "/", rule).json.mock.calls[0][0].id;
    service.evaluateAlerts(service.activeAlerts(), [
      {
        symbol: "AAPL",
        price: 100,
        changePercent: 1,
        time: null,
        currency: "USD",
        source: "test",
      } as any,
    ]);
    const first = call("get", "/events", undefined, {}, { after: "0" }).json
      .mock.calls[0][0];
    expect(first.events).toHaveLength(1);
    const next = call(
      "get",
      "/events",
      undefined,
      {},
      { after: String(first.nextCursor) },
    ).json.mock.calls[0][0];
    expect(next.events).toEqual([]);
    expect(next.nextCursor).toBe(first.nextCursor);
    call("delete", "/:id", undefined, { id });
    expect(
      call("get", "/history").json.mock.calls[0][0].events[0],
    ).toMatchObject({ alert_id: null, symbol: "AAPL", threshold: 100 });
  });
  it("recovers a browser cursor after a database reset and validates cursor input", () => {
    expect(
      call("get", "/events", undefined, {}, { after: "999" }).json.mock
        .calls[0][0],
    ).toEqual({ events: [], nextCursor: 0, reset: true });
    expect(
      call("get", "/events", undefined, {}, { after: "-1" }).status,
    ).toHaveBeenCalledWith(400);
    expect(
      call("get", "/history", undefined, {}, { before: "no" }).status,
    ).toHaveBeenCalledWith(400);
  });
});

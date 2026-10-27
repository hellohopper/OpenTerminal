import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
let router: any, db: (typeof import("../db.js"))["db"], directory: string;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "terminal-alert-routes-"));
  process.env.DATA_DIR = directory;
  router = (await import("./alerts.js")).alertsRouter;
  db = (await import("../db.js")).db;
});
beforeEach(async () => { await db.exec("DELETE FROM price_alert_events; DELETE FROM price_alerts;"); });
afterAll(async () => { await db.close(); rmSync(directory, { recursive: true, force: true }); });
async function call(method: string, path: string, request: any = {}) {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn() };
  await router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method])
    .route.stack[0].handle({ params: {}, query: {}, ...request }, res);
  return res;
}
const input = { symbol: "AAPL", condition: "PRICE_ABOVE", threshold: 1000, label: "Phone target", armed: true };
async function create() {
  const response = await call("post", "/", { body: input });
  expect(response.status).toHaveBeenCalledWith(201);
  return (await db.prepare("SELECT * FROM price_alerts WHERE id=?").get(response.json.mock.calls[0][0].id))!;
}
const version = (row: any) => ({ revision: String(row.revision), generation: row.generation });
describe("version-checked alert mutations", () => {
  it("pauses and rearms a reviewed rule, incrementing each revision once", async () => {
    const row = await create();
    const paused = await call("put", "/:id", { params: { id: row.id }, query: version(row), body: { armed: false } });
    expect(paused.json).toHaveBeenCalledWith({ id: row.id });
    const current = (await db.prepare("SELECT * FROM price_alerts WHERE id=?").get(row.id))!;
    expect(current).toMatchObject({ armed: 0, revision: row.revision + 1, generation: row.generation, threshold: row.threshold });
    const rearmed = await call("put", "/:id", { params: { id: row.id }, query: version(current), body: { armed: true } });
    expect(rearmed.json).toHaveBeenCalledWith({ id: row.id });
    expect(await db.prepare("SELECT armed,revision FROM price_alerts WHERE id=?").get(row.id)).toEqual({ armed: 1, revision: row.revision + 2 });
  });
  it("rejects a stale pause or deletion without changing a newer web edit", async () => {
    const row = await create();
    await call("put", "/:id", { params: { id: row.id }, body: { threshold: 1200, label: "Web edit" } });
    for (const method of ["put", "delete"]) {
      const result = await call(method, "/:id", { params: { id: row.id }, query: version(row), body: { armed: false } });
      expect(result.status).toHaveBeenCalledWith(409);
      expect(result.json).toHaveBeenCalledWith({ error: expect.stringContaining("Refresh alerts") });
    }
    expect(await db.prepare("SELECT * FROM price_alerts WHERE id=?").get(row.id)).toMatchObject({ threshold: 1200, label: "Web edit", armed: 1, revision: row.revision + 1 });
  });
  it("rejects an old generation even if restoration keeps the same ID and revision", async () => {
    const row = await create();
    await db.prepare("UPDATE price_alerts SET generation=? WHERE id=?").run("restored", row.id);
    for (const method of ["put", "delete"]) {
      expect((await call(method, "/:id", { params: { id: row.id }, query: version(row), body: { armed: false } })).status).toHaveBeenCalledWith(409);
    }
    const current = (await db.prepare("SELECT * FROM price_alerts WHERE id=?").get(row.id))!;
    expect(current).toMatchObject({ generation: "restored", armed: 1, revision: row.revision });
    expect((await call("delete", "/:id", { params: { id: row.id }, query: version(current) })).status).toHaveBeenCalledWith(204);
  });
  it("accepts at most one concurrent write from one reviewed revision", async () => {
    const row = await create();
    const results = await Promise.all([false, true].map(armed => call("put", "/:id", { params: { id: row.id }, query: version(row), body: { armed } })));
    expect(results.filter(result => result.status.mock.calls[0]?.[0] === 409)).toHaveLength(1);
    expect(results.filter(result => result.json.mock.calls[0]?.[0]?.id === row.id)).toHaveLength(1);
    expect((await db.prepare("SELECT revision FROM price_alerts WHERE id=?").get(row.id))!.revision).toBe(row.revision + 1);
  });
  it("validates both version fields before changing or deleting anything", async () => {
    const row = await create();
    for (const query of [
      { revision: "1" }, { generation: row.generation }, { revision: "", generation: "g" },
      { revision: "-1", generation: "g" }, { revision: "1.5", generation: "g" },
      { revision: "9007199254740991", generation: "g" }, { revision: "1", generation: "" },
      { revision: "1", generation: "g".repeat(101) }, { revision: ["1", "2"], generation: "g" },
      { revision: { value: "1" }, generation: "g" }, { revision: "1", generation: ["g"] },
    ]) {
      for (const method of ["put", "delete"])
        expect((await call(method, "/:id", { params: { id: row.id }, query, body: { armed: false } })).status).toHaveBeenCalledWith(400);
    }
    expect(await db.prepare("SELECT * FROM price_alerts WHERE id=?").get(row.id)).toEqual(row);
  });
  it("makes repeat deletion harmless and reports a missing rule on update", async () => {
    const row = await create();
    for (let attempt = 0; attempt < 2; attempt++)
      expect((await call("delete", "/:id", { params: { id: row.id }, query: version(row) })).status).toHaveBeenCalledWith(204);
    expect((await call("put", "/:id", { params: { id: row.id }, query: version(row), body: { armed: true } })).status).toHaveBeenCalledWith(404);
    expect(await db.prepare("SELECT id FROM price_alerts WHERE id=?").get(row.id)).toBeUndefined();
  });
  it("preserves unversioned web edits and deletion", async () => {
    const row = await create();
    expect((await call("put", "/:id", { params: { id: row.id }, body: { armed: false } })).json).toHaveBeenCalledWith({ id: row.id });
    expect((await call("delete", "/:id", { params: { id: row.id } })).status).toHaveBeenCalledWith(204);
  });
});

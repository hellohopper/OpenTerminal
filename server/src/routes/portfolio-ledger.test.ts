import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
let router: any, db: any, directory: string;
beforeAll(async () => { directory = mkdtempSync(join(tmpdir(), "terminal-ledger-")); process.env.DATA_DIR = directory; router = (await import("./portfolio.js")).portfolioRouter; db = (await import("../db.js")).db; });
afterAll(() => { db.close(); rmSync(directory, { recursive: true, force: true }); delete process.env.DATA_DIR; });
function call(method: string, path: string, body?: unknown, params = {}) { const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn() }; router.stack.find((l: any) => l.route?.path === path && l.route.methods[method]).route.stack[0].handle({ params: { id: "1", ...params }, body, query: {} }, res); return res; }
const trade = { symbol: "AAPL", side: "BUY", quantity: 10, price: 100, executed_at: "2026-01-01T00:00:00Z" };
describe("portfolio ledger mutations", () => {
  it("rolls back oversells and deletion of a buy needed by a later sale", () => {
    call("post", "/:id/transactions", trade);
    expect(call("post", "/:id/transactions", { ...trade, side: "SELL", quantity: 11, executed_at: "2026-01-02T00:00:00Z" }).status).toHaveBeenCalledWith(400);
    expect(db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n).toBe(1);
    call("post", "/:id/transactions", { ...trade, side: "SELL", quantity: 5, executed_at: "2026-01-02T00:00:00Z" });
    expect(call("delete", "/:id/transactions/:txId", undefined, { txId: "1" }).status).toHaveBeenCalledWith(409);
    expect(db.prepare("SELECT COUNT(*) AS n FROM transactions").get().n).toBe(2);
  });
  it("applies split events to positions and removes them transactionally", () => {
    const result = call("post", "/:id/events", { kind: "SPLIT", amount: 2, symbol: "AAPL", executed_at: "2026-01-03T00:00:00Z" });
    expect(result.status).toHaveBeenCalledWith(201);
    expect(call("get", "/:id/positions").json.mock.calls[0][0][0].quantity).toBe(10);
    call("delete", "/:id/events/:eventId", undefined, { eventId: String(result.json.mock.calls[0][0].id) });
    expect(call("get", "/:id/positions").json.mock.calls[0][0][0].quantity).toBe(5);
  });
});

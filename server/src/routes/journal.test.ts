import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
let router: any, db: any, schema: any, directory: string;
beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "terminal-journal-"));
  process.env.DATA_DIR = directory;
  const module = await import("./journal.js");
  router = module.journalRouter;
  schema = module.journalSchema;
  db = (await import("../db.js")).db;
});
afterAll(async () => {
  await db.close();
  rmSync(directory, { recursive: true, force: true });
  delete process.env.DATA_DIR;
});
async function call(method: string, path: string, req: any = {}) {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn(),
  };
  await router.stack
    .find((l: any) => l.route?.path === path && l.route.methods[method])
    .route.stack[0].handle({ params: {}, query: {}, ...req }, res);
  return res;
}
const note = {
  symbol: "AAPL",
  title: "Cash flow thesis",
  body: "Evidence and risks",
  kind: "research",
};
describe("journal persistence", () => {
  it("creates, retrieves, edits, filters and deletes entries in SQLite", async () => {
    const created = await call("post", "/", { body: note });
    expect(created.status).toHaveBeenCalledWith(201);
    const id = created.json.mock.calls[0][0].id;
    expect(
      (await call("get", "/:id", { params: { id } })).json,
    ).toHaveBeenCalledWith(expect.objectContaining(note));
    await call("put", "/:id", {
      params: { id },
      body: { ...note, version: created.json.mock.calls[0][0].version, title: "Updated", kind: "trade" },
    });
    expect(
      (await call("get", "/", { query: { symbol: "AAPL", kind: "research" } }))
        .json.mock.calls[0][0].entries,
    ).toHaveLength(0);
    expect(
      (await call("get", "/", { query: { kind: "trade" } })).json.mock
        .calls[0][0].entries[0].title,
    ).toBe("Updated");
    await call("delete", "/:id", { params: { id } });
    expect(
      (await call("get", "/:id", { params: { id } })).status,
    ).toHaveBeenCalledWith(404);
  });
  it("rejects executable image types, malformed image content and empty titles", async () => {
    for (const image of [
      "data:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,SGVsbG8=",
    ])
      expect(schema.safeParse({ ...note, image }).success).toBe(false);
    expect(
      (await call("post", "/", { body: { ...note, title: " " } })).status,
    ).toHaveBeenCalledWith(400);
  });
  it("lists attachment metadata without returning full images", async () => {
    const image = "data:image/png;base64,iVBORw0KGgo=";
    await call("post", "/", { body: { ...note, image } });
    const entry = (await call("get", "/")).json.mock.calls[0][0].entries[0];
    expect(entry.hasImage).toBe(1);
    expect(entry.image).toBeUndefined();
  });
  it("rejects stale and unversioned edits without overwriting a newer note", async () => {
    const created = (await call("post", "/", { body: note })).json.mock.calls[0][0];
    const first = await call("put", "/:id", { params: { id: created.id }, body: { ...note, version: created.version, body: "Device A edits" } });
    const fresh = first.json.mock.calls[0][0];
    expect(fresh.version).not.toBe(created.version);
    const stale = await call("put", "/:id", { params: { id: created.id }, body: { ...note, version: created.version, title: "Device B title" } });
    expect(stale.status).toHaveBeenCalledWith(409);
    expect((await call("put", "/:id", { params: { id: created.id }, body: note })).status).toHaveBeenCalledWith(409);
    const saved = (await call("get", "/:id", { params: { id: created.id } })).json.mock.calls[0][0];
    expect(saved).toMatchObject({ body: "Device A edits", version: fresh.version, title: note.title });
    const reviewed = await call("put", "/:id", { params: { id: created.id }, body: { ...saved, body: "Reviewed merge" } });
    expect(reviewed.json.mock.calls[0][0].version).not.toBe(fresh.version);
    expect((await call("put", "/:id", { params: { id: 999999 }, body: { ...note, version: fresh.version } })).status).toHaveBeenCalledWith(404);
  });
  it("pages matching notes beyond fifty without duplicates when new notes arrive", async () => {
    for (let index = 0; index < 60; index++)
      await call("post", "/", { body: { ...note, symbol: "JPAGE", title: `Paged match ${index}` } });
    const first = (await call("get", "/", { query: { symbol: "JPAGE", kind: "research", q: "paged MATCH" } })).json.mock.calls[0][0];
    expect(first.entries).toHaveLength(50); expect(first.nextCursor).toBe(first.entries[49].id);
    const inserted = (await call("post", "/", { body: { ...note, symbol: "JPAGE", title: "Paged match newest" } })).json.mock.calls[0][0];
    const second = (await call("get", "/", { query: { symbol: "JPAGE", kind: "research", q: "paged MATCH", before: String(first.nextCursor) } })).json.mock.calls[0][0];
    expect(second.entries).toHaveLength(10); expect(second.nextCursor).toBeNull();
    const ids = [...first.entries, ...second.entries].map(row => row.id);
    expect(new Set(ids).size).toBe(60); expect(ids).not.toContain(inserted.id);
    expect(ids).toEqual([...ids].sort((a, b) => b - a));
  });
  it("searches titles and full bodies beyond the first page with literal wildcards and symbol/kind filters", async () => {
    const old = { ...note, symbol: "JSEARCH", title: "现金流 CashFlow", body: "Yield 100% growth_! +20%" };
    const match = (await call("post", "/", { body: old })).json.mock.calls[0][0];
    for (let index = 0; index < 55; index++) await call("post", "/", { body: { ...note, symbol: "JSEARCH", title: `Unrelated ${index}` } });
    await call("post", "/", { body: { ...old, body: "Yield 100X growthZ!" } });
    await call("post", "/", { body: { ...old, kind: "trade" } });
    await call("post", "/", { body: { ...old, symbol: "OTHER" } });
    const recent = (await call("get", "/", { query: { symbol: "JSEARCH", kind: "research" } })).json.mock.calls[0][0];
    expect(recent.entries.map(row => row.id)).not.toContain(match.id);
    for (const q of ["现金流 100% growth_!", "cashflow YIELD 100%", "现金流 +20%"] ) {
      const found = (await call("get", "/", { query: { symbol: "JSEARCH", kind: "research", q } })).json.mock.calls[0][0];
      expect(found.entries.map(row => row.id)).toEqual([match.id]); expect(found.nextCursor).toBeNull();
    }
  });
  it("bounds search inputs and keeps cursor validation for search requests", async () => {
    for (const q of ["x".repeat(201), "a b c d e f g h i", ["a", "b"]])
      expect((await call("get", "/", { query: { q } })).status).toHaveBeenCalledWith(400);
    expect((await call("get", "/", { query: { q: "cash", before: "0" } })).status).toHaveBeenCalledWith(400);
    await call("post", "/", { body: { ...note, symbol: "JBOUND" } });
    const blank = await call("get", "/", { query: { q: "   ", symbol: "JBOUND" } });
    expect(blank.json.mock.calls[0][0].entries).toHaveLength(1);
  });
});

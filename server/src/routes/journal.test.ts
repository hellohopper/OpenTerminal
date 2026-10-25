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
});

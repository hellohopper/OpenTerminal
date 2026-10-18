import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AppDatabase } from "./storage/database.js";
const snapshot = z.object({
  format: z.literal("openterminal-device"),
  version: z.literal(1),
  workspace: z.object({
    workspaces: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          name: z.string().min(1).max(64),
          activeSymbol: z.string().max(20),
          watchlist: z.array(z.string().max(20)).max(200),
          widgets: z
            .array(
              z.object({
                id: z.string().max(100),
                type: z.string().max(40),
                linked: z.boolean(),
                symbol: z.string().max(20).optional(),
              }),
            )
            .max(50),
          layout: z
            .array(
              z.object({
                i: z.string().max(100),
                x: z.number().int().min(0).max(12),
                y: z.number().int().min(0).max(10000),
                w: z.number().int().min(1).max(12),
                h: z.number().int().min(1).max(100),
              }),
            )
            .max(50),
        }),
      )
      .min(1)
      .max(20),
    activeWorkspaceId: z.string().max(100),
  }),
  preferences: z.object({
    groups: z.array(z.unknown()).max(20),
    screeners: z.array(z.unknown()).max(20),
  }),
  drawings: z
    .record(z.string().max(240), z.string().max(65536))
    .refine(
      (v) =>
        Object.keys(v).length <= 500 &&
        Object.keys(v).every((k) => k.startsWith("openterminal-drawings-v1:")),
    ),
});
export async function readSync(db: AppDatabase) {
  const row = await db
    .prepare("SELECT payload,version,updated_at FROM workspace_sync WHERE id=1")
    .get();
  return row
    ? {
        payload: JSON.parse(row.payload),
        version: row.version,
        updatedAt: row.updated_at,
      }
    : null;
}
export const SYNC_HISTORY_LIMIT = 10;
function validatePayload(payload: unknown) {
  const parsed = snapshot.parse(payload);
  if (Buffer.byteLength(JSON.stringify(parsed)) > 2 * 1024 * 1024)
    throw new Error("Device snapshot exceeds 2 MB.");
  return parsed;
}
function syncError(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}
// Caller holds the database write transaction, including the optimistic check.
async function commitSync(db: AppDatabase, payload: unknown, baseVersion: unknown) {
  const parsed = validatePayload(payload);
  if (baseVersion !== null && typeof baseVersion !== "string")
    throw new Error("Invalid base version.");
  const current = await readSync(db);
  if ((current?.version ?? null) !== baseVersion)
    syncError("Sync conflict: preview the latest server snapshot before uploading.", 409);
  if (current) await db.prepare(
    "INSERT INTO workspace_sync_history (payload,version,updated_at) VALUES (?,?,?) ON CONFLICT(version) DO NOTHING",
  ).run(JSON.stringify(current.payload), current.version, current.updatedAt);
  const version = randomUUID(), at = new Date().toISOString();
  await db.prepare(
    "INSERT INTO workspace_sync (id,payload,version,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at",
  ).run(JSON.stringify(parsed), version, at);
  await db.prepare(
    "INSERT INTO workspace_sync_history (payload,version,updated_at) VALUES (?,?,?)",
  ).run(JSON.stringify(parsed), version, at);
  await db.prepare(
    "DELETE FROM workspace_sync_history WHERE id NOT IN (SELECT id FROM workspace_sync_history ORDER BY id DESC LIMIT ?)",
  ).run(SYNC_HISTORY_LIMIT);
  return { version, updatedAt: at };
}
export async function writeSync(db: AppDatabase, payload: unknown, baseVersion: unknown) {
  return db.transaction(() => commitSync(db, payload, baseVersion))();
}
export async function listSyncHistory(db: AppDatabase) {
  // Do not transfer up to 20 MB of payloads just to list versions.
  const rows = await db.prepare(
    "SELECT version,updated_at FROM workspace_sync_history ORDER BY id DESC LIMIT ?",
  ).all(SYNC_HISTORY_LIMIT);
  return rows.map(row => ({ version: row.version, updatedAt: row.updated_at }));
}
export async function readSyncVersion(db: AppDatabase, version: string) {
  const row = await db.prepare(
    "SELECT payload,version,updated_at FROM workspace_sync_history WHERE version=?",
  ).get(version);
  return row ? { payload: JSON.parse(row.payload), version: row.version, updatedAt: row.updated_at } : null;
}
export async function restoreSyncVersion(db: AppDatabase, version: string, baseVersion: unknown) {
  return db.transaction(async () => {
    const saved = await readSyncVersion(db, version);
    if (!saved) syncError("Sync version no longer exists.", 404);
    // A restore is a new revision. Devices with an old revision cannot overwrite it.
    return commitSync(db, saved.payload, baseVersion);
  })();
}

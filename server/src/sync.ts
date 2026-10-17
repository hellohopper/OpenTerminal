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
export async function writeSync(
  db: AppDatabase,
  payload: unknown,
  baseVersion: unknown,
) {
  const parsed = snapshot.parse(payload);
  if (Buffer.byteLength(JSON.stringify(parsed)) > 2 * 1024 * 1024)
    throw new Error("Device snapshot exceeds 2 MB.");
  if (baseVersion !== null && typeof baseVersion !== "string")
    throw new Error("Invalid base version.");
  return db.transaction(async () => {
    const current = await readSync(db);
    if ((current?.version ?? null) !== baseVersion) {
      const error = new Error(
        "Sync conflict: download the latest server snapshot before uploading.",
      );
      Object.assign(error, { status: 409 });
      throw error;
    }
    const version = randomUUID(),
      at = new Date().toISOString();
    await db
      .prepare(
        "INSERT INTO workspace_sync (id,payload,version,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,version=excluded.version,updated_at=excluded.updated_at",
      )
      .run(JSON.stringify(parsed), version, at);
    return { version, updatedAt: at };
  })();
}

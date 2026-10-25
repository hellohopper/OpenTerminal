import { createHash, randomUUID } from "node:crypto";
import { AppDatabase, type Row } from "./database.js";
import { TABLE_COLUMNS } from "./import-sqlite.js";
import { SCHEMA_VERSION } from "./migrations.js";
const checksum = (data: unknown) =>
  createHash("sha256").update(JSON.stringify(data)).digest("hex");
const LIMIT = 32 * 1024 * 1024;
export async function createBackup(db: AppDatabase) {
  return db.transaction(async () => {
    const data: Record<string, Row[]> = {};
    let bytes = 0,
      count = 0;
    for (const table of Object.keys(TABLE_COLUMNS)) {
      data[table] = [];
      let cursor = 0;
      while (true) {
        const rows = await db
          .prepare(`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT 5`)
          .all(cursor);
        if (!rows.length) break;
        bytes += Buffer.byteLength(JSON.stringify(rows));
        count += rows.length;
        if (bytes > LIMIT || count > 50000)
          throw new Error(
            "Web backup limit is 32 MB / 50000 rows. Use a native database backup for larger data.",
          );
        data[table].push(...rows);
        cursor = rows.at(-1)!.id;
      }
    }
    const result = {
      format: "openterminal-backup",
      version: 1,
      schemaVersion: SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      checksum: checksum(data),
      data,
    };
    if (Buffer.byteLength(JSON.stringify(result)) > LIMIT)
      throw new Error("Backup exceeds 32 MB.");
    return result;
  })();
}
export async function restoreBackup(db: AppDatabase, input: unknown) {
  const backup = input as ReturnType<typeof JSON.parse>;
  if (
    !backup ||
    backup.format !== "openterminal-backup" ||
    backup.version !== 1 ||
    !Number.isInteger(backup.schemaVersion) ||
    backup.schemaVersion < 1 ||
    backup.schemaVersion > SCHEMA_VERSION ||
    !backup.data ||
    Array.isArray(backup.data) ||
    checksum(backup.data) !== backup.checksum
  )
    throw new Error("Invalid or incompatible backup/checksum.");
  if (Buffer.byteLength(JSON.stringify(input)) > LIMIT)
    throw new Error("Backup exceeds 32 MB.");
  const tables = Object.keys(TABLE_COLUMNS),
    data: Record<string, Row[]> = {};
  let count = 0;
  if (Object.keys(backup.data).some((k) => !tables.includes(k)))
    throw new Error("Backup contains unknown tables.");
  for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
    const rows = backup.data[table] ?? [];
    if (!Array.isArray(rows)) throw new Error("Invalid table rows.");
    count += rows.length;
    if (count > 50000) throw new Error("Backup exceeds 50000 rows.");
    const ids = new Set<number>();
    for (const row of rows) {
      if (
        !row ||
        Array.isArray(row) ||
        !Number.isSafeInteger(row.id) ||
        row.id < 1 ||
        ids.has(row.id)
      )
        throw new Error("Invalid or duplicate row ID.");
      ids.add(row.id);
      for (const [key, value] of Object.entries(row))
        if (
          !columns.includes(key as never) ||
          !(
            value === null ||
            typeof value === "string" ||
            (typeof value === "number" && Number.isFinite(value))
          )
        )
          throw new Error("Unsupported backup column/value.");
    }
    data[table] = rows;
  }
  return db.transaction(async () => {
    const maxima: Record<string, number> = {};
    for (const table of tables)
      maxima[table] = (await db
        .prepare(`SELECT COALESCE(MAX(id),0) AS id FROM ${table}`)
        .get())!.id;
    for (const table of [...tables].reverse())
      await db.prepare(`DELETE FROM ${table}`).run();
    const counts: Record<string, number> = {};
    for (const table of tables) {
      for (const original of data[table]) {
        const row =
          table === "price_alerts" || table === "briefing_schedules"
            ? { ...original, generation: randomUUID() }
            : table === "briefing_runs"
              ? {
                  ...original,
                  status:
                    original.status === "running" ? "failed" : original.status,
                  token: randomUUID(),
                }
              : table === "journal_entries" ? { ...original, version: randomUUID() }
              : table === "workspace_sync"
                ? { ...original, version: randomUUID() }
                : table === "research_records" ? {...original,version:Date.now()} : original;
        const columns = Object.keys(row);
        await db
          .prepare(
            `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
          )
          .run(...columns.map((c) => row[c]));
      }
      counts[table] = data[table].length;
    }
    if (db.kind === "postgres")
      for (const table of tables)
        await db.exec(
          `SELECT setval(pg_get_serial_sequence('${table}','id'),GREATEST(COALESCE(pg_sequence_last_value(pg_get_serial_sequence('${table}','id')::regclass),1),${maxima[table]},COALESCE((SELECT MAX(id) FROM ${table}),1)),true)`,
        );
    return counts;
  })();
}

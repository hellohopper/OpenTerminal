import SQLite from "better-sqlite3";
import { AppDatabase, type Row } from "./database.js";
export const TABLE_COLUMNS = {
  research_records: ["id", "kind", "record_key", "payload", "version", "updated_at"],
  briefing_schedules: [
    "id",
    "symbols",
    "mode",
    "local_time",
    "timezone",
    "weekdays",
    "enabled",
    "generation",
    "last_error",
    "last_generated_at",
  ],
  briefing_runs: [
    "id",
    "schedule_id",
    "run_key",
    "status",
    "attempts",
    "claimed_at",
    "token",
  ],
  workspace_sync_history: ["id", "payload", "version", "updated_at"],
  workspace_sync: ["id", "payload", "version", "updated_at"],
  portfolios: ["id", "name", "created_at"],
  transactions: [
    "id",
    "portfolio_id",
    "symbol",
    "side",
    "quantity",
    "price",
    "executed_at",
  ],
  portfolio_events: [
    "id",
    "portfolio_id",
    "kind",
    "symbol",
    "amount",
    "executed_at",
  ],
  journal_entries: [
    "id",
    "symbol",
    "title",
    "body",
    "kind",
    "image",
    "created_at",
    "updated_at",
    "version",
  ],
  briefings: ["id", "generated_at", "content"],
  price_alerts: [
    "id",
    "symbol",
    "condition",
    "threshold",
    "label",
    "armed",
    "revision",
    "generation",
    "metric",
    "repeat_seconds",
    "created_at",
    "last_checked_at",
    "last_value",
    "last_triggered_at",
  ],
  price_alert_events: [
    "metric",
    "id",
    "alert_id",
    "symbol",
    "condition",
    "threshold",
    "label",
    "value",
    "price",
    "currency",
    "source",
    "observed_at",
    "created_at",
  ],
} as const;
/** Read one consistent source snapshot; insert only into empty target tables. */
export async function importSqlite(filename: string, target: AppDatabase) {
  if (target.kind !== "postgres")
    throw new Error("Import requires a PostgreSQL destination.");
  const source = new SQLite(filename, { readonly: true, fileMustExist: true });
  let snapshot: Record<string, Row[]>;
  try {
    snapshot = source.transaction(() => {
      if ((source.pragma("foreign_key_check") as unknown[]).length)
        throw new Error("Source SQLite foreign keys are inconsistent.");
      const result: Record<string, Row[]> = {};
      for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
        const exists = source
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table);
        const present = exists
          ? new Set(
              (
                source.prepare(`PRAGMA table_info(${table})`).all() as {
                  name: string;
                }[]
              ).map((c) => c.name),
            )
          : new Set<string>();
        result[table] = exists
          ? (source
              .prepare(
                `SELECT ${columns
                  .filter((c) => present.has(c))
                  .map((c) => `"${c}"`)
                  .join(",")} FROM ${table} ORDER BY id`,
              )
              .all() as Row[])
          : [];
        for (const row of result[table])
          for (const [key, value] of Object.entries(row))
            if (
              typeof value === "number" &&
              (!Number.isFinite(value) ||
                ((key === "id" || key.endsWith("_id")) &&
                  !Number.isSafeInteger(value)))
            )
              throw new Error("Source has unsupported numeric values.");
      }
      return result;
    })();
  } finally {
    source.close();
  }
  return target.transaction(async () => {
    for (const table of Object.keys(TABLE_COLUMNS))
      if (
        (await target.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get())!
          .n !== 0
      )
        throw new Error(
          "Destination is not empty. Import was cancelled without changing rows.",
        );
    const counts: Record<string, number> = {};
    for (const [table, columns] of Object.entries(TABLE_COLUMNS)) {
      const insertColumns = columns.filter(
        (c) =>
          snapshot[table].length === 0 || Object.hasOwn(snapshot[table][0], c),
      );
      const sql = `INSERT INTO ${table} (${insertColumns.map((c) => `"${c}"`).join(",")}) VALUES (${insertColumns.map(() => "?").join(",")})`;
      for (const row of snapshot[table])
        await target.prepare(sql).run(...insertColumns.map((c) => row[c]));
      counts[table] = snapshot[table].length;
    }
    // Explicit IDs do not advance PostgreSQL sequences. Reset before normal inserts.
    for (const table of Object.keys(TABLE_COLUMNS))
      await target.exec(
        `SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}),1), EXISTS(SELECT 1 FROM ${table}))`,
      );
    return counts;
  })();
}

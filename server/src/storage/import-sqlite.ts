import SQLite from "better-sqlite3";
import { AppDatabase, type Row } from "./database.js";
export const TABLE_COLUMNS = {
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
    "created_at",
    "last_checked_at",
    "last_value",
    "last_triggered_at",
  ],
  price_alert_events: [
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
        result[table] = exists
          ? (source
              .prepare(
                `SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM ${table} ORDER BY id`,
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
      const sql = `INSERT INTO ${table} (${columns.map((c) => `"${c}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`;
      for (const row of snapshot[table])
        await target.prepare(sql).run(...columns.map((c) => row[c]));
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

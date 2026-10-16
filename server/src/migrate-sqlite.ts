import { parseArgs } from "node:util";
import { AppDatabase } from "./storage/database.js";
import { importSqlite } from "./storage/import-sqlite.js";
async function main() {
  const { values } = parseArgs({
    options: { sqlite: { type: "string" } },
    strict: true,
  });
  if (!values.sqlite || !process.env.DATABASE_URL)
    throw new Error(
      "Usage: DATABASE_URL=postgresql://... npm run db:migrate -w server -- --sqlite /path/to/terminal.db",
    );
  const target = await AppDatabase.open({
    url: process.env.DATABASE_URL,
    seed: false,
  });
  try {
    console.log(
      JSON.stringify({ imported: await importSqlite(values.sqlite, target) }),
    );
  } finally {
    await target.close();
  }
}
main().catch(() => {
  console.error(
    "SQLite import failed. Check the source file, PostgreSQL connection, and that the destination is empty. Existing rows were not overwritten.",
  );
  process.exitCode = 1;
});

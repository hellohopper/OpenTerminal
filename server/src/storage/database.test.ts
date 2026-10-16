import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase, postgresSQL } from "./database.js";
const opened: AppDatabase[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});
async function open() {
  const db = await AppDatabase.open();
  opened.push(db);
  return db;
}
describe("database adapter", () => {
  it("keeps SQLite queries outside a suspended transaction from entering it", async () => {
    const db = await open();
    let resume!: () => void;
    const barrier = new Promise<void>((r) => (resume = r));
    let entered!: () => void;
    const ready = new Promise<void>((r) => (entered = r));
    const failed = db.transaction(async () => {
      await db
        .prepare("INSERT INTO portfolios (name) VALUES (?)")
        .run("Rolled back");
      entered();
      await barrier;
      throw new Error("rollback");
    })();
    await ready;
    const external = db
      .prepare("INSERT INTO portfolios (name) VALUES (?)")
      .run("Committed");
    resume();
    await expect(failed).rejects.toThrow("rollback");
    await external;
    expect(
      (await db.prepare("SELECT name FROM portfolios ORDER BY id").all()).map(
        (r) => r.name,
      ),
    ).toEqual(["Main", "Committed"]);
  });
  it("releases the connection after errors and preserves foreign keys", async () => {
    const db = await open();
    await expect(
      db
        .prepare(
          "INSERT INTO transactions (portfolio_id,symbol,side,quantity,price,executed_at) VALUES (?,?,?,?,?,?)",
        )
        .run(999, "AAPL", "BUY", 1, 1, "2026"),
    ).rejects.toThrow();
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM portfolios").get())!.n,
    ).toBe(1);
    await db.close();
    await expect(db.prepare("SELECT 1").get()).rejects.toThrow("closed");
  });
  it("preserves literal and commented question marks when binding PostgreSQL queries", () => {
    expect(
      postgresSQL(`SELECT '?' AS "?", ? -- ?\n, ? /* ? */ , 'it''s?'`),
    ).toBe(`SELECT '?' AS "?", $1 -- ?\n, $2 /* ? */ , 'it''s?'`);
  });
  it("rejects unsupported database URLs", async () => {
    await expect(
      AppDatabase.open({ url: "mysql://localhost/db" }),
    ).rejects.toThrow("DATABASE_URL");
  });
});

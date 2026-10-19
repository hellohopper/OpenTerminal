import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import pg from "pg";
import {createBackup,restoreBackup} from "./backup.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "./database.js";
import { importSqlite, TABLE_COLUMNS } from "./import-sqlite.js";
const base = process.env.TEST_DATABASE_URL;
const suite = base ? describe : describe.skip;
suite("real PostgreSQL backend", () => {
  let admin: pg.Pool,
    db: AppDatabase,
    directory: string,
    portfolio: any,
    journal: any,
    alerts: any,
    service: any;
  const schemas: string[] = [];
  const handles: AppDatabase[] = [];
  async function schemaURL() {
    const name = `terminal_test_${randomUUID().replaceAll("-", "")}`;
    schemas.push(name);
    await admin.query(`CREATE SCHEMA ${name}`);
    const url = new URL(base!);
    url.searchParams.set("options", `-c search_path=${name}`);
    return url.toString();
  }
  const tables = Object.keys(TABLE_COLUMNS);
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: base });
    directory = mkdtempSync(join(tmpdir(), "terminal-postgres-test-"));
    process.env.DATA_DIR = directory;
    process.env.DATABASE_URL = await schemaURL();
    db = (await import("../db.js")).db;
    portfolio = (await import("../routes/portfolio.js")).portfolioRouter;
    journal = (await import("../routes/journal.js")).journalRouter;
    alerts = (await import("../routes/alerts.js")).alertsRouter;
    service = await import("../alerts.js");
  });
  beforeEach(async () => {
    await db.exec(`TRUNCATE ${tables.join(",")} RESTART IDENTITY CASCADE`);
    await db.prepare("INSERT INTO portfolios (name) VALUES (?)").run("Main");
  });
  afterAll(async () => {
    await service?.alertMonitor.stop();
    await db?.close();
    await Promise.all(handles.map((d) => d.close()));
    for (const name of schemas)
      await admin.query(`DROP SCHEMA ${name} CASCADE`);
    await admin?.end();
    if (directory) rmSync(directory, { recursive: true, force: true });
    delete process.env.DATA_DIR;
    delete process.env.DATABASE_URL;
  });
  async function call(
    router: any,
    method: string,
    path: string,
    body?: unknown,
    params: Record<string, unknown> = {},
    query = {},
  ) {
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      end: vi.fn(),
    };
    const handler = router.stack.find(
      (l: any) => l.route?.path === path && l.route.methods[method],
    ).route.stack[0].handle;
    await handler(
      { body, params: { id: "1", ...params }, query },
      res,
      (error: unknown) => {
        throw error;
      },
    );
    return res;
  }
  const trade = {
    symbol: "AAPL",
    side: "BUY",
    quantity: 10,
    price: 100,
    executed_at: "2026-01-01T00:00:00Z",
  };
  it("normalizes IDs/counts and journals without changing API metadata", async () => {
    const created = await call(journal, "post", "/", {
      symbol: "AAPL",
      title: "Quote '? text",
      body: "Research",
      kind: "research",
      image: "data:image/png;base64,iVBORw0KGgo=",
    });
    expect(created.status).toHaveBeenCalledWith(201);
    const id = created.json.mock.calls[0][0].id;
    expect(typeof id).toBe("number");
    const list = await call(journal, "get", "/", undefined, {}, {});
    expect(list.json.mock.calls[0][0].entries[0]).toMatchObject({
      id,
      hasImage: 1,
      title: "Quote '? text",
    });
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get())!.n,
    ).toBe(1);
    await call(
      journal,
      "put",
      "/:id",
      { symbol: "AAPL", title: "Updated", body: "Evidence", kind: "trade" },
      { id },
    );
    const row = (await db
      .prepare("SELECT * FROM journal_entries WHERE id=?")
      .get(id))!;
    expect(new Date(row.updated_at + "Z").getTime()).toBeGreaterThan(0);
  });
  it("serializes concurrent ledger writes and rolls back oversells", async () => {
    await call(portfolio, "post", "/:id/transactions", trade);
    const outcomes = await Promise.all(
      [1, 2].map(() =>
        call(portfolio, "post", "/:id/transactions", {
          ...trade,
          side: "SELL",
          quantity: 7,
          executed_at: "2026-01-02T00:00:00Z",
        }),
      ),
    );
    expect(outcomes.map((r) => r.status.mock.calls[0][0]).sort()).toEqual([
      201, 400,
    ]);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM transactions").get())!.n,
    ).toBe(2);
    const deleted = await call(
      portfolio,
      "delete",
      "/:id/transactions/:txId",
      undefined,
      { txId: "1" },
    );
    expect(deleted.status).toHaveBeenCalledWith(409);
    await db
      .prepare(
        "INSERT INTO portfolio_events (portfolio_id,kind,amount,executed_at) VALUES (?,?,?,?)",
      )
      .run(1, "DEPOSIT", 1000, "2025-12-31T00:00:00Z");
    await call(portfolio, "delete", "/:id");
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM portfolio_events").get())!.n,
    ).toBe(0);
  });
  it("enforces alert caps under concurrency and emits a single event across competing checks", async () => {
    for (let i = 0; i < 19; i++)
      await call(alerts, "post", "/", {
        symbol: `S${i}`,
        condition: "PRICE_ABOVE",
        threshold: 100,
      });
    const results = await Promise.all(
      ["AAPL", "MSFT"].map((symbol) =>
        call(alerts, "post", "/", {
          symbol,
          condition: "PRICE_ABOVE",
          threshold: 100,
        }),
      ),
    );
    expect(results.map((r) => r.status.mock.calls[0][0]).sort()).toEqual([
      201, 409,
    ]);
    const snapshot = await service.activeAlerts();
    const quote = {
      symbol: "S0",
      price: 100,
      changePercent: 1,
      time: null,
      currency: "USD",
      source: "fixture",
    };
    const fired = await Promise.all([
      service.evaluateAlerts(snapshot, [quote]),
      service.evaluateAlerts(snapshot, [quote]),
    ]);
    expect(fired.reduce((a, b) => a + b, 0)).toBe(1);
    const history = await call(alerts, "get", "/events", undefined, {}, {});
    expect(history.json.mock.calls[0][0].events).toHaveLength(1);
    await db.prepare("DELETE FROM price_alerts WHERE symbol=?").run("S0");
    expect(
      (await db.prepare("SELECT alert_id FROM price_alert_events").get())!
        .alert_id,
    ).toBeNull();
  });
  it("holds transactions on one connection and leaves no partial rows on failure", async () => {
    await expect(
      db.transaction(async () => {
        const first = await db.prepare("SELECT pg_backend_pid() AS id").get();
        await new Promise((r) => setTimeout(r, 5));
        expect(await db.prepare("SELECT pg_backend_pid() AS id").get()).toEqual(
          first,
        );
        await db
          .prepare("INSERT INTO portfolios (name) VALUES (?)")
          .run("Temporary");
        throw new Error("abort");
      })(),
    ).rejects.toThrow("abort");
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM portfolios").get())!.n,
    ).toBe(1);
  });
  it("restores older snapshots while keeping PostgreSQL IDs monotonic",async()=>{
    const backup=await createBackup(db);
    await db.prepare("INSERT INTO portfolios (id,name) VALUES (?,?)").run(1000,"Later");
    await restoreBackup(db,backup);
    expect((await db.prepare("INSERT INTO portfolios (name) VALUES (?)").run("After restore")).lastInsertRowid).toBeGreaterThan(1000);
  });
  it("imports all SQLite tables with IDs, attachments, history and working sequences; rejects a second import", async () => {
    const source = await AppDatabase.open({
      filename: join(directory, "source.db"),
    });
    handles.push(source);
    await source
      .prepare("INSERT INTO portfolios (id,name) VALUES (?,?)")
      .run(41, "Imported");
    await source
      .prepare(
        "INSERT INTO transactions (portfolio_id,symbol,side,quantity,price,executed_at) VALUES (?,?,?,?,?,?)",
      )
      .run(41, "AAPL", "BUY", 1, 100, "2026-01-01T00:00:00Z");
    await source
      .prepare(
        "INSERT INTO journal_entries (id,symbol,title,body,kind,image) VALUES (?,?,?,?,?,?)",
      )
      .run(
        55,
        "AAPL",
        "Note",
        "Body",
        "research",
        "data:image/png;base64,iVBORw0KGgo=",
      );
    await source
      .prepare("INSERT INTO briefings (generated_at,content) VALUES (?,?)")
      .run("2026-01-01", '{"summary":"Saved"}');
    await source
      .prepare(
        "INSERT INTO price_alerts (symbol,condition,threshold,created_at) VALUES (?,?,?,?)",
      )
      .run("AAPL", "PRICE_ABOVE", 100, "2026");
    await source
      .prepare(
        "INSERT INTO price_alert_events (alert_id,symbol,condition,threshold,label,value,price,source,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      )
      .run(
        1,
        "AAPL",
        "PRICE_ABOVE",
        100,
        "Target",
        101,
        101,
        "fixture",
        "2026",
      );
    const target = await AppDatabase.open({
      url: await schemaURL(),
      seed: false,
    });
    handles.push(target);
    const counts = await importSqlite(join(directory, "source.db"), target);
    expect(counts.portfolios).toBe(2);
    expect(counts.price_alert_events).toBe(1);
    for (const table of tables)
      expect(
        await target.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      ).toEqual(
        await source.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
      );
    expect(
      (
        await target
          .prepare("INSERT INTO portfolios (name) VALUES (?)")
          .run("Next")
      ).lastInsertRowid,
    ).toBe(42);
    expect(
      (
        await target
          .prepare(
            "INSERT INTO journal_entries (symbol,title,body,kind) VALUES (?,?,?,?)",
          )
          .run("AAPL", "Next", "Body", "research")
      ).lastInsertRowid,
    ).toBe(56);
    await expect(
      importSqlite(join(directory, "source.db"), target),
    ).rejects.toThrow("not empty");
    expect(
      (await target.prepare("SELECT COUNT(*) AS n FROM portfolios").get())!.n,
    ).toBe(3);
  });
  it("rolls back a failed import without losing existing rows or leaving earlier inserts", async () => {
    const source = await AppDatabase.open({
      filename: join(directory, "failed-source.db"),
    });
    handles.push(source);
    await source
      .prepare("INSERT INTO portfolios (name) VALUES (?)")
      .run("Forbidden");
    const target = await AppDatabase.open({
      url: await schemaURL(),
      seed: false,
    });
    handles.push(target);
    await target.exec("ALTER TABLE portfolios ADD CHECK(name <> 'Forbidden')");
    await expect(
      importSqlite(join(directory, "failed-source.db"), target),
    ).rejects.toThrow();
    expect(
      (await target.prepare("SELECT COUNT(*) AS n FROM portfolios").get())!.n,
    ).toBe(0);
  });
});

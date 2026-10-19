import SQLite from "better-sqlite3";
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { MIGRATIONS,SCHEMA_VERSION } from "./migrations.js";
export type Row = Record<string, any>;
export type RunResult = { changes: number; lastInsertRowid: number };
export interface Session {
  all(sql: string, params: unknown[]): Promise<Row[]>;
  run(sql: string, params: unknown[]): Promise<RunResult>;
  exec(sql: string): Promise<void>;
}
export type OpenOptions = { filename?: string; url?: string; seed?: boolean };
/** Application SQL uses ? placeholders. Quoted strings/identifiers and comments are preserved. */
export function postgresSQL(sql: string): string {
  let index = 0;
  return sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (token) => (token === "?" ? `$${++index}` : token),
  );
}
const WRITE_LOCK = 72641829;
function safeInteger(value: string) {
  const n = Number(value);
  if (!Number.isSafeInteger(n))
    throw new Error("Database integer exceeds the supported safe range.");
  return n;
}
export class AppDatabase {
  readonly kind: "sqlite" | "postgres";
  private sqlite?: SQLite.Database;
  private pool?: pg.Pool;
  private context = new AsyncLocalStorage<Session>();
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  private constructor(options: OpenOptions) {
    this.kind = options.url ? "postgres" : "sqlite";
    if (options.url) {
      if (!/^postgres(?:ql)?:\/\//.test(options.url))
        throw new Error("DATABASE_URL must use postgres:// or postgresql://.");
      this.pool = new pg.Pool({
        connectionString: options.url,
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 10000,
        lock_timeout: 10000,
        idle_in_transaction_session_timeout: 30000,
        types: {
          getTypeParser: (oid: number, format?: "text" | "binary") =>
            oid === 20 ? safeInteger : pg.types.getTypeParser(oid, format),
        },
      });
      this.pool.on("error", () => {
        console.error(
          "PostgreSQL idle connection failed; the pool will reconnect.",
        );
      });
    } else {
      this.sqlite = new SQLite(options.filename ?? ":memory:");
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.pragma("foreign_keys = ON");
      this.sqlite.pragma("busy_timeout = 5000");
    }
  }
  static async open(options: OpenOptions = {}): Promise<AppDatabase> {
    const db = new AppDatabase(options);
    try {
      await db.transaction(async () => {
        await db.exec("CREATE TABLE IF NOT EXISTS app_schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
        const current=(await db.prepare("SELECT COALESCE(MAX(id),0) AS version FROM app_schema_migrations").get())!.version;
        if(current>SCHEMA_VERSION)throw new Error("Database schema is newer than this application.");
        for(const migration of MIGRATIONS)if(migration.id>current){await db.exec(db.kind==="postgres"?migration.postgres:migration.sqlite);await db.prepare("INSERT INTO app_schema_migrations (id,applied_at) VALUES (?,?)").run(migration.id,new Date().toISOString());}
        if (
          options.seed !== false &&
          !(await db.prepare("SELECT id FROM portfolios LIMIT 1").get())
        )
          await db
            .prepare("INSERT INTO portfolios (name) VALUES (?)")
            .run("Main");
      })();
      return db;
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  private session(client?: pg.PoolClient): Session {
    if (this.sqlite) {
      const raw = this.sqlite;
      return {
        all: async (sql, params) => raw.prepare(sql).all(...params) as Row[],
        run: async (sql, params) => {
          const r = raw.prepare(sql).run(...params);
          return {
            changes: r.changes,
            lastInsertRowid: Number(r.lastInsertRowid),
          };
        },
        exec: async (sql) => {
          raw.exec(sql);
        },
      };
    }
    const query = (sql: string, params: unknown[] = []) =>
      client
        ? client.query(postgresSQL(sql), params)
        : this.pool!.query(postgresSQL(sql), params);
    return {
      all: async (sql, params) => (await query(sql, params)).rows,
      run: async (sql, params) => {
        const insert = /^\s*INSERT\s+INTO\b/i.test(sql),
          r = await query(
            insert ? `${sql.replace(/;\s*$/, "")} RETURNING id` : sql,
            params,
          );
        return {
          changes: r.rowCount ?? 0,
          lastInsertRowid: insert ? (r.rows[0]?.id ?? 0) : 0,
        };
      },
      exec: async (sql) => {
        await query(sql);
      },
    };
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const job = this.queue.then(fn);
    this.queue = job.catch(() => {});
    return job;
  }
  private use<T>(
    fn: (session: Session) => Promise<T>,
    write = false,
  ): Promise<T> {
    if (this.closed) return Promise.reject(new Error("Database is closed."));
    const active = this.context.getStore();
    if (active) return fn(active);
    if (write) return this.transaction(() => fn(this.context.getStore()!))();
    return this.kind === "sqlite"
      ? this.exclusive(() => fn(this.session()))
      : fn(this.session());
  }
  prepare(sql: string) {
    return {
      all: (...params: unknown[]) => this.use((s) => s.all(sql, params)),
      get: async (...params: unknown[]) =>
        (await this.use((s) => s.all(sql, params)))[0] as Row | undefined,
      run: (...params: unknown[]) => this.use((s) => s.run(sql, params), true),
    };
  }
  exec(sql: string): Promise<void> {
    return this.use((s) => s.exec(sql), true);
  }
  transaction<T>(work: () => Promise<T> | T) {
    const execute = async (): Promise<T> => {
      if (this.closed) throw new Error("Database is closed.");
      if (this.context.getStore())
        throw new Error("Nested transactions are not supported.");
      const run = async () => {
        const client = this.pool ? await this.pool.connect() : undefined;
        const session = this.session(client);
        try {
          await session.exec(
            this.kind === "sqlite" ? "BEGIN IMMEDIATE" : "BEGIN",
          );
          if (client)
            await client.query("SELECT pg_advisory_xact_lock($1)", [
              WRITE_LOCK,
            ]);
          const result = await this.context.run(session, work);
          await session.exec("COMMIT");
          return result;
        } catch (error) {
          await session.exec("ROLLBACK").catch(() => {});
          throw error;
        } finally {
          client?.release();
        }
      };
      return this.kind === "sqlite" ? this.exclusive(run) : run();
    };
    return Object.assign(execute, { immediate: execute });
  }
  async close() {
    if (this.closed) return;
    await this.queue;
    await this.pool?.end();
    this.sqlite?.close();
    this.closed = true;
  }
}

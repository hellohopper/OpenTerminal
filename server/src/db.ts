import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// DATA_DIR lets the Docker image point this at the mounted volume: once
// compiled, dist/db.js sits two levels below /app instead of server/src, so
// the source-relative default below would otherwise resolve outside /app.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dataDir = process.env.DATA_DIR ?? join(root, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "terminal.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS price_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  condition TEXT NOT NULL CHECK(condition IN ('PRICE_ABOVE','PRICE_BELOW','CHANGE_ABOVE','CHANGE_BELOW')),
  threshold REAL NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  armed INTEGER NOT NULL DEFAULT 1 CHECK(armed IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_checked_at TEXT,
  last_value REAL,
  last_triggered_at TEXT
);
CREATE TABLE IF NOT EXISTS price_alert_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  alert_id INTEGER REFERENCES price_alerts(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL, condition TEXT NOT NULL, threshold REAL NOT NULL,
  label TEXT NOT NULL, value REAL NOT NULL, price REAL NOT NULL,
  currency TEXT, source TEXT NOT NULL, observed_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alert_events_by_rule ON price_alert_events(alert_id,id);
CREATE TABLE IF NOT EXISTS briefings (id INTEGER PRIMARY KEY AUTOINCREMENT, generated_at TEXT NOT NULL, content TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('research','trade')), image TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS journal_symbol ON journal_entries(symbol, id);
CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS portfolio_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('DEPOSIT','WITHDRAWAL','DIVIDEND','SPLIT')),
  symbol TEXT, amount REAL NOT NULL CHECK(amount > 0), executed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price >= 0),
  executed_at TEXT NOT NULL
);
`);

const defaultPortfolio = db.prepare("SELECT id FROM portfolios LIMIT 1").get();
if (!defaultPortfolio) {
  db.prepare("INSERT INTO portfolios (name) VALUES (?)").run("Main");
}

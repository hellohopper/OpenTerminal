import { sqliteSchema, postgresSchema } from "./schema.js";
export const MIGRATIONS = [
  { id: 1, sqlite: sqliteSchema, postgres: postgresSchema },
  {
    id: 2,
    sqlite:
      "ALTER TABLE price_alerts ADD COLUMN generation TEXT NOT NULL DEFAULT 'legacy';",
    postgres:
      "ALTER TABLE price_alerts ADD COLUMN generation TEXT NOT NULL DEFAULT 'legacy';",
  },
  {
    id: 3,
    sqlite:
      "CREATE TABLE workspace_sync (id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,version TEXT NOT NULL,updated_at TEXT NOT NULL);",
    postgres:
      "CREATE TABLE workspace_sync (id BIGSERIAL PRIMARY KEY,payload TEXT NOT NULL,version TEXT NOT NULL,updated_at TEXT NOT NULL);",
  },
  {
    id: 4,
    sqlite:
      "ALTER TABLE price_alerts ADD COLUMN metric TEXT NOT NULL DEFAULT 'native' CHECK(metric IN ('native','volume'));\nALTER TABLE price_alerts ADD COLUMN repeat_seconds INTEGER NOT NULL DEFAULT 0 CHECK(repeat_seconds=0 OR repeat_seconds BETWEEN 60 AND 86400);\nALTER TABLE price_alert_events ADD COLUMN metric TEXT NOT NULL DEFAULT 'native';\nCREATE TABLE briefing_schedules (id INTEGER PRIMARY KEY AUTOINCREMENT,symbols TEXT NOT NULL,mode TEXT NOT NULL,local_time TEXT NOT NULL,timezone TEXT NOT NULL,weekdays TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,generation TEXT NOT NULL,last_error TEXT,last_generated_at TEXT);\nCREATE TABLE briefing_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,schedule_id INTEGER NOT NULL REFERENCES briefing_schedules(id) ON DELETE CASCADE,run_key TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,claimed_at TEXT NOT NULL,token TEXT NOT NULL,UNIQUE(schedule_id,run_key));",
    postgres:
      "ALTER TABLE price_alerts ADD COLUMN metric TEXT NOT NULL DEFAULT 'native' CHECK(metric IN ('native','volume'));\nALTER TABLE price_alerts ADD COLUMN repeat_seconds INTEGER NOT NULL DEFAULT 0 CHECK(repeat_seconds=0 OR repeat_seconds BETWEEN 60 AND 86400);\nALTER TABLE price_alert_events ADD COLUMN metric TEXT NOT NULL DEFAULT 'native';\nCREATE TABLE briefing_schedules (id BIGSERIAL PRIMARY KEY,symbols TEXT NOT NULL,mode TEXT NOT NULL,local_time TEXT NOT NULL,timezone TEXT NOT NULL,weekdays TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,generation TEXT NOT NULL,last_error TEXT,last_generated_at TEXT);\nCREATE TABLE briefing_runs (id BIGSERIAL PRIMARY KEY,schedule_id BIGINT NOT NULL REFERENCES briefing_schedules(id) ON DELETE CASCADE,run_key TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL,claimed_at TEXT NOT NULL,token TEXT NOT NULL,UNIQUE(schedule_id,run_key));",
  },
  {
    id: 5,
    sqlite: "CREATE TABLE workspace_sync_history (id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,version TEXT NOT NULL UNIQUE,updated_at TEXT NOT NULL); INSERT INTO workspace_sync_history (payload,version,updated_at) SELECT payload,version,updated_at FROM workspace_sync WHERE id=1;",
    postgres: "CREATE TABLE workspace_sync_history (id BIGSERIAL PRIMARY KEY,payload TEXT NOT NULL,version TEXT NOT NULL UNIQUE,updated_at TEXT NOT NULL); INSERT INTO workspace_sync_history (payload,version,updated_at) SELECT payload,version,updated_at FROM workspace_sync WHERE id=1;",
  },
  { id: 6, sqlite: "CREATE TABLE research_records (id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT NOT NULL,record_key TEXT,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,UNIQUE(kind,record_key));", postgres: "CREATE TABLE research_records (id BIGSERIAL PRIMARY KEY,kind TEXT NOT NULL,record_key TEXT,payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL,UNIQUE(kind,record_key));" },
  { id: 7, sqlite: "SELECT 1;", postgres: "ALTER TABLE research_records ALTER COLUMN version TYPE BIGINT;" },
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.id;

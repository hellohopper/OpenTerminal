import {sqliteSchema,postgresSchema} from './schema.js';
export const MIGRATIONS=[
 {id:1,sqlite:sqliteSchema,postgres:postgresSchema},
 {id:2,sqlite:"ALTER TABLE price_alerts ADD COLUMN generation TEXT NOT NULL DEFAULT 'legacy';",postgres:"ALTER TABLE price_alerts ADD COLUMN generation TEXT NOT NULL DEFAULT 'legacy';"},
 {id:3,sqlite:"CREATE TABLE workspace_sync (id INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,version TEXT NOT NULL,updated_at TEXT NOT NULL);",postgres:"CREATE TABLE workspace_sync (id BIGSERIAL PRIMARY KEY,payload TEXT NOT NULL,version TEXT NOT NULL,updated_at TEXT NOT NULL);"},
];
export const SCHEMA_VERSION=MIGRATIONS.at(-1)!.id;

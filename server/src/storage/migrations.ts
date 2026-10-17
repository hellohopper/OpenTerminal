import {sqliteSchema,postgresSchema} from './schema.js';
export const MIGRATIONS=[
 {id:1,sqlite:sqliteSchema,postgres:postgresSchema},
 {id:2,sqlite:"ALTER TABLE price_alerts ADD COLUMN generation TEXT NOT NULL DEFAULT 'legacy';",postgres:"ALTER TABLE price_alerts ADD COLUMN generation TEXT NOT NULL DEFAULT 'legacy';"},
];
export const SCHEMA_VERSION=MIGRATIONS.at(-1)!.id;

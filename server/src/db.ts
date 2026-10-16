import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppDatabase } from "./storage/database.js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const dataDir = process.env.DATA_DIR ?? join(root, "data");
mkdirSync(dataDir, { recursive: true });
export const db = await AppDatabase.open({
  url: process.env.DATABASE_URL || undefined,
  filename: join(dataDir, "terminal.db"),
});

import { mkdir, readFile, writeFile, rename, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppDatabase } from './database.js';
import { createBackup } from './backup.js';
export const backupPolicySchema = z.object({ enabled: z.boolean(), hourUtc: z.number().int().min(0).max(23), retain: z.number().int().min(1).max(30) });
const defaults = { enabled: false, hourUtc: 3, retain: 7 };
type Status = { lastSuccess: string | null; lastAttempt: string | null; error: string | null };
export function createBackupScheduler(db: AppDatabase, directory: string, clock = () => new Date()) {
  let timer: ReturnType<typeof setInterval> | undefined, flight: Promise<unknown> | undefined;
  const filePattern = /^backup-\d{13}-[a-f0-9-]{36}\.json$/;
  const read = async <T>(name: string, fallback: T): Promise<T> => { try { return JSON.parse(await readFile(join(directory, name), 'utf8')); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw e; } };
  const atomic = async (name: string, value: unknown) => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temp = join(directory, `.pending-${randomUUID()}`);
    try { await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temp, join(directory, name)); }
    finally { await unlink(temp).catch(() => {}); }
  };
  const policy = async () => backupPolicySchema.parse(await read('policy.json', defaults));
  const status = () => read<Status>('status.json', { lastSuccess: null, lastAttempt: null, error: null });
  const files = async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const names = (await readdir(directory)).filter(n => filePattern.test(n)).sort().reverse();
    return Promise.all(names.map(async name => ({ name, bytes: (await stat(join(directory, name))).size, createdAt: new Date(Number(name.slice(7,20))).toISOString() })));
  };
  const check = (force = false) => {
    if (flight) return flight;
    flight = (async () => {
      const config = await policy(), old = await status(), now = clock(), date = now.toISOString().slice(0,10);
      if (!force && (!config.enabled || now.getUTCHours() < config.hourUtc || old.lastSuccess?.startsWith(date) || old.lastAttempt && now.getTime() - Date.parse(old.lastAttempt) < 3600000)) return { deferred: true };
      try {
        const snapshot = await createBackup(db), name = `backup-${now.getTime()}-${randomUUID()}.json`;
        await atomic(name, snapshot);
        // Prune only after a new valid snapshot is durable; never delete user-supplied files.
        for (const oldFile of (await files()).slice(config.retain)) await unlink(join(directory, oldFile.name));
        await atomic('status.json', { lastSuccess: now.toISOString(), lastAttempt: now.toISOString(), error: null });
        return { name };
      } catch (e) {
        const error = (e as Error).message;
        await atomic('status.json', { ...old, lastAttempt: now.toISOString(), error }).catch(() => {});
        // Also surface failures in the persistent inbox/TODAY, once per UTC date.
        await db.transaction(async () => {
          const key = `backup-failed:${date}`;
          if (!await db.prepare("SELECT id FROM research_records WHERE kind='notification' AND record_key=?").get(key)) {
            await db.prepare("INSERT INTO research_records (kind,record_key,payload,updated_at) VALUES (?,?,?,?)").run('notification', key, JSON.stringify({ title:'Scheduled backup failed', body:'Open BACKUP to inspect the last attempt and retry.', symbol:'', sourceKey:key, createdAt:now.toISOString(), read:false }), now.toISOString());
            await db.prepare("DELETE FROM research_records WHERE kind='notification' AND id NOT IN (SELECT id FROM research_records WHERE kind='notification' ORDER BY id DESC LIMIT 500)").run();
          }
        })().catch(() => {});
        throw e;
      }
    })().finally(() => { flight = undefined; });
    return flight;
  };
  return {
    policy, status, files, check,
    async configure(input: unknown) { const next = backupPolicySchema.parse(input); await atomic('policy.json', next); return next; },
    async download(name: string) { if (!filePattern.test(name)) throw new Error('Invalid backup name.'); return readFile(join(directory, name), 'utf8'); },
    start() { if (timer) return; timer = setInterval(() => void check().catch(() => {}), 60000); timer.unref(); void check().catch(() => {}); },
    async stop() { clearInterval(timer); timer = undefined; await flight?.catch(() => {}); },
  };
}

import { readDeviceSnapshot, applyDeviceSnapshot, type DeviceSnapshot } from './device-sync';
const isDraft = (key: string) => key.startsWith('openterminal-research-draft-v1:') || key.startsWith('openterminal-journal-draft-v1:');
async function checksum(value: unknown) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
export type MigrationBackup = { format: 'openterminal-migration'; version: 1; createdAt: string; server: any; device: DeviceSnapshot; drafts: Record<string,string>; checksum: string };
export async function createMigrationBackup(server: unknown, device: DeviceSnapshot, storage: Storage): Promise<MigrationBackup> {
  const drafts = Object.fromEntries(Object.keys(storage).filter(isDraft).map(k => [k, storage.getItem(k)!]));
  const payload = { server, device: readDeviceSnapshot(device), drafts };
  if (JSON.stringify(payload.device).length > 2*1024*1024) throw new Error("Device snapshot exceeds 2 MB.");
  if (JSON.stringify(drafts).length > 5 * 1024 * 1024) throw new Error('Research drafts exceed 5 MB. Export or remove some drafts first.');
  return { format: 'openterminal-migration', version: 1, createdAt: new Date().toISOString(), ...payload, checksum: await checksum(payload) };
}
export async function readMigrationBackup(value: unknown): Promise<MigrationBackup> {
  const v = value as MigrationBackup;
  if (!v || v.format !== 'openterminal-migration' || v.version !== 1 || !v.drafts || Array.isArray(v.drafts) || JSON.stringify(v.drafts).length > 5*1024*1024) throw new Error('Invalid migration file.');
  if (await checksum({server:v.server,device:v.device,drafts:v.drafts}) !== v.checksum) throw new Error('Migration checksum does not match.');
  const device = readDeviceSnapshot(v.device);
  if (JSON.stringify(device).length > 2*1024*1024 || Object.keys(v.drafts).length > 500) throw new Error('Migration device data exceeds limits.');
  for (const [key, raw] of Object.entries(v.drafts)) {
    if (!isDraft(key) || key.length > 500 || typeof raw !== 'string' || raw.length > 1500000 || JSON.parse(raw)?.version !== 1) throw new Error('Invalid research draft.');
  }
  if (v.server?.format !== 'openterminal-backup') throw new Error('Missing server backup.');
  return {...v,device};
}
/** Stage browser data before the server restore; caller rolls back on a failed request. */
export function stageMigrationBrowser(backup: MigrationBackup, storage: Storage) {
  const relevant = (k: string) => isDraft(k) || k.startsWith('openterminal-drawings-v1:') || ['openterminal-workspace','openterminal-preferences','openterminal-display','openterminal-sync-version'].includes(k);
  const before = Object.fromEntries(Object.keys(storage).filter(relevant).map(k => [k, storage.getItem(k)!]));
  const rollback = () => { for (const k of Object.keys(storage).filter(relevant)) storage.removeItem(k); for (const [k,v] of Object.entries(before)) storage.setItem(k,v); };
  try {
    for (const key of Object.keys(storage).filter(isDraft)) storage.removeItem(key);
    applyDeviceSnapshot(backup.device, '', storage);
    for (const [key,raw] of Object.entries(backup.drafts)) storage.setItem(key,raw);
  } catch (e) { rollback(); throw e; }
  return rollback;
}

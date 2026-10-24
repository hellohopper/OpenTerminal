import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import type { AppDatabase } from "./storage/database.js";
export const DEVICE_LIFETIME_MS = 30 * 86400000;
export const ownerBinding = (password: string, secret: string) => createHmac("sha256", secret).update(createHash("sha256").update(password).digest()).digest("hex");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export function createMobileDevices(db: AppDatabase, binding: () => string, clock = () => new Date()) {
  const list = async () => db.prepare("SELECT id,name,expires_at,created_at,revoked_at FROM mobile_devices ORDER BY created_at DESC").all();
  const verify = async (token: string) => {
    if (!/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    return await db.prepare("SELECT id,name,expires_at,created_at FROM mobile_devices WHERE token_hash=? AND binding=? AND revoked_at IS NULL AND expires_at>?").get(hash(token), binding(), clock().toISOString()) ?? null;
  };
  return {
    list, verify,
    async register(name: string) {
      return db.transaction(async () => {
        const now = clock(), currentBinding = binding();
        // Device credentials intentionally stay outside business-data backups.
        await db.prepare("DELETE FROM mobile_devices WHERE expires_at<=? OR revoked_at IS NOT NULL OR binding<>?").run(now.toISOString(), currentBinding);
        if ((await list()).length >= 20) throw Object.assign(new Error("Revoke a device before adding another (maximum 20)."), { status: 409 });
        const id = randomUUID(), token = `${id}.${randomBytes(32).toString("base64url")}`, expiresAt = new Date(now.getTime() + DEVICE_LIFETIME_MS).toISOString();
        await db.prepare("INSERT INTO mobile_devices (id,name,token_hash,binding,expires_at,created_at) VALUES (?,?,?,?,?,?)").run(id, name, hash(token), currentBinding, expiresAt, now.toISOString());
        return { id, name, token, expiresAt };
      })();
    },
    async renew(token: string) {
      return db.transaction(async () => {
        const device = await verify(token); if (!device) return null;
        const expiresAt = new Date(clock().getTime() + DEVICE_LIFETIME_MS).toISOString();
        await db.prepare("UPDATE mobile_devices SET expires_at=? WHERE id=?").run(expiresAt, device.id);
        return { id: device.id, name: device.name, expiresAt };
      })();
    },
    async revoke(id: string) { await db.prepare("UPDATE mobile_devices SET revoked_at=? WHERE id=?").run(clock().toISOString(), id); },
    async active(id: string) { return !!await db.prepare("SELECT id FROM mobile_devices WHERE id=? AND binding=? AND revoked_at IS NULL AND expires_at>?").get(id, binding(), clock().toISOString()); },
  };
}

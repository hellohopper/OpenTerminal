import {it,expect,afterAll} from "vitest";
import {mkdtempSync,rmSync} from "node:fs";import {tmpdir} from "node:os";import {join} from "node:path";
import {AppDatabase} from "./storage/database";
import {createMobileDevices,ownerBinding,DEVICE_LIFETIME_MS} from "./mobile-devices";
import {createBackup} from "./storage/backup";
const directory=mkdtempSync(join(tmpdir(),"mobile-auth-"));afterAll(()=>rmSync(directory,{recursive:true,force:true}));
it("stores only token hashes, renews credentials, enforces expiry/revocation and excludes credentials from backups",async()=>{
 const db=await AppDatabase.open({filename:join(directory,"auth.db")});let now=new Date("2026-01-01"),binding=ownerBinding("owner password","secret");const devices=createMobileDevices(db,()=>binding,()=>now);
 try{
  const phone=await devices.register("Phone"),other=await devices.register("Other");expect(await devices.verify(phone.token)).toMatchObject({id:phone.id});
  expect(JSON.stringify(await db.prepare("SELECT * FROM mobile_devices").all())).not.toContain(phone.token);
  expect(await devices.verify(phone.token+"x")).toBeNull();expect(await devices.verify("untrusted")).toBeNull();
  now=new Date(now.getTime()+86400000);expect((await devices.renew(phone.token))?.expiresAt).toBe(new Date(now.getTime()+DEVICE_LIFETIME_MS).toISOString());
  await devices.revoke(other.id);expect(await devices.verify(other.token)).toBeNull();expect(await devices.active(other.id)).toBe(false);
  expect(JSON.stringify(await createBackup(db))).not.toContain("token_hash");
  binding=ownerBinding("changed password","secret");expect(await devices.verify(phone.token)).toBeNull();expect(await devices.active(phone.id)).toBe(false);
  const fresh=await devices.register("Fresh");now=new Date(now.getTime()+DEVICE_LIFETIME_MS);expect(await devices.verify(fresh.token)).toBeNull();expect(await devices.renew(fresh.token)).toBeNull();
 }finally{await db.close();}
});
it("bounds paired devices and makes room after revocation",async()=>{
 const db=await AppDatabase.open({filename:join(directory,"limit.db")}),devices=createMobileDevices(db,()=>"owner");
 try{const rows=[];for(let i=0;i<20;i++)rows.push(await devices.register(`Phone ${i}`));await expect(devices.register("Too many")).rejects.toThrow("maximum 20");await devices.revoke(rows[0].id);expect((await devices.register("Replacement")).id).toBeTruthy();}finally{await db.close();}
});

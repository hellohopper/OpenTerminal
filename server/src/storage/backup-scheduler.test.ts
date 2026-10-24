import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {AppDatabase} from './database.js';import {createBackupScheduler} from './backup-scheduler.js';import {restoreBackup} from './backup.js';
const cleanup:(()=>Promise<void>)[]=[];afterEach(async()=>{for(const f of cleanup.splice(0))await f();vi.restoreAllMocks();});
async function fixture(){const db=await AppDatabase.open(),dir=await mkdtemp(join(tmpdir(),'terminal-backups-'));cleanup.push(()=>db.close(),()=>rm(dir,{recursive:true,force:true}));return {db,dir};}
it('schedules daily backups, persists settings, deduplicates concurrent runs and retains valid restorable files',async()=>{
 const {db,dir}=await fixture();let now=new Date('2026-10-23T02:00:00Z');const s=createBackupScheduler(db,dir,()=>now);
 expect(await s.check()).toEqual({deferred:true});await s.configure({enabled:true,hourUtc:3,retain:2});expect(await s.check()).toEqual({deferred:true});now=new Date('2026-10-23T04:00:00Z');await Promise.all([s.check(),s.check()]);expect(await s.files()).toHaveLength(1);expect(await s.check()).toEqual({deferred:true});
 await writeFile(join(dir,'keep.txt'),'user file');now=new Date('2026-10-24T04:00:00Z');await s.check();now=new Date('2026-10-25T04:00:00Z');await s.check();expect(await s.files()).toHaveLength(2);expect(await readFile(join(dir,'keep.txt'),'utf8')).toBe('user file');
 const restart=createBackupScheduler(db,dir,()=>now);expect((await restart.policy()).enabled).toBe(true);expect(await restart.check()).toEqual({deferred:true});const raw=await restart.download((await s.files())[0].name);await restoreBackup(db,JSON.parse(raw));expect((await s.status()).lastSuccess).toBe(now.toISOString());await expect(s.download('../policy.json')).rejects.toThrow('Invalid');
});
it('records failures in status and inbox without pruning existing backups',async()=>{
 const {db,dir}=await fixture();let now=new Date('2026-10-23T04:00:00Z');const s=createBackupScheduler(db,dir,()=>now);await s.configure({enabled:true,hourUtc:3,retain:1});await s.check();
 const original=db.prepare.bind(db);vi.spyOn(db,'prepare').mockImplementation(sql=>{if(sql.includes('SELECT * FROM portfolios WHERE id>'))throw new Error('Simulated read failure');return original(sql);});
 now=new Date('2026-10-24T04:00:00Z');await expect(s.check()).rejects.toThrow('Simulated');expect(await s.files()).toHaveLength(1);expect((await s.status()).error).toContain('Simulated');expect((await db.prepare("SELECT * FROM research_records WHERE kind='notification'").all())).toHaveLength(1);await expect(s.check(true)).rejects.toThrow();expect((await db.prepare("SELECT * FROM research_records WHERE kind='notification'").all())).toHaveLength(1);expect(await s.check()).toEqual({deferred:true});
});

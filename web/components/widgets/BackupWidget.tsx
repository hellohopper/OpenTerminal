"use client";
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../lib/use-i18n';
import { apiGet, apiPost } from '../../lib/api';
import { captureDevice } from '../../lib/capture-device';
import { createMigrationBackup, readMigrationBackup, stageMigrationBrowser, type MigrationBackup } from '../../lib/migration-backup';
type Policy = { enabled: boolean; hourUtc: number; retain: number };
type Schedule = { policy: Policy; status: {lastSuccess: string|null; lastAttempt:string|null; error:string|null}; files:{name:string;createdAt:string;bytes:number}[] };
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], {type:'application/json'})), a=document.createElement('a');
  a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export default function BackupWidget() {
  const {t:ui}=useI18n(), qc=useQueryClient();
  const [backup,setBackup]=useState<any>(null),[migration,setMigration]=useState<MigrationBackup|null>(null),[confirm,setConfirm]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[edited,setEdited]=useState<Policy|null>(null);
  const {data}=useQuery({queryKey:['data-status'],queryFn:()=>apiGet<{database:string;schemaVersion:number}>('/api/data/status')});
  const schedule=useQuery({queryKey:['backup-schedule'],queryFn:()=>apiGet<Schedule>('/api/data/schedule'),refetchInterval:60000});
  const policy=edited??schedule.data?.policy;
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await fn();}catch(e){setMessage((e as Error).message);}finally{setBusy(false);void qc.invalidateQueries({queryKey:['backup-schedule']});}};
  return <div className="p-2 space-y-3">
    <p>{ui('Server database:')} {data?.database??'…'} {ui('· Schema')} {data?.schemaVersion??'…'}</p>
    <p className="dim">{ui('Scheduled backups stay on the server disk. Download a copy for protection against disk loss. API keys and sessions are excluded.')}</p>
    <fieldset className="border border-[var(--border)] p-2 space-y-2"><legend>{ui('Daily server backup')}</legend>
      {schedule.error&&<p role="alert">{schedule.error.message}</p>}
      {policy&&<><label className="block"><input type="checkbox" checked={policy.enabled} onChange={e=>setEdited({...policy,enabled:e.target.checked})}/>{ui('Enable daily backups')}</label><label>{ui('Hour (UTC)')} <input aria-label={ui('Backup hour UTC')} type="number" min="0" max="23" value={policy.hourUtc} onChange={e=>setEdited({...policy,hourUtc:+e.target.value})}/></label><label>{ui('Copies to retain')} <input aria-label={ui('Backup retention')} type="number" min="1" max="30" value={policy.retain} onChange={e=>setEdited({...policy,retain:+e.target.value})}/></label><button className="term-btn" disabled={busy} onClick={()=>run(async()=>{await apiPost('/api/data/schedule',policy);setEdited(null);setMessage(ui('Backup schedule saved.'));})}>{ui('Save backup schedule')}</button></>}
      <button className="term-btn" disabled={busy} onClick={()=>run(async()=>{await apiPost('/api/data/schedule/run',{});setMessage(ui('Server backup created.'));})}>{ui('Back up now')}</button>
      <p>{ui('Last successful backup')} · {schedule.data?.status.lastSuccess??ui('None')}</p><p>{ui('Last backup attempt')} · {schedule.data?.status.lastAttempt??ui('None')}</p>
      {schedule.data?.status.error&&<p role="alert" className="down">{ui('Backup failed')} · {schedule.data.status.error}</p>}
      <details><summary>{ui('Retained server backups')}</summary>{schedule.data?.files.map(f=><p key={f.name}><button className="term-btn" disabled={busy} onClick={()=>run(async()=>download(await apiGet(`/api/data/schedule/files/${f.name}`),f.name))}>{f.createdAt} · {Math.ceil(f.bytes/1024)} KB</button></p>)}</details>
    </fieldset>
    <div className="flex flex-wrap gap-2"><button className="term-btn" disabled={busy} onClick={()=>run(async()=>{download(await apiGet('/api/data/backup'),'openterminal-backup.json');setMessage(ui('Server backup downloaded.'));})}>{ui('Download server backup')}</button><button className="term-btn" disabled={busy} onClick={()=>run(async()=>{download(await createMigrationBackup(await apiGet('/api/data/backup'),captureDevice(),localStorage),'openterminal-migration.json');setMessage(ui('Complete migration file downloaded.'));})}>{ui('Download complete migration')}</button></div>
    <p className="dim">{ui('Complete migration includes server records, this browser’s layouts, UI preferences, drawings and research drafts. Server backups are limited to 32 MB / 50000 rows; browser snapshots to 2 MB and drafts to 5 MB.')}</p>
    <div className="border border-[var(--border)] p-2 space-y-2"><p className="amber">{migration?ui('Complete restore replaces server data and this browser’s saved configuration and drafts.'):ui('Restore replaces all server data atomically. Existing browser layouts stay on this device.')}</p>
      <input type="file" disabled={busy} accept=".json,application/json" aria-label={ui('Server backup file')} onChange={e=>{const f=e.target.files?.[0];setBackup(null);setMigration(null);setConfirm('');if(!f)return;void run(async()=>{if(f.size>40*1024*1024)throw new Error('Backup exceeds 40 MB.');const b=JSON.parse(await f.text());if(b.format==='openterminal-migration'){const m=await readMigrationBackup(b);setMigration(m);setBackup(m.server);}else{if(b.format!=='openterminal-backup'||!b.data)throw new Error('Invalid backup format.');setBackup(b);}setMessage(ui('Backup loaded. Check the summary before restoring.'));});}}/>
      {backup&&<><p>{ui('Created')} {backup.createdAt} {ui('· Schema')} {backup.schemaVersion}</p>{migration&&<p>{migration.device.workspace.workspaces.length} {ui('workspaces')} · {Object.keys(migration.drafts).length} {ui('research drafts')}</p>}<details open><summary>{ui('Backup contents')}</summary><ul>{Object.entries(backup.data).map(([table,rows])=><li key={table}>{table}: {Array.isArray(rows)?rows.length:ui('invalid')} {ui('rows')}</li>)}</ul></details><label>{ui('Type RESTORE')}<input aria-label={ui('Restore confirmation')} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label><button className="term-btn" disabled={confirm!=='RESTORE'||busy} onClick={()=>run(async()=>{const rollback=migration?stageMigrationBrowser(migration,localStorage):null;try{await apiPost('/api/data/restore',{backup,confirmation:confirm});}catch(e){rollback?.();throw e;}if(migration){window.location.reload();return;}setMessage(ui('Server data restored.'));setBackup(null);setConfirm('');await qc.invalidateQueries();})}>{ui('Restore server backup')}</button></>}
    </div>{message&&<p role="status" className="amber">{message}</p>}
  </div>;
}

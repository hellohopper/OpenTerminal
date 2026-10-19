import { db } from './db.js';
export type RecordRow<T> = {id:number; payload:T; version:number; updated_at:string};
export async function records<T>(kind:string):Promise<RecordRow<T>[]> {
  return (await db.prepare('SELECT * FROM research_records WHERE kind=? ORDER BY id DESC LIMIT 500').all(kind)).map(r=>({...r,payload:JSON.parse(r.payload)})) as RecordRow<T>[];
}
export async function addRecord(kind:string,payload:unknown,key:string|null=null) {
  return (await db.prepare('INSERT INTO research_records (kind,record_key,payload,updated_at) VALUES (?,?,?,?)').run(kind,key,JSON.stringify(payload),new Date().toISOString())).lastInsertRowid;
}
export async function updateRecord(kind:string,id:number,version:number,payload:unknown) {
  const r=await db.prepare('UPDATE research_records SET payload=?,version=version+1,updated_at=? WHERE kind=? AND id=? AND version=?').run(JSON.stringify(payload),new Date().toISOString(),kind,id,version);
  if(!r.changes) throw new Error('This record changed or was deleted. Reload before saving.');
}
export async function removeRecord(kind:string,id:number) {await db.prepare('DELETE FROM research_records WHERE kind=? AND id=?').run(kind,id);}

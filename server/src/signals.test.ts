import {describe,it,expect,afterAll} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const directory=mkdtempSync(join(tmpdir(),'terminal-signals-'));process.env.DATA_DIR=directory;
const {evaluateSignal,signalSchema,createSignalMonitor}=await import('./signals.js');
const {db}=await import('./db.js');const {addRecord,records}=await import('./records.js');
afterAll(async()=>{await db.close();rmSync(directory,{recursive:true,force:true});delete process.env.DATA_DIR;});
import {closedDaily} from './daily-history.js';
const rows=Array.from({length:25},(_,i)=>({time:Date.parse('2026-01-01')/1000+i*86400,open:100,close:100,high:101,low:99,volume:100}));
const rule=signalSchema.parse({name:'Breakout',symbols:['AAPL'],conditions:[{type:'BREAKOUT',period:20,threshold:0},{type:'VOLUME_ABOVE',period:20,threshold:1.5}]});
describe('daily signals',()=>{
 it('uses preceding bars for breakout and volume and requires every condition',()=>{const sample=[...rows.slice(0,-1),{...rows.at(-1)!,close:103,high:104,volume:200}];expect(evaluateSignal(rule,sample).matched).toBe(true);sample.at(-1)!.volume=120;expect(evaluateSignal(rule,sample).matched).toBe(false);});
 it('rejects insufficient and malformed history; excludes current and future bars',()=>{expect(()=>evaluateSignal(rule,rows.slice(0,10))).toThrow('Need');expect(closedDaily(rows,new Date('2026-01-10'))).toHaveLength(9);expect(()=>closedDaily([{...rows[0],close:NaN}])).toThrow();expect(()=>closedDaily([rows[0],rows[0]])).toThrow('Duplicate');});
 it('requires actual crossings instead of persistent above-SMA values',()=>{const r={...rule,conditions:[{type:'SMA_CROSS_UP' as const,period:20,threshold:0}]};expect(evaluateSignal(r,[...rows.slice(0,-1),{...rows.at(-1)!,close:103,high:104}]).matched).toBe(true);expect(evaluateSignal(r,rows).matched).toBe(false);});
});

it('persists one event across overlapping monitor checks, restart and rule deletion',async()=>{
 const sample=[...rows.slice(0,-1),{...rows.at(-1)!,close:103,high:104,volume:200}];
 const id=await addRecord('signal',rule);const load=async()=>sample,clock=()=>new Date('2026-01-26T01:00:00Z');
 const monitor=createSignalMonitor(load,clock);await Promise.all([monitor.check(),monitor.check()]);expect(await records('signal-event')).toHaveLength(1);await monitor.stop();
 await createSignalMonitor(load,clock).check();expect(await records('signal-event')).toHaveLength(1);await db.prepare('DELETE FROM research_records WHERE id=?').run(id);expect(await records('signal-event')).toHaveLength(1);
});

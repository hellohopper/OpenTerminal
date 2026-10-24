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
it('enforces the active-symbol cap when two paused groups are resumed concurrently',async()=>{await db.exec('DELETE FROM research_records;');const first=await addRecord('signal',{...rule,enabled:false,symbols:Array.from({length:20},(_,i)=>`A${i}`)}),second=await addRecord('signal',{...rule,enabled:false,symbols:Array.from({length:20},(_,i)=>`B${i}`)});const router=(await import('./routes/signals.js')).signalsRouter;const handler=(router as any).stack.find((l:any)=>l.route?.path==='/:id'&&l.route.methods.put).route.stack[0].handle;const results=await Promise.all([first,second].map(async id=>{let status=200;const res:any={status:(s:number)=>{status=s;return res;},json:()=>res};await handler({params:{id:String(id)},body:{enabled:true,version:1}},res,(e:any)=>{throw e;});return status;}));expect(results.sort()).toEqual([200,409]);expect((await records<any>('signal')).filter(r=>r.payload.enabled)).toHaveLength(1);});

it('catches intermediate signals after restart with prefix-only calculations and durable checkpoints',async()=>{
 await db.exec('DELETE FROM research_records;');
 const {signalCatchup}=await import('./signals.js');
 const daily={...rule,mode:'daily' as const,conditions:[{type:'VOLUME_ABOVE' as const,period:2,threshold:1.5}]};
 const sample=Array.from({length:12},(_,i)=>({...rows[0],time:rows[0].time+i*86400,volume:i===9?1000:100}));
 const previous={date:'2026-01-08',matched:false};
 const catchup=signalCatchup(daily,sample,previous);
 expect(catchup.results.filter(r=>r.fire).map(r=>r.date)).toEqual(['2026-01-10']);
 expect(catchup.results.find(r=>r.fire)?.historical).toBe(true);
 expect(catchup.results[0].evidence).toEqual(evaluateSignal(daily,sample.slice(0,9)).evidence);
 await addRecord('signal',{...daily,state:{AAPL:previous}});
 const clock=()=>new Date('2026-01-13T01:00:00Z');await createSignalMonitor(async()=>sample,clock).check();
 expect((await records<any>('signal'))[0].payload.state.AAPL.date).toBe('2026-01-12');
 expect(await records('signal-event')).toHaveLength(1);
 await createSignalMonitor(async()=>sample,clock).check();expect(await records('signal-event')).toHaveLength(1);
});
it('bounds catch-up and keeps missing or future checkpoints instead of silently skipping days',async()=>{
 const {signalCatchup,SIGNAL_CATCHUP_LIMIT}=await import('./signals.js');
 const sample=Array.from({length:90},(_,i)=>({...rows[0],time:rows[0].time+i*86400}));
 const daily={...rule,conditions:[{type:'VOLUME_ABOVE' as const,period:2,threshold:1}]};
 const r=signalCatchup(daily,sample,{date:'2026-01-10',matched:true});
 expect(r.results).toHaveLength(SIGNAL_CATCHUP_LIMIT);expect(r.remaining).toBe(50);
 expect(()=>signalCatchup(daily,sample,{date:'2025-12-31',matched:false})).toThrow('missing');
 expect(()=>signalCatchup(daily,sample,{date:'2027-01-01',matched:false})).toThrow('before');
 expect(signalCatchup(daily,sample).results).toHaveLength(1);
});

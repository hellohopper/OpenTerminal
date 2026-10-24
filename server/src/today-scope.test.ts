import {it,expect,afterAll} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'terminal-today-'));process.env.DATA_DIR=dir;
const {db}=await import('./db.js'),{addRecord}=await import('./records.js'),{todaySymbols,accountTasks}=await import('./today-scope.js');
afterAll(async()=>{await db.close();rmSync(dir,{recursive:true,force:true});delete process.env.DATA_DIR;});
it('includes all selected symbols beyond twelve and imported holdings, rejecting overflow',async()=>{
 const id=await addRecord('fx-account',{name:'Imported'});await addRecord(`fx-entry:${id}`,{kind:'DEPOSIT',currency:'USD',amount:1000,date:'2026-01-01T00:00:00Z'});await addRecord(`fx-entry:${id}`,{kind:'BUY',currency:'USD',symbol:'AAPL',quantity:1,price:100,fee:0,date:'2026-01-02T00:00:00Z'});
 const symbols=Array.from({length:25},(_,i)=>`S${i}`);expect(await todaySymbols(symbols,[],[id])).toEqual([...symbols,'AAPL']);await expect(todaySymbols(Array.from({length:201},(_,i)=>`S${i}`),[],[])).rejects.toThrow('200');await expect(todaySymbols([],[],[999])).rejects.toThrow('not found');
});
it('adds upcoming and overdue open option lots and only the latest unmatched reconciliation per account',async()=>{
 await addRecord('option-account',{name:'Simulation'});await addRecord('option-lot',{accountId:1,symbol:'AAPL',expiry:'2026-10-22',remaining:1,status:'open'});await addRecord('option-lot',{accountId:1,symbol:'AAPL',expiry:'2026-10-26',remaining:0,status:'closed'});await addRecord('option-lot',{accountId:1,symbol:'AAPL',expiry:'2026-12-26',remaining:1,status:'open'});
 await addRecord('account-reconciliation',{accountId:3,asOf:'2026-10-20',matched:false,rows:[{difference:10}]});await addRecord('account-reconciliation',{accountId:3,asOf:'2026-10-21',matched:true,rows:[]});await addRecord('account-reconciliation',{accountId:4,asOf:'2026-10-21',matched:false,rows:[{difference:5}]});
 const tasks=await accountTasks(new Date('2026-10-23'));expect(tasks.filter(t=>t.kind==='expiry')).toHaveLength(1);expect(tasks.filter(t=>t.kind==='reconciliation')).toHaveLength(1);expect(tasks.find(t=>t.kind==='reconciliation')?.title).toContain('#4');
});

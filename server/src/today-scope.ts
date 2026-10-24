import { db } from './db.js';
import { records } from './records.js';
import { ledgerData } from './ledger-data.js';
import { replayLedger } from './portfolio.js';
import { replayMulti, type MultiEntry } from './multicurrency.js';
import type { TodayTask } from './today.js';
export async function todaySymbols(symbols: string[], portfolioIds: number[], accountIds: number[]) {
  return db.transaction(async () => {
    const all = new Set(symbols);
    for (const id of portfolioIds) { const l=await ledgerData(id); for(const [s,p] of replayLedger(l.trades,l.events).positions) if(p.quantity>0)all.add(s); }
    const accounts=await records('fx-account');
    for(const id of accountIds) { if(!accounts.some(a=>a.id===id))throw new Error('Currency account not found'); const state=replayMulti((await records<MultiEntry>(`fx-entry:${id}`)).map(r=>({...r.payload,id:r.id})),()=>1);state.positions.forEach(p=>all.add(p.symbol)); }
    if(all.size>200)throw new Error('TODAY supports 200 unique symbols. Select fewer groups or accounts.');
    return [...all];
  })();
}
export async function accountTasks(now: Date): Promise<TodayTask[]> {
  const tasks:TodayTask[]=[], end=new Date(now.getTime()+7*86400000).toISOString().slice(0,10);
  const accounts=await records<{name:string}>('option-account');
  for(const lot of await records<{accountId:number;symbol:string;expiry:string;remaining:number;status:string}>('option-lot')){
    const p=lot.payload;if(p.remaining<=0||p.expiry>end)continue;
    tasks.push({key:`expiry:${lot.id}:${lot.version}`,kind:'expiry',title:`${p.symbol} option expiry ${p.expiry}`,detail:`Simulated account ${accounts.find(a=>a.id===p.accountId)?.payload.name??p.accountId} · lot #${lot.id} · ${p.remaining} contracts remaining`,symbol:p.symbol,target:'optionPositions'});
  }
  // Only the latest statement per account is actionable; a later matched statement resolves an old discrepancy.
  const seen=new Set<number>();
  for(const r of await records<{accountId:number;asOf:string;matched:boolean;rows:{difference:number}[]}>('account-reconciliation')) {
    const p=r.payload;if(seen.has(p.accountId))continue;seen.add(p.accountId);if(p.matched)continue;
    tasks.push({key:`reconciliation:${r.id}`,kind:'reconciliation',title:`Account #${p.accountId} reconciliation`,detail:`Statement ${p.asOf} · ${p.rows.filter(row=>Math.abs(row.difference)>1e-6).length} differences · report #${r.id}`,symbol:null,target:'accountImport'});
  }
  return tasks;
}

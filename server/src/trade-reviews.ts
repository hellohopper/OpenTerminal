import {replayLedger,type Trade,type CashEvent} from './portfolio.js';
export type RoundTrip={key:string;symbol:string;openedAt:string;closedAt:string|null;buyCost:number;sellProceeds:number;quantity:number;pnl:number|null;returnPercent:number|null;days:number|null;tradeIds:number[];strategy?:string;journalId?:number|null;note?:string};
/** Flat-to-flat cycles. Splits alter share count without changing invested dollars. */
export function tradeReviews(trades:Trade[],events:CashEvent[]){
 replayLedger(trades,events);
 const open=new Map<string,RoundTrip>(),closed:RoundTrip[]=[];
 const ledger=[...trades.map(t=>({...t,type:'trade' as const})),...events.filter(e=>e.kind==='SPLIT').map(e=>({...e,type:'split' as const}))].sort((a,b)=>Date.parse(a.executed_at)-Date.parse(b.executed_at)||(a.type===b.type?(a.id??0)-(b.id??0):a.type==='split'?-1:1));
 for(const item of ledger){const symbol=item.symbol!;let cycle=open.get(symbol);
  if(item.type==='split'){if(cycle)cycle.quantity*=item.amount;continue;}
  if(!cycle){cycle={key:`${symbol}:${item.id}`,symbol,openedAt:item.executed_at,closedAt:null,buyCost:0,sellProceeds:0,quantity:0,pnl:null,returnPercent:null,days:null,tradeIds:[]};open.set(symbol,cycle);}
  cycle.tradeIds.push(item.id!);
  if(item.side==='BUY'){cycle.buyCost+=item.price*item.quantity;cycle.quantity+=item.quantity;}else{cycle.sellProceeds+=item.price*item.quantity;cycle.quantity-=item.quantity;}
  if(cycle.quantity<=1e-9*Math.max(1,item.quantity)){cycle.quantity=0;cycle.closedAt=item.executed_at;cycle.key+=`:${item.id}`;cycle.pnl=cycle.sellProceeds-cycle.buyCost;cycle.returnPercent=cycle.buyCost>0?cycle.pnl/cycle.buyCost*100:null;cycle.days=(Date.parse(item.executed_at)-Date.parse(cycle.openedAt))/86400000;closed.push(cycle);open.delete(symbol);}
 }
 return {closed:closed.reverse(),open:[...open.values()]};
}
export function reviewStats(rows:RoundTrip[]){
 const pnl=rows.map(r=>r.pnl!).filter(Number.isFinite),wins=pnl.filter(v=>v>0),losses=pnl.filter(v=>v<0),sum=(a:number[])=>a.reduce((s,v)=>s+v,0),average=(a:number[])=>a.length?sum(a)/a.length:null;
 return {count:pnl.length,winRate:pnl.length?wins.length/pnl.length*100:null,pnl:sum(pnl),averageWin:average(wins),averageLoss:average(losses),averageDays:average(rows.map(r=>r.days!).filter(Number.isFinite))};
}

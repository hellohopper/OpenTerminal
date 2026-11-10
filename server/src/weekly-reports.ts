import { z } from "zod";
import { db } from "./db.js";
import { records, addRecord, removeRecord, updateRecord } from "./records.js";
import { ledgerData } from "./ledger-data.js";
import { replayLedger, type Trade, type CashEvent } from "./portfolio.js";
import { dailyHistory, closedDaily } from "./daily-history.js";
import { getQuotes } from "./routes/market.js";
import { mapWithConcurrency } from "./concurrency.js";
import { digest } from "./workflow-research.js";
export const weeklySchema=z.object({portfolioId:z.number().int().positive(),week:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),priceBasis:z.enum(["raw","split-adjusted","unverified"])});
export type WeeklyInput=z.infer<typeof weeklySchema>;
export function weekBounds(week:string,now=new Date()){
 const from=new Date(`${week}T00:00:00Z`);if(!Number.isFinite(from.getTime())||from.toISOString().slice(0,10)!==week||from.getUTCDay()!==1)throw new Error("Choose a Monday in UTC.");
 const until=new Date(from.getTime()+7*86400000);if(until.getTime()>now.getTime())throw new Error("Choose a completed UTC week.");
 return {from:from.toISOString(),until:until.toISOString(),startDate:new Date(from.getTime()-86400000).toISOString().slice(0,10),endDate:new Date(until.getTime()-86400000).toISOString().slice(0,10)};
}
export function lastCompleteWeek(now=new Date()){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7)-7);return d.toISOString().slice(0,10);}
export function calculateWeek(trades:Trade[],events:CashEvent[],histories:Record<string,{time:number;close:number}[]>,input:WeeklyInput,now=new Date()){
 const bounds=weekBounds(input.week,now),before=(at:string)=>Date.parse(at)<Date.parse(bounds.from),through=(at:string)=>Date.parse(at)<Date.parse(bounds.until),inside=(at:string)=>!before(at)&&through(at);
 const opening=replayLedger(trades.filter(t=>before(t.executed_at)),events.filter(e=>before(e.executed_at))),closing=replayLedger(trades.filter(t=>through(t.executed_at)),events.filter(e=>through(e.executed_at)));
 const timeline=[...trades.filter(t=>through(t.executed_at)).map(t=>({at:t.executed_at,id:t.id??0,event:false,flow:(t.side==="BUY"?-1:1)*t.quantity*t.price})),...events.filter(e=>through(e.executed_at)).map(e=>({at:e.executed_at,id:e.id??0,event:true,flow:e.kind==="SPLIT"?0:e.kind==="WITHDRAWAL"?-e.amount:e.amount}))].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(a.event===b.event?a.id-b.id:a.event?-1:1));
 let cashBalance=0,unfunded=false;for(const item of timeline){cashBalance+=item.flow;if(cashBalance< -1e-6)unfunded=true;}
 const weeklyTrades=trades.filter(t=>inside(t.executed_at)),weeklyEvents=events.filter(e=>inside(e.executed_at));
 const splits=events.filter(e=>e.kind==="SPLIT"),warnings:string[]=[];
 if(splits.length&&input.priceBasis==="unverified")warnings.push("Confirm raw or split-adjusted history before valuing a ledger with splits.");
 if(unfunded||opening.cash< -1e-6||closing.cash< -1e-6||!events.some(e=>e.kind==="DEPOSIT"&&through(e.executed_at)))warnings.push("Record complete funding; negative cash or missing deposits prevent a complete report.");
 const symbols=[...new Set([...opening.positions.keys(),...closing.positions.keys(),...weeklyTrades.map(t=>t.symbol),...weeklyEvents.flatMap(e=>e.symbol?[e.symbol]:[])])];
 const priceAt=(symbol:string,date:string)=>{
  if(input.priceBasis==="unverified"&&splits.some(e=>e.symbol===symbol))return null;
  const bar=(histories[symbol]??[]).filter(b=>new Date(b.time*1000).toISOString().slice(0,10)<=date&&Number.isFinite(b.close)&&b.close>0).sort((a,b)=>a.time-b.time).at(-1);
  if(!bar||Date.parse(date)-Date.parse(new Date(bar.time*1000).toISOString().slice(0,10))>7*86400000)return null;
  const factor=input.priceBasis==="split-adjusted"?splits.filter(e=>e.symbol===symbol&&e.executed_at.slice(0,10)>new Date(bar.time*1000).toISOString().slice(0,10)).reduce((n,e)=>n*e.amount,1):1;
  return {price:bar.close*factor,observedDate:new Date(bar.time*1000).toISOString().slice(0,10)};
 };
 const rows=symbols.map(symbol=>{
  const startQty=opening.positions.get(symbol)?.quantity??0,endQty=closing.positions.get(symbol)?.quantity??0,start=priceAt(symbol,bounds.startDate),end=priceAt(symbol,bounds.endDate);
  const startValue=startQty===0?0:start?startQty*start.price:null,endValue=endQty===0?0:end?endQty*end.price:null;
  const bought=weeklyTrades.filter(t=>t.symbol===symbol&&t.side==="BUY").reduce((s,t)=>s+t.quantity*t.price,0),sold=weeklyTrades.filter(t=>t.symbol===symbol&&t.side==="SELL").reduce((s,t)=>s+t.quantity*t.price,0),dividends=weeklyEvents.filter(e=>e.kind==="DIVIDEND"&&e.symbol===symbol).reduce((s,e)=>s+e.amount,0);
  if(startValue===null||endValue===null)warnings.push(`Missing boundary prices: ${symbol}.`);
  return {symbol,startQty,endQty,startValue,endValue,startPrice:start,endPrice:end,bought,sold,dividends,contribution:startValue===null||endValue===null?null:endValue-startValue-bought+sold+dividends};
 });
 const externalFlows=weeklyEvents.filter(e=>e.kind==="DEPOSIT"||e.kind==="WITHDRAWAL").reduce((s,e)=>s+(e.kind==="DEPOSIT"?e.amount:-e.amount),0);
 const complete=warnings.length===0,openingNav=complete?opening.cash+rows.reduce((s,r)=>s+r.startValue!,0):null,closingNav=complete?closing.cash+rows.reduce((s,r)=>s+r.endValue!,0):null,pnl=openingNav===null||closingNav===null?null:closingNav-openingNav-externalFlows;
 return {...bounds,week:input.week,portfolioId:input.portfolioId,priceBasis:input.priceBasis,openingNav,closingNav,pnl,externalFlows,cash:{opening:opening.cash,closing:closing.cash},rows,transactions:weeklyTrades,events:weeklyEvents,warnings,
 method:"USD ledger, UTC Monday through Sunday. Boundary prices are latest supplied closes within seven calendar days. Contribution = ending value − starting value − buys + sells + dividends. External deposits/withdrawals are excluded from P&L; no time-weighted return is implied. Fees and FX are outside this USD ledger. Price adjustment basis is user-declared."};
}
export async function generateWeekly(input:WeeklyInput,scheduled?:{id:number;version:number}){
 weekBounds(input.week);const ledger=await db.transaction(()=>ledgerData(input.portfolioId))(),hash=digest(ledger);
 if(ledger.trades.length+ledger.events.length>5000)throw new Error("Weekly reporting supports up to 5000 ledger entries.");
 const symbols=[...new Set([...ledger.trades.map(t=>t.symbol),...ledger.events.flatMap(e=>e.symbol?[e.symbol]:[])])];if(symbols.length>30)throw new Error("Weekly reporting supports up to 30 symbols.");
 const histories=Object.fromEntries(await mapWithConcurrency(symbols,3,async symbol=>[symbol,await dailyHistory(symbol).then(rows=>closedDaily(rows)).catch(()=>[])] as const));
 const quotes=await getQuotes(symbols,{allowStale:false,includeFundamentals:false}).catch(()=>[]);
 const result=calculateWeek(ledger.trades,ledger.events,histories,input);
 const unknownCurrency=symbols.filter(s=>quotes.find(q=>q.symbol===s)?.currency!=="USD");
 if(unknownCurrency.length){result.warnings.push(`Current USD denomination could not be verified: ${unknownCurrency.join(", ")}. Totals and affected contributions withheld.`);result.openingNav=result.closingNav=result.pnl=null;for(const row of result.rows)if(unknownCurrency.includes(row.symbol)){row.contribution=row.startValue=row.endValue=null;}}
 const guards=(await records<any>("portfolio-guard")).filter(r=>r.payload.portfolioId===input.portfolioId),riskEvents=[];
 for(const guard of guards)for(const observation of await records<any>(`portfolio-guard-check:${guard.id}`)){const at=observation.payload.result?.asOf??observation.updated_at;if(at>=result.from&&at<result.until&&observation.payload.result?.status==="violated")riskEvents.push({name:guard.payload.name,at,result:observation.payload.result});}
 const reviews=(await records<any>("thesis")).filter(r=>symbols.includes(r.payload.symbol)&&["active","watching"].includes(r.payload.status)&&r.payload.reviewDate<=new Date().toISOString().slice(0,10)).map(r=>({id:r.id,symbol:r.payload.symbol,title:r.payload.title,reviewDate:r.payload.reviewDate}));
 const report={...result,generatedAt:new Date().toISOString(),ledgerChecksum:hash,riskEvents,reviews,coverage:"Risk events include only retained observations for current policies. Due theses are evaluated at report generation, not reconstructed historically. History provider adjustment changes can affect later regenerations; saved reports are immutable."};
 return db.transaction(async()=>{
  if(digest(await ledgerData(input.portfolioId))!==hash)throw new Error("Ledger changed while generating the report. Retry.");
  const schedule=scheduled?(await records<WeeklySchedule>("weekly-schedule")).find(r=>r.id===scheduled.id):undefined;
  if(scheduled&&(!schedule||schedule.version!==scheduled.version||!schedule.payload.enabled))throw new Error("Weekly schedule changed during generation. The report was not saved.");
  const id=await addRecord("weekly-report",report);
  // Commit the report and schedule acknowledgement together; a restart cannot duplicate a successful week.
  if(schedule)await updateRecord("weekly-schedule",schedule.id,schedule.version,{...schedule.payload,lastWeek:input.week,attemptedAt:report.generatedAt,error:undefined,reportId:id});
  for(const old of (await records("weekly-report")).slice(100))await removeRecord("weekly-report",old.id);
  return {id,...report};
 })();
}
export type WeeklySchedule={portfolioId:number;enabled:boolean;priceBasis:WeeklyInput["priceBasis"];lastWeek?:string;attemptedAt?:string;error?:string;reportId?:number};
export function createWeeklyScheduler(generate=generateWeekly,clock=()=>new Date()){
 let timer:ReturnType<typeof setInterval>|undefined,running:Promise<unknown>|undefined,stopped=false;
 const check=()=>{if(running)return running;running=(async()=>{
  const now=clock(),week=lastCompleteWeek(now);
  for(const row of await records<WeeklySchedule>("weekly-schedule")){
   if(stopped)break;const s=row.payload;if(!s.enabled||s.lastWeek===week||now.getTime()-Date.parse(s.attemptedAt??"1970-01-01")<3600000)continue;
   let reportId:number|undefined,error:string|undefined;try{reportId=(await generate({portfolioId:s.portfolioId,priceBasis:s.priceBasis,week},{id:row.id,version:row.version})).id;}catch(e){error=(e as Error).message;}
   if(stopped)break;await db.transaction(async()=>{const latest=(await records("weekly-schedule")).find(r=>r.id===row.id);if(latest?.version!==row.version)return;await updateRecord("weekly-schedule",row.id,row.version,{...s,attemptedAt:now.toISOString(),error,reportId,...(reportId?{lastWeek:week}:{})});})();
  }
 })().finally(()=>{running=undefined;});return running;};
 return {check,start(){stopped=false;if(timer)return;timer=setInterval(()=>void check().catch(()=>{}),3600000);timer.unref();void check().catch(()=>{});},async stop(){stopped=true;clearInterval(timer);timer=undefined;await running;}};
}
export const weeklyScheduler=createWeeklyScheduler();

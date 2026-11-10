import { z } from "zod";
import { db } from "./db.js";
import { records, addRecord, updateRecord, removeRecord } from "./records.js";
import { symbolSchema } from "./validation.js";
import { getQuotes } from "./routes/market.js";
import { dailyHistory, closedDaily } from "./daily-history.js";
import { ledgerData } from "./ledger-data.js";
import { replayLedger } from "./portfolio.js";
import { earningsCalendar } from "./providers/tradingview.js";
import { cached } from "./cache.js";
import { digest } from "./workflow-research.js";
export const compoundSchema=z.object({name:z.string().trim().min(1).max(100),symbol:symbolSchema,portfolioId:z.number().int().positive().optional(),enabled:z.boolean(),mode:z.enum(["all","any"]),trigger:z.enum(["crossing","sustained","close"]),sustainMinutes:z.number().int().min(1).max(120),cooldownMinutes:z.number().int().min(1).max(10080),conditions:z.array(z.object({metric:z.enum(["price","breakout20","relativeVolume20","heldQuantity","earningsDays"]),operator:z.enum(["gte","lte"]),threshold:z.number().finite().min(-1e12).max(1e12)})).min(1).max(6)}).refine(r=>!r.conditions.some(c=>c.metric==="heldQuantity")||!!r.portfolioId,"Select an account for the holding condition.");
export type Evidence={value:number|null;source:string;asOf:string|null;valid:boolean;reason?:string};
export type CompoundRule=z.infer<typeof compoundSchema>;
export type CompoundResult={status:"met"|"unmet"|"unknown";evidence:(Evidence&CompoundRule["conditions"][number]&{satisfied:boolean|null})[];sample:string;checkedAt:string};
export type CompoundState={lastResult?:CompoundResult;metSince?:string;lastNotifiedAt?:string;notifiedEpisode?:boolean;lastClose?:string};
export function evaluateCompound(rule:CompoundRule,metrics:Record<string,Evidence>,now=new Date()):CompoundResult{
 const evidence=rule.conditions.map(c=>{const m=metrics[c.metric]??{value:null,source:"unavailable",asOf:null,valid:false};const usable=m.valid&&m.value!==null&&Number.isFinite(m.value);return {...c,...m,satisfied:usable?(c.operator==="gte"?m.value!>=c.threshold:m.value!<=c.threshold):null};});
 const states=evidence.map(e=>e.satisfied),status=rule.mode==="all"?(states.includes(false)?"unmet":states.every(s=>s===true)?"met":"unknown"):(states.includes(true)?"met":states.every(s=>s===false)?"unmet":"unknown");
 return {status,evidence,sample:digest(evidence.map(e=>[e.metric,e.value,e.asOf])),checkedAt:now.toISOString()};
}
export function advanceCompound(rule:CompoundRule,state:CompoundState,result:CompoundResult,now=new Date()){
 const gap=!state.lastResult||now.getTime()-Date.parse(state.lastResult.checkedAt)>5*60000;
 const metSince=result.status==="met"?(state.lastResult?.status==="met"&&!gap?state.metSince:now.toISOString()):undefined;
 // Unknown observations break a sustained interval but never re-arm a fired crossing.
 let notifiedEpisode=result.status==="unmet"?false:state.notifiedEpisode??false;
 const closeDate=result.evidence.filter(e=>["price","breakout20","relativeVolume20"].includes(e.metric)).map(e=>e.asOf).filter(Boolean).sort().at(-1)??null;
 const cooldown=now.getTime()-Date.parse(state.lastNotifiedAt??"1970-01-01")>=rule.cooldownMinutes*60000;
 const ready=rule.trigger==="close"?!!closeDate&&closeDate!==state.lastClose:!notifiedEpisode&&(rule.trigger!=="sustained"||now.getTime()-Date.parse(metSince??now.toISOString())>=rule.sustainMinutes*60000);
 const notify=result.status==="met"&&ready&&cooldown;
 if(notify)notifiedEpisode=true;
 return {notify,state:{lastResult:result,metSince,notifiedEpisode,lastClose:notify&&rule.trigger==="close"?closeDate!:state.lastClose,lastNotifiedAt:notify?now.toISOString():state.lastNotifiedAt}};
}
export async function compoundEvidence(rule:CompoundRule):Promise<Record<string,Evidence>>{
 const now=new Date(),metrics:Record<string,Evidence>={},needed=new Set(rule.conditions.map(c=>c.metric));
 if(needed.has("price")&&rule.trigger!=="close"){
  const q=(await getQuotes([rule.symbol],{allowStale:false,includeFundamentals:false}).catch(()=>[]))[0],age=now.getTime()-Date.parse(q?.retrievedAt??"");
  metrics.price={value:q?.price??null,source:q?.source??"unavailable",asOf:q?.retrievedAt??null,valid:!!q&&!q.stale&&age>=0&&age<=120000&&!!q.price,reason:"Retrieval time; provider observation time may be unknown. Price uses the quote currency."};
 }
 if(rule.trigger==="close"||needed.has("breakout20")||needed.has("relativeVolume20")){
  try{
   const bars=closedDaily(await dailyHistory(rule.symbol),now),last=bars.at(-1),prior=bars.slice(-21,-1),asOf=last?new Date(last.time*1000).toISOString():null,fresh=!!last&&now.getTime()-last.time*1000<=7*86400000;
   const metric=(value:number|null,valid:boolean):Evidence=>({value,source:"Supplied completed daily bars",asOf,valid,reason:"Excludes today's UTC date; no independent exchange-calendar completeness guarantee."});
   if(rule.trigger==="close")metrics.price=metric(last?.close??null,fresh);
   metrics.breakout20=metric(last&&prior.length===20?Number(last.close>Math.max(...prior.map(b=>b.high))):null,fresh&&prior.length===20);
   const average=prior.reduce((s,b)=>s+b.volume,0)/20;
   metrics.relativeVolume20=metric(last&&average>0?last.volume/average:null,fresh&&prior.length===20&&average>0);
  }catch{/* Missing history stays unknown. */}
 }
 if(needed.has("heldQuantity")&&rule.portfolioId){try{const ledger=await db.transaction(()=>ledgerData(rule.portfolioId!))(),state=replayLedger(ledger.trades,ledger.events);metrics.heldQuantity={value:state.positions.get(rule.symbol)?.quantity??0,source:`Portfolio #${rule.portfolioId}`,asOf:now.toISOString(),valid:true};}catch{/* Unknown account */}}
 if(needed.has("earningsDays")){try{const data=await cached(`compound-earnings:${rule.symbol}`,3600000,()=>earningsCalendar([rule.symbol])),event=data.find(e=>e.symbol===rule.symbol)?.nextEarningsDate,days=event?Math.ceil((event*1000-now.getTime())/86400000):null;metrics.earningsDays={value:days,source:"Expected earnings calendar",asOf:now.toISOString(),valid:days!==null&&days>=0,reason:"Expected date; release session unverified."};}catch{/* Unknown calendar */}}
 return metrics;
}
export function createCompoundMonitor(load=compoundEvidence,clock=()=>new Date()){
 let timer:ReturnType<typeof setInterval>|undefined,inFlight:Promise<unknown>|undefined,last=0,stopped=false;
 const check=()=>{if(inFlight)return inFlight;inFlight=(async()=>{
  const rules=await records<CompoundRule&CompoundState>("compound-rule");
  if(!rules.some(r=>r.payload.enabled))return {checked:0};
  const now=clock();if(last&&now.getTime()-last<60000)return {deferred:true};last=now.getTime();let checked=0;
  for(const row of rules){
   if(stopped)break;if(!row.payload.enabled)continue;
   const metrics=await load(row.payload).catch(()=>({}));if(stopped)break;
   const result=evaluateCompound(row.payload,metrics,clock()),next=advanceCompound(row.payload,row.payload,result,clock());
   await db.transaction(async()=>{
    const fresh=(await records("compound-rule")).find(r=>r.id===row.id);if(fresh?.version!==row.version)return;
    await updateRecord("compound-rule",row.id,row.version,{...row.payload,...next.state});
    await addRecord(`compound-observation:${row.id}`,{rule:row.payload.name,ruleVersion:row.version,result});
    for(const old of (await records(`compound-observation:${row.id}`)).slice(20))await removeRecord(`compound-observation:${row.id}`,old.id);
    if(next.notify){const notes=await records("notification");if(notes.length>=500)await removeRecord("notification",notes.at(-1)!.id);await addRecord("notification",{title:`${row.payload.symbol} compound alert`,body:`${row.payload.name}: ${result.evidence.map(e=>`${e.metric}=${e.value??"unknown"}`).join(", ")}`,symbol:row.payload.symbol,sourceKey:`compound:${row.id}:${row.version}`,createdAt:clock().toISOString(),read:false,researchTarget:{kind:"compound-rule",id:row.id}},`compound:${row.id}:${row.version}`);}
   })();checked++;
  }return {checked};
 })().finally(()=>{inFlight=undefined;});return inFlight;};
 return {check,start(){if(timer)return;stopped=false;timer=setInterval(()=>void check().catch(()=>{}),60000);timer.unref();void check().catch(()=>{});},async stop(){stopped=true;clearInterval(timer);timer=undefined;await inFlight;}};
}
export const compoundMonitor=createCompoundMonitor();

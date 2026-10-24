import {z} from 'zod';
import type {Candle} from './providers/yahoo.js';
import {dailyHistory,closedDaily} from './daily-history.js';
import {records,addRecord,updateRecord} from './records.js';
import {db} from './db.js';
import {symbolSchema} from "./validation.js";
export {symbolSchema} from "./validation.js";
export const signalSchema=z.object({name:z.string().trim().min(1).max(100),symbols:z.array(symbolSchema).min(1).max(20).transform(v=>[...new Set(v)]),conditions:z.array(z.object({type:z.enum(['SMA_CROSS_UP','RSI_RECOVER','BREAKOUT','VOLUME_ABOVE']),period:z.number().int().min(2).max(100),threshold:z.number().finite().min(0).max(100)})).min(1).max(4),mode:z.enum(['crossing','daily']).default('crossing'),enabled:z.boolean().default(true)});
export type SignalRule=z.infer<typeof signalSchema>;
const mean=(a:number[])=>a.reduce((s,v)=>s+v,0)/a.length;
function rsi(rows:Candle[],period:number):number|null {
  if(rows.length<=period)return null;
  let gain=0,loss=0;
  for(let i=1;i<rows.length;i++){const d=rows[i].close-rows[i-1].close;if(i<=period){gain+=Math.max(0,d)/period;loss+=Math.max(0,-d)/period;}else{gain=(gain*(period-1)+Math.max(0,d))/period;loss=(loss*(period-1)+Math.max(0,-d))/period;}}
  return loss===0?(gain===0?50:100):100-100/(1+gain/loss);
}
export function evaluateSignal(rule:SignalRule,rows:Candle[]) {
  const last=rows.at(-1);if(!last)throw new Error('No completed daily candles.');
  const evidence=rule.conditions.map(c=>{
    if(rows.length<c.period+2)throw new Error(`Need at least ${c.period+2} daily candles.`);
    const previous=rows.slice(0,-1), prior=rows.at(-2)!;
    if(c.type==='SMA_CROSS_UP'){const current=mean(rows.slice(-c.period).map(r=>r.close)),before=mean(previous.slice(-c.period).map(r=>r.close));return {type:c.type,matched:last.close>current&&prior.close<=before,value:last.close,reference:current};}
    if(c.type==='RSI_RECOVER'){const value=rsi(rows,c.period)!,before=rsi(previous,c.period)!;return {type:c.type,matched:value>c.threshold&&before<=c.threshold,value,reference:c.threshold};}
    if(c.type==='BREAKOUT'){const high=Math.max(...previous.slice(-c.period).map(r=>r.high));return {type:c.type,matched:last.close>high,value:last.close,reference:high};}
    const average=mean(previous.slice(-c.period).map(r=>r.volume)),value=average>0?last.volume/average:0;return {type:c.type,matched:average>0&&value>=c.threshold,value,reference:c.threshold};
  });
  return {matched:evidence.every(e=>e.matched),date:new Date(last.time*1000).toISOString().slice(0,10),price:last.close,evidence};
}
export const SIGNAL_CATCHUP_LIMIT=30;
export function signalCatchup(rule:SignalRule,candles:Candle[],previous?:{date:string;matched:boolean}) {
  const dates=candles.map(c=>new Date(c.time*1000).toISOString().slice(0,10)),latest=dates.at(-1);
  if(!latest)throw new Error('No completed daily candles.');
  if(previous&&previous.date>latest)throw new Error('History ends before the saved checkpoint; checkpoint kept.');
  if(previous?.date===latest)return {results:[],remaining:0,warning:null};
  const index=previous?dates.indexOf(previous.date):-1;
  // A missing checkpoint means coverage cannot be established. Keep it until the source is repaired.
  if(previous&&index<0)throw new Error(`Checkpoint ${previous.date} missing from supplied history; no days skipped. Restore historical coverage before retrying.`);
  const start=previous?index+1:candles.length-1,end=Math.min(candles.length,start+SIGNAL_CATCHUP_LIMIT);
  const results=[];let matched=previous?.matched??false;
  for(let i=start;i<end;i++){
    const result=evaluateSignal(rule,candles.slice(0,i+1));
    const fire=result.matched&&(rule.mode==='daily'||!matched);
    results.push({...result,fire,historical:!!previous&&(start<candles.length-1||i<candles.length-1)});matched=result.matched;
  }
  const gap=previous&&dates.slice(start,end).some((date,i)=>Date.parse(date)-Date.parse(dates[start+i-1])>7*86400000);
  return {results,remaining:candles.length-end,warning:gap?'Supplied history has a gap over seven calendar days; missing sessions cannot be reconstructed.':null};
}
export function createSignalMonitor(load=dailyHistory,clock=()=>new Date()) {
  let timer:ReturnType<typeof setInterval>|undefined,inFlight:Promise<unknown>|undefined,lastCheck=0;
  const check=()=>{
    if(inFlight)return inFlight;
    if(Date.now()-lastCheck<60000)return Promise.resolve({deferred:true});
    lastCheck=Date.now();
    inFlight=(async()=>{
      let triggered=0;const errors:string[]=[];
      const snapshots=await records<SignalRule & {state?:Record<string,{date:string;matched:boolean}>}>('signal');
      for(const row of snapshots.filter(r=>r.payload.enabled)){
        const next={...row.payload,state:{...row.payload.state}};
        const events:unknown[]=[],ruleErrors:string[]=[],warnings:string[]=[];let processed=0,remaining=0;
        for(const symbol of row.payload.symbols)try{
          const candles=closedDaily(await load(symbol),clock()),last=candles.at(-1);
          if(!last||clock().getTime()-last.time*1000>7*86400000)throw new Error('Recent completed candles unavailable');
          const batch=signalCatchup(row.payload,candles,next.state[symbol]);
          if(batch.warning)warnings.push(`${symbol}: ${batch.warning}`);remaining+=batch.remaining;
          for(const result of batch.results){
            if(result.fire)events.push({symbol,ruleId:row.id,name:row.payload.name,...result,detectedAt:clock().toISOString()});
            next.state[symbol]={date:result.date,matched:result.matched};processed++;
          }
        }catch(e){const message=`${symbol}: ${(e as Error).message}`;errors.push(message);ruleErrors.push(message);}
        try{await db.transaction(async()=>{await updateRecord('signal',row.id,row.version,{...next,monitor:{checkedAt:clock().toISOString(),processed,remaining,errors:ruleErrors,warnings}});for(const event of events){const e=event as {symbol:string;date:string};await addRecord('signal-event',event,`${row.id}:${e.symbol}:${e.date}`);}await db.prepare("DELETE FROM research_records WHERE kind='signal-event' AND id NOT IN (SELECT id FROM research_records WHERE kind='signal-event' ORDER BY id DESC LIMIT 500)").run();})();triggered+=events.length;}catch{errors.push(`${row.payload.name}: rule changed; retry on next check`);}
      }
      return {triggered,errors,checkedAt:clock().toISOString()};
    })().finally(()=>{inFlight=undefined;});return inFlight;
  };
  return {check,start(){if(timer)return;timer=setInterval(()=>void check().catch(()=>{}),300000);timer.unref();void check().catch(()=>{});},async stop(){clearInterval(timer);timer=undefined;await inFlight;}};
}
export const signalMonitor=createSignalMonitor();

import {cacheGet,cacheSet} from './cache.js';
import {withFallback} from './providers/registry.js';
import * as nasdaq from './providers/nasdaq.js';
import * as yahoo from './providers/yahoo.js';
import type {Candle} from './providers/yahoo.js';
/** Fresh retrieval cache only: never substitute stale data for signal decisions. */
export async function dailyHistory(symbol:string):Promise<Candle[]> {
  const key=`research-daily:${symbol}`;
  const hit=cacheGet<Candle[]>(key);if(hit)return hit;
  const rows=await withFallback<Candle[]>([['nasdaq',()=>nasdaq.history(symbol,'1Y')],['yahoo',()=>yahoo.history(symbol,'1y','1d')]]);
  cacheSet(key,rows,300000);return rows;
}
export function closedDaily(rows:Candle[],now=new Date()):Candle[] {
  const today=now.toISOString().slice(0,10), byDate=new Map<string,Candle>();
  for(const r of rows){
    if(![r.time,r.open,r.high,r.low,r.close,r.volume].every(Number.isFinite)||r.close<=0||r.open<=0||r.high<Math.max(r.open,r.close)||r.low>Math.min(r.open,r.close)||r.low<=0||r.volume<0)throw new Error('Invalid daily OHLCV data.');
    const day=new Date(r.time*1000).toISOString().slice(0,10);
    if(day<today){if(byDate.has(day))throw new Error('Duplicate daily candles.');byDate.set(day,r);}
  }
  return [...byDate.values()].sort((a,b)=>a.time-b.time);
}

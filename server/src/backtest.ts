import {z} from 'zod';
import {symbolSchema} from './validation.js';
import {closedDaily} from './daily-history.js';
import type {Candle} from './providers/yahoo.js';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v,'Invalid date');
export const backtestSchema=z.object({symbol:symbolSchema,template:z.enum(['sma','breakout']),from:date,to:date,fast:z.number().int().min(2).max(100),slow:z.number().int().min(3).max(150),lookback:z.number().int().min(2).max(100),capital:z.number().finite().min(100).max(1e9),fee:z.number().finite().min(0).max(1000),slippageBps:z.number().finite().min(0).max(500)}).refine(v=>v.from<=v.to&&v.to<new Date().toISOString().slice(0,10)&&v.fast<v.slow,'Start must precede end; fast period must be shorter than slow.');
export type BacktestInput=z.infer<typeof backtestSchema>;
const mean=(rows:Candle[],end:number,period:number)=>rows.slice(end-period+1,end+1).reduce((s,r)=>s+r.close,0)/period;
export function backtestDecision(rows:Candle[],index:number,p:BacktestInput){
 const c=rows[index],fast=mean(rows,index,p.fast);
 if(p.template==='sma'){const slow=mean(rows,index,p.slow),priorFast=mean(rows,index-1,p.fast),priorSlow=mean(rows,index-1,p.slow);return {buy:fast>slow&&priorFast<=priorSlow,sell:fast<slow&&priorFast>=priorSlow,evidence:{fast,slow,priorFast,priorSlow}};}
 const priorHigh=Math.max(...rows.slice(index-p.lookback,index).map(r=>r.high));return {buy:c.close>priorHigh,sell:c.close<fast,evidence:{fast,priorHigh}};
}
export function runBacktest(raw:Candle[],input:BacktestInput,now=new Date()){
 if(raw.length>5000)throw new Error('At most 5000 daily candles are supported.');
 const rows=closedDaily(raw,now).filter(r=>new Date(r.time*1000).toISOString().slice(0,10)<=input.to),day=(r:Candle)=>new Date(r.time*1000).toISOString().slice(0,10),warmup=(input.template==='sma'?input.slow:Math.max(input.fast,input.lookback))+1,start=rows.findIndex(r=>day(r)>=input.from),last=rows.at(-1);
 if(!last||start<0||start<warmup)throw new Error(`Insufficient history: need ${warmup} prior daily bars for warmup.`);
 if(Date.parse(day(rows[start]))-Date.parse(input.from)>5*86400000||Date.parse(input.to)-Date.parse(day(last))>5*86400000)throw new Error('Requested date range is not covered by the available daily history.');
 if(rows.length-start<2)throw new Error('Select at least two completed daily bars.');
 for(let i=Math.max(1,start-warmup);i<rows.length;i++)if(rows[i].time-rows[i-1].time>7*86400)throw new Error('History has a gap larger than seven calendar days. No prices are filled.');
 let cash=input.capital,quantity=0,entryCost=0,peak=input.capital,worst=0,realized=0,closed=0,wins=0;
 const executions:{date:string;signalDate:string;side:'BUY'|'SELL';quantity:number;price:number;fee:number;pnl:number|null}[]=[],curve:{date:string;nav:number;strategy:number;benchmark:number;drawdown:number;close:number;signal:string;quantity:number;cash:number}[]=[];
 const slippage=input.slippageBps/10000,benchmarkShares=input.capital/rows[start].open;
 for(let i=start;i<rows.length;i++){
  const candle=rows[i],decision=backtestDecision(rows,i-1,input);let signal='HOLD';
  if(quantity===0&&decision.buy&&cash>input.fee){const price=candle.open*(1+slippage);quantity=(cash-input.fee)/price;entryCost=cash;cash=0;signal='BUY';executions.push({date:day(candle),signalDate:day(rows[i-1]),side:'BUY',quantity,price,fee:input.fee,pnl:null});}
  else if(quantity>0&&decision.sell){const price=candle.open*(1-slippage),proceeds=quantity*price-input.fee;if(proceeds<0)throw new Error('Sale fee exceeds proceeds for this scenario.');const pnl=proceeds-entryCost;cash+=proceeds;realized+=pnl;closed++;if(pnl>0)wins++;signal='SELL';executions.push({date:day(candle),signalDate:day(rows[i-1]),side:'SELL',quantity,price,fee:input.fee,pnl});quantity=0;entryCost=0;}
  const nav=cash+quantity*candle.close;if(!Number.isFinite(nav)||nav<0)throw new Error('Scenario exceeded supported numeric limits.');peak=Math.max(peak,nav);const drawdown=(nav/peak-1)*100;worst=Math.min(worst,drawdown);curve.push({date:day(candle),nav,strategy:nav/input.capital*100,benchmark:benchmarkShares*candle.close/input.capital*100,drawdown,close:candle.close,signal,quantity,cash});
 }
 const warnings=['Price-only illustration: provider split/dividend adjustment basis is unspecified. Corporate actions and dividends are not modeled.','Benchmark is the same asset bought at the first simulated open, before fees/slippage. Open positions are marked at the final close without forced liquidation.','Only supplied daily observations are used; exchange-calendar completeness is not independently verified.'];
 if(rows.slice(Math.max(1,start)).some((r,j)=>Math.abs(r.close/rows[Math.max(1,start)+j-1].close-1)>0.4))warnings.push('A price discontinuity exceeds 40%; inspect for splits or bad data before interpreting results.');
 return {input,actualFrom:curve[0].date,actualTo:curve.at(-1)!.date,warmupBars:start,metrics:{endingNav:curve.at(-1)!.nav,returnPercent:curve.at(-1)!.strategy-100,benchmarkReturnPercent:curve.at(-1)!.benchmark-100,maxDrawdown:worst,closedTrades:closed,winRate:closed?wins/closed*100:null,realizedPnl:realized,openQuantity:quantity},rows:curve,executions,warnings};
}
export type BacktestResult=ReturnType<typeof runBacktest>;

import {z} from 'zod';import {symbolSchema} from './validation.js';
export const targetSchema=z.array(z.object({symbol:symbolSchema,weight:z.number().finite().min(0).max(100)})).min(1).max(30).refine(v=>new Set(v.map(t=>t.symbol)).size===v.length,'Duplicate target symbol').refine(v=>v.reduce((s,t)=>s+t.weight,0)<=100+1e-8,'Target weights must total at most 100%; remainder is cash.');
export const rebalanceSchema=z.object({targets:targetSchema,newCash:z.number().finite().min(0).max(1e12),wholeShares:z.boolean().default(false),allowSales:z.boolean().default(true)});
export type RebalanceInput=z.infer<typeof rebalanceSchema>;
export function rebalance(holdings:{symbol:string;quantity:number;price:number;sector:string}[],cash:number,input:RebalanceInput){
 if(!Number.isFinite(cash)||cash< -1e-6)throw new Error('Record funding first: ledger cash is negative.');
 if(holdings.some(p=>![p.quantity,p.price].every(Number.isFinite)||p.quantity<0||p.price<=0))throw new Error('Complete positive USD prices are required.');
 const before=cash+holdings.reduce((s,p)=>s+p.quantity*p.price,0),nav=before+input.newCash;
 if(!Number.isFinite(nav)||nav<=0)throw new Error('Portfolio value must be positive.');
 const rows=holdings.map(p=>{const target=input.targets.find(t=>t.symbol===p.symbol)?.weight??0;const desired=nav*target/100/p.price-p.quantity;const delta=desired<0&&!input.allowSales?0:input.wholeShares?Math.sign(desired)*Math.floor(Math.abs(desired)+1e-10):desired;return {...p,target,beforeWeight:before>0?p.quantity*p.price/before*100:0,delta,afterQuantity:p.quantity,afterWeight:0};});
 let available=Math.max(0,cash)+input.newCash;
 for(const r of rows.filter(r=>r.delta<0)){r.delta=Math.max(r.delta,-r.quantity);available-=r.delta*r.price;}
 const demand=rows.filter(r=>r.delta>0).reduce((s,r)=>s+r.delta*r.price,0),scale=demand>available?available/demand:1;
 for(const r of rows.filter(r=>r.delta>0)){r.delta*=scale;if(input.wholeShares)r.delta=Math.floor(r.delta+1e-10);available-=r.delta*r.price;}
 for(const r of rows){r.afterQuantity=r.quantity+r.delta;r.afterWeight=r.afterQuantity*r.price/nav*100;}
 const sectors=[...new Set(rows.map(r=>r.sector))].map(sector=>({sector,beforeWeight:rows.filter(r=>r.sector===sector).reduce((s,r)=>s+r.beforeWeight,0),afterWeight:rows.filter(r=>r.sector===sector).reduce((s,r)=>s+r.afterWeight,0)}));
 return {beforeNav:before,afterNav:nav,beforeCash:cash,afterCash:Math.max(0,available),cashWeight:Math.max(0,available)/nav*100,rows,sectors,largestBefore:Math.max(0,...rows.map(r=>r.beforeWeight)),largestAfter:Math.max(0,...rows.map(r=>r.afterWeight))};
}

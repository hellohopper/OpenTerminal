import type {Quote} from './api';
export type Holding={symbol:string;quantity:number;avgCost:number;realizedPnl:number};
export function quoteQuality(q:Quote|undefined,now=Date.now()){
 if(!q||!Number.isFinite(q.price)||q.price!<=0)return 'Price unavailable';
 if(q.stale)return 'Provider refresh failed; cached fallback';
 const fetched=Date.parse(q.retrievedAt??'');
 if(!Number.isFinite(fetched))return 'Retrieval time unknown';
 if(fetched>now+300000||now-fetched>120000)return 'Quote retrieval expired';
 return null;
}
export function valueHolding(p:Holding,q:Quote|undefined,now=Date.now()){
 const reason=p.quantity===0?null:quoteQuality(q,now)??(q?.currency!=='USD'?'USD quote currency unverified':null);
 const last=reason?null:q?.price??null;
 return {reason,last,marketValue:p.quantity===0?0:last===null?null:last*p.quantity,unrealized:p.quantity===0?0:last===null?null:(last-p.avgCost)*p.quantity};
}
export function valuePortfolio(positions:Holding[],quotes:Quote[],now=Date.now()){
 const rows=positions.map(p=>({...p,...valueHolding(p,quotes.find(q=>q.symbol===p.symbol),now)}));
 const missing=rows.filter(r=>r.reason).map(r=>r.symbol);
 return {rows,missing,marketValue:missing.length?null:rows.reduce((s,p)=>s+p.marketValue!,0),unrealized:missing.length?null:rows.reduce((s,p)=>s+p.unrealized!,0),realized:rows.reduce((s,p)=>s+p.realizedPnl,0)};
}

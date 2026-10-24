type Account = {key:string;name:string;nav:number;cash:{currency:string;amount:number;value:number}[];positions:{symbol:string;currency:string;quantity:number;value:number}[]};
export function aggregateExposure(accounts:Account[],sectors:Record<string,string>) {
  const nav=accounts.reduce((sum,a)=>sum+a.nav,0);
  if(!Number.isFinite(nav)||nav<=0)throw new Error('Selected accounts need positive, fully valued NAV.');
  if(new Set(accounts.map(a=>a.key)).size!==accounts.length)throw new Error('An account cannot be counted twice.');
  const holdings=new Map<string,{symbol:string;currency:string;quantity:number;value:number;accounts:string[]}>(),currency=new Map<string,number>(),sector=new Map<string,number>();
  for(const account of accounts){
    if(!/^(portfolio|currency):\d+$/.test(account.key))throw new Error('Simulated accounts cannot be included in actual account exposure.');
    for(const c of account.cash)currency.set(c.currency,(currency.get(c.currency)??0)+c.value);
    for(const p of account.positions){
      const key=`${p.symbol}:${p.currency}`,row=holdings.get(key)??{symbol:p.symbol,currency:p.currency,quantity:0,value:0,accounts:[]};
      row.quantity+=p.quantity;row.value+=p.value;row.accounts.push(account.key);holdings.set(key,row);
      currency.set(p.currency,(currency.get(p.currency)??0)+p.value);
      const group=sectors[p.symbol]??'Unclassified';sector.set(group,(sector.get(group)??0)+p.value);
    }
  }
  const rows=[...holdings.values()].map(h=>({...h,sector:sectors[h.symbol]??'Unclassified',weight:h.value/nav*100})).sort((a,b)=>b.value-a.value);
  const bySymbol=new Map<string,number>();for(const r of rows)bySymbol.set(r.symbol,(bySymbol.get(r.symbol)??0)+r.value);
  return {nav,cash:accounts.reduce((s,a)=>s+a.cash.reduce((n,c)=>n+c.value,0),0),holdings:rows,largestPositionPercent:Math.max(0,...bySymbol.values())/nav*100,currencies:[...currency].map(([currency,value])=>({currency,value,weight:value/nav*100})),sectors:[...sector].map(([sector,value])=>({sector,value,weight:value/nav*100})),accounts:accounts.map(a=>({key:a.key,name:a.name,nav:a.nav,weight:a.nav/nav*100})),warnings:['Currency exposure uses quote/cash denomination, not company revenue currencies.','Select each economic account only once: imported copies and original portfolios cannot be identified automatically.','Paper and option simulation accounts are excluded. This is current exposure, not multicurrency historical volatility or correlation.']};
}

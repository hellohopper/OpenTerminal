"use client";
import {useEffect,useState} from 'react';import {useQuery} from '@tanstack/react-query';
import {apiGet,fmt,type Quote} from '../../lib/api';import {quoteQuality} from '../../lib/valuation';import {symbolsParam} from '../../lib/symbol';import {useTerminal} from '../../store/terminal';
type Status={providers:Array<{name:string;ok:number;failed:number;lastLatencyMs:number|null}>};
export default function QualityWidget(){
 const symbols=useTerminal(s=>s.watchlist),[now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const quotes=useQuery({queryKey:['quality-quotes',symbols.join(',')],queryFn:()=>apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`),enabled:!!symbols.length,refetchInterval:10000,retry:0});
 const status=useQuery({queryKey:['status'],queryFn:()=>apiGet<Status>('/api/status'),refetchInterval:30000});
 const rows=symbols.map(symbol=>{const quote=quotes.data?.find(q=>q.symbol===symbol);return {symbol,quote,reason:quoteQuality(quote,now)};});
 return <div className="p-2 space-y-2"><p className="amber">{rows.filter(r=>!r.reason).length} recently retrieved · {rows.filter(r=>r.quote?.stale).length} fallback · {rows.filter(r=>!r.quote).length} missing</p><p className="dim text-xs">Fresh retrieval describes the request, not exchange latency. Observation time can be missing or delayed. Portfolio totals additionally require verified USD quotes.</p>
 {quotes.error&&<p role="alert" className="down">Refresh failed: {quotes.error.message}. Previously displayed rows retain their original retrieval time.</p>}
 {!symbols.length&&<p>Add watchlist symbols to inspect their feeds.</p>}
 <table className="data-table"><thead><tr><th>Symbol</th><th>Last known</th><th>Currency</th><th>Feed</th><th>Retrieval age</th><th>Observed UTC</th><th>Status</th></tr></thead><tbody>{rows.map(({symbol,quote:q,reason})=><tr key={symbol}><td>{symbol}</td><td>{fmt(q?.price)}</td><td>{q?.currency??'unverified'}</td><td>{q?.source??'—'}</td><td>{q?.retrievedAt&&Number.isFinite(Date.parse(q.retrievedAt))?`${Math.max(0,Math.floor((now-Date.parse(q.retrievedAt))/1000))}s`:'unknown'}</td><td>{q?.time&&Number.isFinite(q.time)?new Date(q.time*1000).toISOString():'not supplied'}</td><td className={reason?'amber':'up'}>{reason??'Recently retrieved'}</td></tr>)}</tbody></table>
 <details><summary className="amber cursor-pointer">Provider requests since API start</summary><table className="data-table"><thead><tr><th>Feed</th><th>Success</th><th>Failure</th><th>Last latency</th></tr></thead><tbody>{status.data?.providers.map(p=><tr key={p.name}><td>{p.name}</td><td>{p.ok}</td><td>{p.failed}</td><td>{p.lastLatencyMs??'—'} ms</td></tr>)}</tbody></table></details></div>;
}

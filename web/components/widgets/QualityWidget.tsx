"use client";
import { useI18n } from "../../lib/use-i18n";

import {useEffect,useState} from 'react';import {useQuery} from '@tanstack/react-query';
import {apiGet,fmt,type Quote} from '../../lib/api';import {quoteQuality} from '../../lib/valuation';import {symbolsParam} from '../../lib/symbol';import {useTerminal} from '../../store/terminal';
type Status={providers:Array<{name:string;ok:number;failed:number;lastLatencyMs:number|null}>};
export default function QualityWidget(){
  const { t: ui } = useI18n();

 const symbols=useTerminal(s=>s.watchlist),[now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const quotes=useQuery({queryKey:['quality-quotes',symbols.join(',')],queryFn:()=>apiGet<Quote[]>(`/api/quotes?symbols=${symbolsParam(symbols)}`),enabled:!!symbols.length,refetchInterval:10000,retry:0});
 const status=useQuery({queryKey:['status'],queryFn:()=>apiGet<Status>('/api/status'),refetchInterval:30000});
 const rows=symbols.map(symbol=>{const quote=quotes.data?.find(q=>q.symbol===symbol);return {symbol,quote,reason:quoteQuality(quote,now)};});
 return <div className="p-2 space-y-2"><p className="amber">{rows.filter(r=>!r.reason).length} {ui("recently retrieved ·")} {rows.filter(r=>r.quote?.stale).length} {ui("fallback ·")} {rows.filter(r=>!r.quote).length} {ui("missing")}</p><p className="dim text-xs">{ui("Fresh retrieval describes the request, not exchange latency. Observation time can be missing or delayed. Portfolio totals additionally require verified USD quotes.")}</p>
 {quotes.error&&<p role="alert" className="down">{ui("Refresh failed:")} {quotes.error.message}{ui(". Previously displayed rows retain their original retrieval time.")}</p>}
 {!symbols.length&&<p>{ui("Add watchlist symbols to inspect their feeds.")}</p>}
 <table className="data-table"><thead><tr><th>{ui("Symbol")}</th><th>{ui("Last known")}</th><th>{ui("Currency")}</th><th>{ui("Feed")}</th><th>{ui("Retrieval age")}</th><th>{ui("Observed UTC")}</th><th>{ui("Status")}</th></tr></thead><tbody>{rows.map(({symbol,quote:q,reason})=><tr key={symbol}><td>{symbol}</td><td>{fmt(q?.price)}</td><td>{q?.currency??ui("unverified")}</td><td>{q?.source??'—'}</td><td>{q?.retrievedAt&&Number.isFinite(Date.parse(q.retrievedAt))?`${Math.max(0,Math.floor((now-Date.parse(q.retrievedAt))/1000))}s`:ui("unknown")}</td><td>{q?.time&&Number.isFinite(q.time)?new Date(q.time*1000).toISOString():ui("not supplied")}</td><td className={reason?'amber':'up'}>{reason??ui("Recently retrieved")}</td></tr>)}</tbody></table>
 <details><summary className="amber cursor-pointer">{ui("Provider requests since API start")}</summary><table className="data-table"><thead><tr><th>{ui("Feed")}</th><th>{ui("Success")}</th><th>{ui("Failure")}</th><th>{ui("Last latency")}</th></tr></thead><tbody>{status.data?.providers.map(p=><tr key={p.name}><td>{p.name}</td><td>{p.ok}</td><td>{p.failed}</td><td>{p.lastLatencyMs??'—'} ms</td></tr>)}</tbody></table></details></div>;
}

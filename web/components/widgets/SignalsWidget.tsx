"use client";
import { useI18n } from "../../lib/use-i18n";

import {useState} from 'react';
import {useQuery,useMutation,useQueryClient} from '@tanstack/react-query';
import {apiGet,apiPost,apiPut,apiDelete} from '../../lib/api';
import {useTerminal} from '../../store/terminal';
type Row={id:number;version:number;payload:{name:string;symbols:string[];enabled:boolean;symbol?:string;date?:string;evidence?:unknown[]}};
export default function SignalsWidget(){
  const { t: ui } = useI18n();

 const watchlist=useTerminal(s=>s.watchlist),qc=useQueryClient();
 const [name,setName]=useState('Daily signal'),[symbols,setSymbols]=useState('AAPL'),[type,setType]=useState('SMA_CROSS_UP'),[period,setPeriod]=useState(20),[threshold,setThreshold]=useState(30),[volume,setVolume]=useState(false),[mode,setMode]=useState('crossing'),[status,setStatus]=useState('');
 const q=useQuery({queryKey:['signals'],queryFn:()=>apiGet<{rules:Row[];events:Row[]}>('/api/signals'),refetchInterval:30000});
 const action=useMutation({mutationFn:async(task:()=>Promise<unknown>)=>task(),onSuccess:()=>{qc.invalidateQueries({queryKey:['signals']});},onError:e=>setStatus(e.message)});
 return <div className="p-2 space-y-3"><p className="dim">{ui("Completed daily bars only; today's UTC date is excluded. Checks every 5 minutes while the API runs. All conditions must match. Current watchlist is copied when saved.")}</p>
 <form className="space-y-2" onSubmit={e=>{e.preventDefault();action.mutate(()=>apiPost('/api/signals',{name,symbols:symbols.split(/[ ,]+/).filter(Boolean),conditions:[{type,period,threshold},...(volume?[{type:'VOLUME_ABOVE',period:20,threshold:1.5}]:[])],mode,enabled:true}));}}>
 <input aria-label={ui("Signal name")} value={name} onChange={e=>setName(e.target.value)} required/><input aria-label={ui("Signal symbols")} value={symbols} onChange={e=>setSymbols(e.target.value.toUpperCase())}/><button type="button" className="term-btn" onClick={()=>setSymbols(watchlist.slice(0,20).join(','))}>{ui("Use watchlist")}</button>
 <div className="flex gap-2 flex-wrap"><select aria-label={ui("Signal condition")} value={type} onChange={e=>setType(e.target.value)}><option value="SMA_CROSS_UP">{ui("Close crosses above SMA")}</option><option value="RSI_RECOVER">{ui("RSI crosses above threshold")}</option><option value="BREAKOUT">{ui("Close above prior highs")}</option><option value="VOLUME_ABOVE">{ui("Volume / prior average ≥")}</option></select><label>{ui("Period")} <input aria-label={ui("Signal period")} type="number" min="2" max="100" value={period} onChange={e=>setPeriod(+e.target.value)}/></label><label>{ui("Threshold")} <input aria-label={ui("Signal threshold")} type="number" min="0" max="100" step="0.1" value={threshold} onChange={e=>setThreshold(+e.target.value)}/></label></div>
 <label><input type="checkbox" checked={volume} onChange={e=>setVolume(e.target.checked)}/> {ui("AND volume ≥ 1.5 × prior 20-day average")}</label><select aria-label={ui("Signal trigger mode")} value={mode} onChange={e=>setMode(e.target.value)}><option value="crossing">{ui("First matching bar / after a nonmatching bar")}</option><option value="daily">{ui("Each matching daily bar")}</option></select><button className="term-btn" disabled={action.isPending}>{ui("Save signal")}</button></form>
 <button className="term-btn" disabled={action.isPending} onClick={()=>action.mutate(async()=>{const result=await apiPost('/api/signals/check',{});setStatus(JSON.stringify(result));return result;})}>{ui("Check signals")}</button>
 {(status||q.error)&&<p role="status">{status||q.error?.message}</p>}
 {q.data?.rules.map(r=><div key={r.id} className="border-b border-[var(--border)] p-1">{r.payload.name} · {r.payload.symbols.join(', ')} · {r.payload.enabled?ui("Active"):ui("Paused")} <button className="term-btn" onClick={()=>action.mutate(()=>apiPut(`/api/signals/${r.id}`,{enabled:!r.payload.enabled,version:r.version}))}>{ui("Pause / resume")}</button><button className="term-btn" onClick={()=>action.mutate(()=>apiDelete(`/api/signals/${r.id}`))}>{ui("Delete")}</button></div>)}
 <h3 className="amber">{ui("Signal history / evidence")}</h3>{q.data?.events.map(r=><article key={r.id} className="border-b border-[var(--border)] p-1"><button className="amber" onClick={()=>useTerminal.getState().openResearch(r.payload.symbol!)}>{r.payload.symbol} · {r.payload.name} · {r.payload.date}</button><details><summary>{ui("Condition values")}</summary><pre className="whitespace-pre-wrap">{JSON.stringify(r.payload.evidence,null,2)}</pre></details></article>)}
 </div>;
}

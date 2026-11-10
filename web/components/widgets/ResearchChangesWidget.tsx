"use client";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { useI18n } from "../../lib/use-i18n";
type Entry={key:string;kind:string;id:number;title:string;updatedAt:string;summary:string};
type Changes={baseline:boolean;changes:{type:string;current:Entry;previous:Entry|null}[];removed:Entry[];current:{capturedAt:string;coverage:string};token:string;version:number;history?:{id:number;capturedAt:string;count:number}[]};
export default function ResearchChangesWidget({widget}:{widget:WidgetInstance}){
 const symbol=useWidgetSymbol(widget);
 return <ChangesContent key={symbol} symbol={symbol}/>;
}
function ChangesContent({symbol}:{symbol:string}){
 const {t:ui}=useI18n(),[snapshot,setSnapshot]=useState(0);
 const q=useQuery({queryKey:["research-changes",symbol,snapshot],queryFn:()=>apiGet<Changes>(`/api/workflow-research/changes/${encodeURIComponent(symbol)}${snapshot?`/${snapshot}`:""}`)});
 const history=useQuery({queryKey:["research-changes",symbol,0],queryFn:()=>apiGet<Changes>(`/api/workflow-research/changes/${encodeURIComponent(symbol)}`)});
 const read=useMutation({mutationFn:(data:Changes)=>apiPost(`/api/workflow-research/changes/${encodeURIComponent(symbol)}/read`,{token:data.token,version:data.version}),onSuccess:()=>{void q.refetch();void history.refetch();}});
 return <div className="workflow-panel"><p className="dim">{ui("Changes since your last reviewed snapshot. Opening this page does not mark research read.")}</p><div className="workflow-actions"><select aria-label={ui("Research snapshot")} value={snapshot} onChange={e=>setSnapshot(+e.target.value)}><option value={0}>{ui("Since last review")}</option>{history.data?.history?.map(h=><option value={h.id} key={h.id}>{h.capturedAt} · {h.count}</option>)}</select><button className="term-btn" onClick={()=>q.refetch()}>{ui("Refresh")}</button>{!snapshot&&<button className="term-btn" disabled={!q.data||read.isPending} onClick={()=>q.data&&read.mutate(q.data)}>{ui("Mark reviewed")}</button>}</div>
 {(q.error||read.error)&&<p role="alert">{q.error?.message||read.error?.message}</p>}{q.isLoading&&<p>{ui("Loading…")}</p>}
 {q.data&&<><p className="dim">{q.data.current.coverage}</p>{q.data.baseline&&<p>{ui("First review: these are your currently retained records. Mark reviewed to start tracking changes.")}</p>}{!q.data.changes.length&&!q.data.removed.length&&<p>{ui("No research changes since this baseline.")}</p>}
 {q.data.changes.map(c=><article className="workflow-card" key={c.current.key}><button className="amber" onClick={()=>useTerminal.getState().openResearch(symbol,{kind:c.current.kind,id:c.current.id})}>{c.current.title}</button><p className="dim">{ui(c.type==="added"?"Added":"Changed")} · {c.current.updatedAt}</p><details><summary>{ui("Compare saved content")}</summary><div className="workflow-columns">{c.previous&&<section><h4>{ui("Before")}</h4><pre>{c.previous.summary}</pre></section>}<section><h4>{ui("Now")}</h4><pre>{c.current.summary}</pre></section></div></details></article>)}
 {q.data.removed.map(e=><p key={e.key}>{ui("No longer retained")}: {e.title}</p>)}</>}
 </div>;
}

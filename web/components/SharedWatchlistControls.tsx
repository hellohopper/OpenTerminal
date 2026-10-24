"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSharedWatchlist, type SharedWatchlist } from "../lib/use-shared-watchlist";
import { apiDelete, apiPost } from "../lib/api";
import { useI18n } from "../lib/use-i18n";
import Modal from "./Modal";

export default function SharedWatchlistControls() {
  const {t}=useI18n(), shared=useSharedWatchlist(), qc=useQueryClient();
  const [name,setName]=useState(""), [error,setError]=useState(""), [busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<{row:SharedWatchlist;action:"rename"|"delete"}|null>(null), [rename,setRename]=useState("");
  const refresh=()=>qc.invalidateQueries({queryKey:["shared-watchlists"]});
  async function run(action:()=>Promise<void>) {
    setBusy(true); setError("");
    try { await action(); return true; }
    catch(e) { setError((e as Error).message); await refresh(); return false; }
    finally { setBusy(false); }
  }
  async function create(symbols:string[]) {
    await run(async()=>{
      const result=await apiPost<{id:number}>("/api/watchlists",{name,symbols});
      await refresh(); shared.choose(result.id); setName("");
    });
  }
  async function confirm() {
    if (!editing) return;
    const {row,action}=editing;
    await run(async()=>{
      if(action==="delete") await apiDelete(`/api/watchlists/${row.id}?version=${row.version}`);
      else await apiPost(`/api/watchlists/${row.id}/rename`,{name:rename,version:row.version});
      await refresh();
    });
    // A conflict requires a fresh review of the latest row before another attempt.
    setEditing(null);
  }
  function moveSymbol(row:SharedWatchlist,index:number,direction:number) {
    const symbols=[...row.payload.symbols], next=index+direction;
    [symbols[index],symbols[next]]=[symbols[next],symbols[index]];
    void run(async()=>{await apiPost(`/api/watchlists/${row.id}/reorder-symbols`,{symbols,version:row.version});await refresh();});
  }
  const disabled=busy||shared.mutation.isPending;
  return <details className="p-2" onToggle={e=>{if(e.currentTarget.open)void shared.lists.refetch();}}>
    <summary>{t("Shared watchlists")}{shared.selected?` · ${shared.selected.payload.name}`:""}</summary>
    <div className="space-y-2 py-2">
      <label>{t("Watchlist source")} <select aria-label={t("Watchlist source")} value={shared.id} disabled={disabled} onChange={e=>shared.choose(Number(e.target.value))}>
        <option value={0}>{t("Local workspace")}</option>{shared.lists.data?.map(row=><option key={row.id} value={row.id}>{row.payload.name}</option>)}
      </select></label>
      <p className="dim">{t("Shared lists update on the Mac and phone. Local workspace lists stay independent.")}</p>
      <label>{t("Shared list name")} <input aria-label={t("Shared list name")} maxLength={64} value={name} onChange={e=>setName(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2">
        <button className="term-btn" disabled={disabled||!name.trim()} onClick={()=>void create(shared.symbols)}>{t("Publish current list")}</button>
        <button className="term-btn" disabled={disabled||!name.trim()} onClick={()=>void create([])}>{t("Create empty list")}</button>
      </div>
      <details><summary>{t("Manage shared lists")}</summary>
        <p className="dim">{t("List and symbol order sync across devices. Deleting a shared list restores your local workspace list.")}</p>
        <ul className="space-y-2 py-2" aria-label={t("Shared list order")}>
          {shared.lists.data?.map((row,index)=><li key={row.id} className="flex flex-wrap items-center gap-2">
            <span>{row.payload.name}</span>
            <button className="term-btn" disabled={disabled||index===0} aria-label={`${t("Move up")} ${row.payload.name}`} onClick={()=>void run(async()=>{await apiPost(`/api/watchlists/${row.id}/move`,{direction:"up"});await refresh();})}>↑</button>
            <button className="term-btn" disabled={disabled||index===(shared.lists.data?.length??0)-1} aria-label={`${t("Move down")} ${row.payload.name}`} onClick={()=>void run(async()=>{await apiPost(`/api/watchlists/${row.id}/move`,{direction:"down"});await refresh();})}>↓</button>
            <button className="term-btn" disabled={disabled} aria-label={`${t("Rename")} ${row.payload.name}`} onClick={()=>{setRename(row.payload.name);setEditing({row,action:"rename"});}}>{t("Rename")}</button>
            <button className="term-btn" disabled={disabled} aria-label={`${t("Delete")} ${row.payload.name}`} onClick={()=>setEditing({row,action:"delete"})}>{t("Delete")}</button>
          </li>)}
        </ul>
        {shared.selected && <ul className="space-y-1" aria-label={t("Shared symbol order")}>{shared.selected.payload.symbols.map((symbol,index)=><li key={symbol} className="flex items-center gap-2">
          <span>{symbol}</span>
          <button className="term-btn" aria-label={`${t("Move up")} ${symbol}`} disabled={disabled||index===0} onClick={()=>moveSymbol(shared.selected!,index,-1)}>↑</button>
          <button className="term-btn" aria-label={`${t("Move down")} ${symbol}`} disabled={disabled||index===shared.selected!.payload.symbols.length-1} onClick={()=>moveSymbol(shared.selected!,index,1)}>↓</button>
        </li>)}</ul>}
      </details>
      {(error||shared.lists.error||shared.mutation.error)&&<p role="alert">{t(error||shared.lists.error?.message||shared.mutation.error?.message||"")}</p>}
    </div>
    {editing&&<Modal label={t(editing.action==="delete"?"Delete shared list":"Rename shared list")} onClose={()=>{if(!busy)setEditing(null);}}>
      <h2>{t(editing.action==="delete"?"Delete shared list":"Rename shared list")} · {editing.row.payload.name}</h2>
      {editing.action==="delete"?<p>{t("This removes the shared list from every device. Local workspace lists are preserved.")}</p>:<label>{t("New list name")} <input aria-label={t("New list name")} maxLength={64} value={rename} onChange={e=>setRename(e.target.value)}/></label>}
      <div className="flex gap-2 pt-2">
        <button className="term-btn" disabled={busy||(editing.action==="rename"&&!rename.trim())} onClick={()=>void confirm()}>{t(editing.action==="delete"?"Delete shared list":"Save")}</button>
        <button className="term-btn" disabled={busy} onClick={()=>setEditing(null)}>{t("Cancel")}</button>
      </div>
    </Modal>}
  </details>;
}

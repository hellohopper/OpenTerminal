"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSharedWatchlist } from "../lib/use-shared-watchlist";
import { apiPost } from "../lib/api";
import { useI18n } from "../lib/use-i18n";
export default function SharedWatchlistControls() {
  const {t}=useI18n(),shared=useSharedWatchlist(),qc=useQueryClient(),[name,setName]=useState(""),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  return <details className="p-2" onToggle={e=>{if(e.currentTarget.open)void shared.lists.refetch();}}><summary>{t("Shared watchlists")}{shared.selected?` · ${shared.selected.payload.name}`:""}</summary><div className="space-y-2 py-2">
    <label>{t("Watchlist source")} <select aria-label={t("Watchlist source")} value={shared.id} onChange={e=>shared.choose(Number(e.target.value))}><option value={0}>{t("Local workspace")}</option>{shared.lists.data?.map(row=><option key={row.id} value={row.id}>{row.payload.name}</option>)}</select></label>
    <p className="dim">{t("Shared lists update on the Mac and phone. Local workspace lists stay independent.")}</p>
    <label>{t("Shared list name")} <input aria-label={t("Shared list name")} maxLength={64} value={name} onChange={e=>setName(e.target.value)}/></label>
    <button className="term-btn" disabled={busy||!name.trim()} onClick={async()=>{setBusy(true);try{const result=await apiPost<{id:number}>("/api/watchlists",{name,symbols:shared.symbols});await qc.invalidateQueries({queryKey:["shared-watchlists"]});shared.choose(result.id);setName("");setError("");}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>{t("Publish current list")}</button>
    {(error||shared.lists.error||shared.mutation.error)&&<p role="alert">{error||shared.lists.error?.message||shared.mutation.error?.message}</p>}
  </div></details>;
}

"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useTerminal } from "../store/terminal";
import { apiGet, apiPost } from "./api";
export type SharedWatchlist = {id:number;version:number;payload:{name:string;symbols:string[]}};
const useSource = create<{ selected: Record<string,number>; locals:Record<string,string[]>; choose:(workspace:string,id:number,local?:string[])=>void }>()(persist(set=>({selected:{},locals:{},choose:(workspace,id,local)=>set(s=>({selected:{...s.selected,[workspace]:id},locals:local?{...s.locals,[workspace]:local}:s.locals}))}),{name:"openterminal-watchlist-source"}));
export function useSharedWatchlist() {
  const workspace = useTerminal(s=>s.activeWorkspaceId), symbols = useTerminal(s=>s.watchlist);
  const id = useSource(s=>s.selected[workspace] ?? 0), qc = useQueryClient();
  const lists = useQuery({queryKey:["shared-watchlists"],queryFn:()=>apiGet<SharedWatchlist[]>("/api/watchlists"),refetchInterval:15000});
  const selected = lists.data?.find(row=>row.id===id);
  useEffect(()=>{
    if (!id || !lists.isSuccess || lists.isFetching || selected) return;
    const saved = useSource.getState();
    if (saved.selected[workspace] !== id) return;
    saved.choose(workspace, 0);
    if (useTerminal.getState().activeWorkspaceId === workspace) useTerminal.getState().setWatchlist(saved.locals[workspace] ?? []);
  },[id,lists.isSuccess,lists.isFetching,selected,workspace]);
  useEffect(()=>{if(selected && useTerminal.getState().activeWorkspaceId===workspace && selected.payload.symbols.join(",")!==useTerminal.getState().watchlist.join(","))useTerminal.getState().setWatchlist(selected.payload.symbols);},[selected,workspace]);
  const mutation = useMutation({onMutate:()=>qc.cancelQueries({queryKey:["shared-watchlists"]}),mutationFn:async({symbol,action}:{symbol:string;action:"add"|"remove"})=>apiPost<SharedWatchlist>(`/api/watchlists/${id}/symbols`,{symbol,action}),onSuccess:row=>{qc.setQueryData<SharedWatchlist[]>(["shared-watchlists"],old=>old?.map(v=>v.id===row.id&&v.version<=row.version?row:v));void qc.invalidateQueries({queryKey:["shared-watchlists"]});}});
  const change = (symbol:string,action:"add"|"remove")=>{if(id)mutation.mutate({symbol,action});else action==="add"?useTerminal.getState().addToWatchlist(symbol):useTerminal.getState().removeFromWatchlist(symbol);};
  return {id,symbols,lists,selected,mutation,choose:(next:number)=>{const saved=useSource.getState();if(next===0){const local=saved.locals[workspace];if(local)useTerminal.getState().setWatchlist(local);}saved.choose(workspace,next,id===0&&next!==0?[...symbols]:undefined);},add:(symbol:string)=>change(symbol,"add"),remove:(symbol:string)=>change(symbol,"remove")};
}

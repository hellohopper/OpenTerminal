"use client";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
export const SIMPLE_PAGES = ["today", "watchlist", "holdings", "research", "alerts"] as const;
export type SimplePage = typeof SIMPLE_PAGES[number];
export function createInterfaceStore(storage?: StateStorage) {
  return create<{ mode: "simple" | "professional"; page: SimplePage; accounts: Record<string,number>; setAccount:(workspace:string,id:number)=>void; setMode: (mode: "simple" | "professional") => void; setPage: (page: SimplePage) => void }>()(persist(set => ({
    mode: "professional", page: "today", accounts:{}, setAccount:(workspace,id)=>set(s=>({accounts:{...s.accounts,[workspace]:id}})), setMode: mode => set({ mode }), setPage: page => set({ page }),
  }), { name: "openterminal-interface", storage: createJSONStorage(() => storage ?? localStorage),
    partialize: ({ mode, page, accounts }) => ({ mode, page, accounts }),
    merge: (saved, current) => { const v = saved as Record<string, unknown> | undefined; const accounts=v?.accounts&&typeof v.accounts==="object"&&!Array.isArray(v.accounts)?Object.fromEntries(Object.entries(v.accounts).filter(([key,id])=>key.length<=100&&Number.isSafeInteger(id)&&Number(id)>0)):{}; return { ...current, accounts:accounts as Record<string,number>, mode: v?.mode === "simple" ? "simple" : "professional", page: SIMPLE_PAGES.includes(v?.page as SimplePage) ? v!.page as SimplePage : "today" }; },
  }));
}
export const useInterface = createInterfaceStore();

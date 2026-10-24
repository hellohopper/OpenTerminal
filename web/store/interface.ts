"use client";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
export const SIMPLE_PAGES = ["today", "watchlist", "holdings", "research", "alerts"] as const;
export type SimplePage = typeof SIMPLE_PAGES[number];
export function createInterfaceStore(storage?: StateStorage) {
  return create<{ mode: "simple" | "professional"; page: SimplePage; setMode: (mode: "simple" | "professional") => void; setPage: (page: SimplePage) => void }>()(persist(set => ({
    mode: "professional", page: "today", setMode: mode => set({ mode }), setPage: page => set({ page }),
  }), { name: "openterminal-interface", storage: createJSONStorage(() => storage ?? localStorage),
    partialize: ({ mode, page }) => ({ mode, page }),
    merge: (saved, current) => { const v = saved as Record<string, unknown> | undefined; return { ...current, mode: v?.mode === "simple" ? "simple" : "professional", page: SIMPLE_PAGES.includes(v?.page as SimplePage) ? v!.page as SimplePage : "today" }; },
  }));
}
export const useInterface = createInterfaceStore();

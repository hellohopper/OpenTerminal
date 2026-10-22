"use client";
import {researchLink,type ResearchTarget} from "../lib/research-link";

import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { readSymbols } from "../lib/preferences";
import { normalizeSymbol } from "../lib/symbol";
import { useDisplay } from "./display";
import { makeWorkspace, readWorkspace, restoreWorkspaces, workspaceName, newId, SIZE_BY_TYPE, MAX_WORKSPACES, type Preset, type SavedWorkspace, type WorkspaceData, type WidgetType, type LayoutItem } from "../lib/workspaces";
export type { WidgetType, WidgetInstance, LayoutItem } from "../lib/workspaces";

type TerminalState = WorkspaceData & {
  lastAddedWidgetId: string | null;
  lastRemovedPanel: { workspaceId: string; widget: import("../lib/workspaces").WidgetInstance; layout: LayoutItem; index: number } | null;
  undoRemoveWidget: () => void;
  dismissPanelNotice: () => void;
  workspaces: SavedWorkspace[];
  activeWorkspaceId: string;
  commandOpen: boolean;
  researchSymbol: string | null;
  researchTarget: ResearchTarget | null;
  openResearch: (symbol: string, target?: ResearchTarget) => void;
  closeResearch: () => void;
  mobileView: "holdings" | "alerts" | "events" | "workspace";
  setMobileView: (view: "holdings" | "alerts" | "events" | "workspace") => void;
  setActiveSymbol: (s: string) => void;
  setCommandOpen: (open: boolean) => void;
  addWidget: (type: WidgetType, symbol?: string) => void;
  removeWidget: (id: string) => void;
  setWidgetSymbol: (id: string, symbol: string) => void;
  toggleLinked: (id: string) => void;
  setLayout: (layout: LayoutItem[]) => void;
  addToWatchlist: (s: string) => void;
  removeFromWatchlist: (s: string) => void;
  setWatchlist: (symbols: string[]) => void;
  resetWorkspace: () => void;
  createWorkspace: (name: string, preset?: Preset) => void;
  switchWorkspace: (id: string) => void;
  renameWorkspace: (name: string) => void;
  duplicateWorkspace: () => void;
  deleteWorkspace: () => void;
  importWorkspace: (workspace: SavedWorkspace) => void;
};
function activePatch(st: TerminalState, patch: Partial<WorkspaceData>): Partial<TerminalState> {
  return { ...patch, workspaces: st.workspaces.map((w) => w.id === st.activeWorkspaceId ? { ...w, ...patch } : w) };
}
export function createTerminalStore(storage?: StateStorage) {
  const initial = makeWorkspace("My workspace");
  return create<TerminalState>()(persist((set, get) => {
    const addWorkspace = (workspace: SavedWorkspace) => {
      if (get().workspaces.length >= MAX_WORKSPACES) throw new Error(`You can save up to ${MAX_WORKSPACES} workspaces.`);
      set((st) => ({ ...workspace, workspaces: [...st.workspaces, workspace], activeWorkspaceId: workspace.id, mobileView: "workspace" }));
    };
    return {
      ...initial, workspaces: [initial], activeWorkspaceId: initial.id, commandOpen: false,
      researchSymbol: null, researchTarget: null, mobileView: "holdings", lastAddedWidgetId: null, lastRemovedPanel: null,
      dismissPanelNotice: () => set({ lastAddedWidgetId: null, lastRemovedPanel: null }),
      openResearch: (symbol,target) => { const sym = normalizeSymbol(symbol); if (sym) { get().setActiveSymbol(sym); set({ researchSymbol: sym, researchTarget: target??null, commandOpen: false }); if(typeof window!=="undefined")window.history.replaceState(null,"",researchLink(sym,target)); } },
      closeResearch: () => {set({ researchSymbol: null,researchTarget:null });if(typeof window!=="undefined")window.history.replaceState(null,"",window.location.pathname);},
      setMobileView: (mobileView) => set({ mobileView }),
      setActiveSymbol: (s) => { const sym = normalizeSymbol(s); if (sym) set((st) => activePatch(st, { activeSymbol: sym })); },
      setCommandOpen: (open) => set({ commandOpen: open }),
      addWidget: (type, symbol) => set((st) => {
        if (st.widgets.length >= 50) return st;
        const id = newId();
        const sym = symbol ? normalizeSymbol(symbol) : undefined;
        const maxY = st.layout.reduce((m, l) => Math.max(m, l.y + l.h), 0);
        useDisplay.getState().recordFeatureUsed(type);
        return { lastAddedWidgetId: id, lastRemovedPanel: null, mobileView: "workspace" as const, ...activePatch(st, { widgets: [...st.widgets, { id, type, ...(sym ? { symbol: sym } : {}), linked: !sym }], layout: [...st.layout, { i: id, x: 0, y: maxY, ...SIZE_BY_TYPE[type] }] }) };
      }),
      removeWidget: (id) => set((st) => {
        const index = st.widgets.findIndex(w => w.id === id), layout = st.layout.find(l => l.i === id);
        if (index < 0 || !layout) return st;
        return { lastAddedWidgetId: null, lastRemovedPanel: { workspaceId: st.activeWorkspaceId, widget: st.widgets[index], layout, index }, ...activePatch(st, { widgets: st.widgets.filter(w => w.id !== id), layout: st.layout.filter(l => l.i !== id) }) };
      }),
      undoRemoveWidget: () => set(st => {
        const removed = st.lastRemovedPanel, workspace = st.workspaces.find(w => w.id === removed?.workspaceId);
        if (!removed || !workspace || workspace.widgets.length >= 50) return st;
        const widgets = [...workspace.widgets]; widgets.splice(removed.index, 0, removed.widget);
        const restored = { ...workspace, widgets, layout: [...workspace.layout, removed.layout] };
        return { ...(st.activeWorkspaceId === workspace.id ? { widgets, layout: restored.layout } : {}), workspaces: st.workspaces.map(w => w.id === workspace.id ? restored : w), lastRemovedPanel: null };
      }),
      setWidgetSymbol: (id, symbol) => { const sym = normalizeSymbol(symbol); if (sym) set((st) => activePatch(st, { widgets: st.widgets.map((w) => w.id === id ? { ...w, symbol: sym, linked: false } : w) })); },
      toggleLinked: (id) => set((st) => activePatch(st, { widgets: st.widgets.map((w) => w.id === id ? { ...w, linked: !w.linked } : w) })),
      setLayout: (layout) => set((st) => activePatch(st, { layout })),
      addToWatchlist: (s) => { const sym = normalizeSymbol(s); if (sym) set((st) => activePatch(st, { watchlist: st.watchlist.includes(sym) || st.watchlist.length >= 200 ? st.watchlist : [...st.watchlist, sym] })); },
      setWatchlist: (symbols) => { const watchlist=readSymbols(symbols); set(st=>activePatch(st,{watchlist})); },
      removeFromWatchlist: (s) => set((st) => activePatch(st, { watchlist: st.watchlist.filter((x) => x !== s) })),
      resetWorkspace: () => { const { widgets, layout } = makeWorkspace("Default"); set((st) => activePatch(st, { widgets, layout })); },
      createWorkspace: (name, preset = "daily") => addWorkspace(makeWorkspace(name, preset)),
      switchWorkspace: (id) => { const workspace = get().workspaces.find((w) => w.id === id); if (workspace) set({ ...workspace, activeWorkspaceId: id, commandOpen: false, mobileView: "workspace" }); },
      renameWorkspace: (name) => { const valid = workspaceName(name); set((st) => ({ workspaces: st.workspaces.map((w) => w.id === st.activeWorkspaceId ? { ...w, name: valid } : w) })); },
      duplicateWorkspace: () => { const current = get().workspaces.find((w) => w.id === get().activeWorkspaceId)!; addWorkspace(readWorkspace({ ...current, name: `${current.name.slice(0, 57)} (copy)` })); },
      deleteWorkspace: () => {
        const st = get();
        if (st.workspaces.length === 1) throw new Error("Keep at least one workspace.");
        const remaining = st.workspaces.filter((w) => w.id !== st.activeWorkspaceId);
        set({ ...remaining[0], workspaces: remaining, activeWorkspaceId: remaining[0].id });
      },
      importWorkspace: (workspace) => addWorkspace(readWorkspace(workspace)),
    };
  }, {
    name: "openterminal-workspace", version: 1,
    storage: createJSONStorage(() => storage ?? localStorage),
    partialize: (st) => ({ workspaces: st.workspaces, activeWorkspaceId: st.activeWorkspaceId }),
    migrate: (value) => restoreWorkspaces(value),
    merge: (persisted, current) => {
      const restored = restoreWorkspaces(persisted);
      const active = restored.workspaces.find((w) => w.id === restored.activeWorkspaceId)!;
      return { ...current, ...active, ...restored, commandOpen: false };
    },
  }));
}
export const useTerminal = createTerminalStore();
export function useWidgetSymbol(widget: import("../lib/workspaces").WidgetInstance): string {
  const active = useTerminal((s) => s.activeSymbol);
  return widget.linked ? active : widget.symbol ?? active;
}

"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { defaultDisplayPreferences, normalizeFontSize, normalizeRefreshInterval, readDisplayPreferences, type DisplayPreferences } from "../lib/display";
import type { WidgetType } from "../lib/workspaces";
export { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from "../lib/display";

type VisibilityUndo = Pick<DisplayPreferences, "sidebarVisible" | "hiddenSidebarFeatures" | "hiddenPanels">;
const visibilitySnapshot = (state: DisplayPreferences): VisibilityUndo => ({ sidebarVisible: state.sidebarVisible, hiddenSidebarFeatures: state.hiddenSidebarFeatures, hiddenPanels: state.hiddenPanels });

export function createDisplayStore(storage?: StateStorage) {
return create<DisplayPreferences & {
  setLanguage: (language: DisplayPreferences["language"]) => void;
  setFontSize: (size: number) => void;
  setDensity: (density: DisplayPreferences["density"]) => void;
  setRefreshInterval: (interval: number) => void;
  setHideEmptyQuoteFields: (hidden: boolean) => void;
  toggleFavorite: (type: WidgetType) => void;
  recordFeatureUsed: (type: WidgetType) => void;
  toggleGroup: (group: string) => void;
  setSidebarVisible: (visible: boolean) => void;
  setWorkspaceBarVisible: (visible: boolean) => void;
  setSidebarFeaturesVisible: (types: readonly WidgetType[], visible: boolean) => void;
  setPanelsVisible: (workspaceId: string, ids: string[], visible: boolean) => void;
  resetVisibility: () => void;
  visibilityUndo: VisibilityUndo | null;
  restorePanelVisibility: (workspaceId?: string) => void;
  restoreSidebarVisibility: () => void;
  undoVisibilityRestore: () => void;
}>()(persist((set) => ({
  ...defaultDisplayPreferences(),
  visibilityUndo: null,
  restorePanelVisibility: (workspaceId) => set(state => ({ visibilityUndo: visibilitySnapshot(state), hiddenPanels: workspaceId ? { ...state.hiddenPanels, [workspaceId]: [] } : {} })),
  restoreSidebarVisibility: () => set(state => ({ visibilityUndo: visibilitySnapshot(state), sidebarVisible: true, hiddenSidebarFeatures: [] })),
  undoVisibilityRestore: () => set(state => state.visibilityUndo ? { ...state.visibilityUndo, visibilityUndo: null } : state),
  setLanguage: (language) => set({ language: language === "zh" ? "zh" : "en" }),
  setFontSize: (size) => set({ fontSize: normalizeFontSize(size) }),
  setDensity: (density) => set({ density }),
  setRefreshInterval: (interval) => set({ refreshInterval: normalizeRefreshInterval(interval) }),
  setHideEmptyQuoteFields: (hideEmptyQuoteFields) => set({ hideEmptyQuoteFields }),
  toggleFavorite: (type) => set(state => ({ favoriteFeatures: state.favoriteFeatures.includes(type) ? state.favoriteFeatures.filter(item => item !== type) : [...state.favoriteFeatures, type] })),
  recordFeatureUsed: (type) => set(state => ({ recentFeatures: [type, ...state.recentFeatures.filter(item => item !== type)].slice(0, 5) })),
  toggleGroup: (group) => set(state => ({ collapsedGroups: state.collapsedGroups.includes(group) ? state.collapsedGroups.filter(item => item !== group) : [...state.collapsedGroups, group] })),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible, visibilityUndo: null }),
  setWorkspaceBarVisible: (workspaceBarVisible) => set({ workspaceBarVisible, visibilityUndo: null }),
  setSidebarFeaturesVisible: (types, visible) => set((state) => ({
    visibilityUndo: null,
    hiddenSidebarFeatures: visible
      ? state.hiddenSidebarFeatures.filter((type) => !types.includes(type))
      : [...new Set([...state.hiddenSidebarFeatures, ...types])],
  })),
  setPanelsVisible: (workspaceId, ids, visible) => set((state) => ({
    visibilityUndo: null,
    hiddenPanels: {
      ...state.hiddenPanels,
      [workspaceId]: visible
        ? (state.hiddenPanels[workspaceId] ?? []).filter((id) => !ids.includes(id))
        : [...new Set([...(state.hiddenPanels[workspaceId] ?? []), ...ids])],
    },
  })),
  resetVisibility: () => set({ visibilityUndo: null, sidebarVisible: true, workspaceBarVisible: true, hiddenSidebarFeatures: [], hiddenPanels: {}, collapsedGroups: [] }),
}), {
  name: "openterminal-display",
  skipHydration: true,
  storage: createJSONStorage(() => storage ?? localStorage),
  partialize: ({ language, fontSize, density, refreshInterval, hideEmptyQuoteFields, favoriteFeatures, recentFeatures, collapsedGroups, sidebarVisible, workspaceBarVisible, hiddenSidebarFeatures, hiddenPanels }) =>
    ({ language, fontSize, density, refreshInterval, hideEmptyQuoteFields, favoriteFeatures, recentFeatures, collapsedGroups, sidebarVisible, workspaceBarVisible, hiddenSidebarFeatures, hiddenPanels }),
  merge: (saved, current) => ({
    ...current,
    ...readDisplayPreferences(saved),
  }),
}));
}

export const useDisplay = createDisplayStore();

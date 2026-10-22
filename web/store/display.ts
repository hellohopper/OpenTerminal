"use client";

import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { defaultDisplayPreferences, normalizeFontSize, readDisplayPreferences, type DisplayPreferences } from "../lib/display";
import type { WidgetType } from "../lib/workspaces";
export { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE } from "../lib/display";

export function createDisplayStore(storage?: StateStorage) {
return create<DisplayPreferences & {
  setLanguage: (language: DisplayPreferences["language"]) => void;
  setFontSize: (size: number) => void;
  setSidebarVisible: (visible: boolean) => void;
  setWorkspaceBarVisible: (visible: boolean) => void;
  setSidebarFeaturesVisible: (types: readonly WidgetType[], visible: boolean) => void;
  setPanelsVisible: (workspaceId: string, ids: string[], visible: boolean) => void;
  resetVisibility: () => void;
}>()(persist((set) => ({
  ...defaultDisplayPreferences(),
  setLanguage: (language) => set({ language: language === "zh" ? "zh" : "en" }),
  setFontSize: (size) => set({ fontSize: normalizeFontSize(size) }),
  setSidebarVisible: (sidebarVisible) => set({ sidebarVisible }),
  setWorkspaceBarVisible: (workspaceBarVisible) => set({ workspaceBarVisible }),
  setSidebarFeaturesVisible: (types, visible) => set((state) => ({
    hiddenSidebarFeatures: visible
      ? state.hiddenSidebarFeatures.filter((type) => !types.includes(type))
      : [...new Set([...state.hiddenSidebarFeatures, ...types])],
  })),
  setPanelsVisible: (workspaceId, ids, visible) => set((state) => ({
    hiddenPanels: {
      ...state.hiddenPanels,
      [workspaceId]: visible
        ? (state.hiddenPanels[workspaceId] ?? []).filter((id) => !ids.includes(id))
        : [...new Set([...(state.hiddenPanels[workspaceId] ?? []), ...ids])],
    },
  })),
  resetVisibility: () => set((state) => ({ ...defaultDisplayPreferences(), fontSize: state.fontSize, language: state.language })),
}), {
  name: "openterminal-display",
  skipHydration: true,
  storage: createJSONStorage(() => storage ?? localStorage),
  partialize: ({ language, fontSize, sidebarVisible, workspaceBarVisible, hiddenSidebarFeatures, hiddenPanels }) =>
    ({ language, fontSize, sidebarVisible, workspaceBarVisible, hiddenSidebarFeatures, hiddenPanels }),
  merge: (saved, current) => ({
    ...current,
    ...readDisplayPreferences(saved),
  }),
}));
}

export const useDisplay = createDisplayStore();

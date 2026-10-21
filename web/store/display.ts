"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEFAULT_FONT_SIZE = 12;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 20;

function normalizeFontSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
    : DEFAULT_FONT_SIZE;
}

export const useDisplay = create<{
  fontSize: number;
  setFontSize: (size: number) => void;
}>()(persist((set) => ({
  fontSize: DEFAULT_FONT_SIZE,
  setFontSize: (size) => set({ fontSize: normalizeFontSize(size) }),
}), {
  name: "openterminal-display",
  skipHydration: true,
  partialize: (state) => ({ fontSize: state.fontSize }),
  merge: (saved, current) => ({
    ...current,
    fontSize: normalizeFontSize((saved as { fontSize?: unknown } | null)?.fontSize),
  }),
}));

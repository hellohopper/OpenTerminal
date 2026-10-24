"use client";

import { useEffect, useLayoutEffect } from "react";
import { useDisplay } from "../store/display";
import { useTerminal } from "../store/terminal";

export default function DisplayPreferences() {
  const fontSize = useDisplay((state) => state.fontSize);
  const language = useDisplay((state) => state.language);
  const density = useDisplay((state) => state.density);
  useEffect(() => {
    let cleanup: (() => void) | undefined, disposed = false;
    void Promise.resolve(useDisplay.persist.rehydrate()).then(() => {
      if (disposed) return;
      useTerminal.getState().restorePresentation();
      useTerminal.getState().savePresentation();
      cleanup = useDisplay.subscribe(() => useTerminal.getState().savePresentation());
    });
    return () => { disposed = true; cleanup?.(); };
  }, []);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--terminal-font-size", `${fontSize}px`);
  }, [fontSize]);
  useLayoutEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);
  useLayoutEffect(() => { document.documentElement.dataset.density = density; }, [density]);
  return null;
}

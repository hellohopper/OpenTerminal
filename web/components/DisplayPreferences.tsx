"use client";

import { useEffect, useLayoutEffect } from "react";
import { useDisplay } from "../store/display";

export default function DisplayPreferences() {
  const fontSize = useDisplay((state) => state.fontSize);
  const language = useDisplay((state) => state.language);
  useEffect(() => { void useDisplay.persist.rehydrate(); }, []);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--terminal-font-size", `${fontSize}px`);
  }, [fontSize]);
  useLayoutEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  }, [language]);
  return null;
}

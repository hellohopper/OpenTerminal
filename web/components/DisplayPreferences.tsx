"use client";

import { useEffect, useLayoutEffect } from "react";
import { useDisplay } from "../store/display";

export default function DisplayPreferences() {
  const fontSize = useDisplay((state) => state.fontSize);
  useEffect(() => { void useDisplay.persist.rehydrate(); }, []);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--terminal-font-size", `${fontSize}px`);
  }, [fontSize]);
  return null;
}

"use client";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useDisplay } from "../store/display";
import { pollingInterval } from "./display";

const Activity = createContext(true);
export function PollingScope({ active, children }: { active: boolean; children: ReactNode }) {
  const parent = useContext(Activity);
  return <Activity.Provider value={parent && active}>{children}</Activity.Provider>;
}
export function useAdaptiveRefresh(minimum = 0) {
  const active = useContext(Activity);
  const configured = useDisplay(state => state.refreshInterval);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, active, interval: pollingInterval(configured, visible, active, minimum) };
}

"use client";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDisplay } from "../store/display";
import { pollingInterval } from "./display";

const Activity = createContext(true);
const foreground = () => document.visibilityState !== "hidden" && navigator.onLine !== false;
const subscribe = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify); window.addEventListener("online", notify); window.addEventListener("offline", notify);
  return () => { document.removeEventListener("visibilitychange", notify); window.removeEventListener("online", notify); window.removeEventListener("offline", notify); };
};
export function useRefreshActivity() {
  const scope = useContext(Activity), active = useSyncExternalStore(subscribe, foreground, () => true);
  return scope && active;
}
export function PollingScope({ active, children }: { active: boolean; children: ReactNode }) {
  const parent = useContext(Activity);
  return <Activity.Provider value={parent && active}>{children}</Activity.Provider>;
}
export function useAdaptiveRefresh(minimum = 0) {
  const active = useRefreshActivity();
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

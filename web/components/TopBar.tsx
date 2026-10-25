"use client";
import { useI18n } from "../lib/use-i18n";

import { usePollingQuery as useQuery } from "../lib/use-polling-query";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { useTerminal } from "../store/terminal";
import DisplaySettings from "./DisplaySettings";
import { useInterface } from "../store/interface";
import PwaSupport from "./PwaSupport";

type Status = {
  ok: boolean;
  providers: Array<{ name: string; ok: number; failed: number; lastLatencyMs: number | null }>;
  ai: boolean;
};

function Clock({ tz, label }: { tz: string; label: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return null;
  return (
    <span className="dim">
      {label}{" "}
      <span className="text-[var(--text)]">
        {now.toLocaleTimeString("en-GB", { timeZone: tz, hour12: false })}
      </span>
    </span>
  );
}

function marketStateNY(): { label: string; open: boolean } {
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 570 && mins < 960; // 09:30–16:00
  return { label: open ? "NYSE OPEN" : "NYSE CLOSED", open };
}

export default function TopBar() {
  const { t: ui } = useI18n();

  const setCommandOpen = useTerminal((s) => s.setCommandOpen);
  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const mode = useInterface(s => s.mode), setMode = useInterface(s => s.setMode);
  const { data: status } = useQuery({
    queryKey: ["status"],
    queryFn: () => apiGet<Status>("/api/status"),
    refetchInterval: 30_000,
  });

  const market = marketStateNY();
  const healthy = status?.providers.filter((p) => p.ok > 0) ?? [];

  return (
    <header className="flex items-center gap-2 px-3 min-h-8 topbar bg-[var(--panel-2)] border-b border-[var(--border)] text-[11px] shrink-0">
      <span className="amber font-bold tracking-widest">OPENTERMINAL</span>
      <span className={`market-status ${market.open ? "up" : "down"}`}>● {ui(market.label)}</span>
      <label className="mode-control">{ui("Mode")} <select aria-label={ui("Interface mode")} value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="simple">{ui("Simple")}</option><option value="professional">{ui("Professional")}</option></select></label>
      <button
        className="term-btn flex-1 max-w-md min-w-0 text-left dim topbar-search"
        onClick={() => setCommandOpen(true)}
      >
        {activeSymbol} {ui("— search symbols, features…")} <span className="float-right">⌘K</span>
      </button>
      <button className="term-btn" aria-label={ui("Research {symbol}", { symbol: activeSymbol })} onClick={() => useTerminal.getState().openResearch(activeSymbol)}>{ui("Research")}</button>
      <DisplaySettings />
      <PwaSupport />
      <button className="term-btn" onClick={async()=>{await fetch("/api/session",{method:"DELETE"});window.location.assign("/login");}}>{ui("Sign out")}</button>
      <details className="connection-details"><summary>{ui("Connection status")}</summary><div className="connection-popover">
      <div className="flex gap-3 flex-wrap"><Clock tz="America/New_York" label="NY" /><Clock tz="Europe/London" label="LDN" /><Clock tz="Asia/Tokyo" label="TYO" /></div>
      <span className="dim">{ui("feeds:")}{" "}
        {healthy.length > 0
          ? healthy.map((p) => `${p.name} ${p.lastLatencyMs ?? "—"}ms`).join(" · ")
          : ui("connecting…")}
      </span>
      <span className={`ai-status ${status?.ai ? "up" : "dim"}`}>AI {status?.ai ? "●" : "○"}</span>
      </div></details>
    </header>
  );
}

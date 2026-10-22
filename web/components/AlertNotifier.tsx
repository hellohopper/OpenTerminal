"use client";
import { useI18n } from "../lib/use-i18n";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import {
  ALERT_CURSOR_KEY,
  DESKTOP_ALERTS_KEY,
  describeAlert,
  readAlertCursor,
  type AlertDelivery,
  type AlertEvent,
} from "../lib/alerts";
import { useTerminal } from "../store/terminal";

export default function AlertNotifier() {
  const { t: ui } = useI18n();

  const qc = useQueryClient();
  const [after, setAfter] = useState<number | null>(null);
  const [toasts, setToasts] = useState<AlertEvent[]>([]);
  const [desktopError, setDesktopError] = useState(false);
  const mountedAt = useRef(Date.now());
  const cursor = useRef(0);
  useEffect(() => {
    cursor.current = readAlertCursor();
    setAfter(cursor.current);
    const sync = (event: StorageEvent) => {
      if (event.key === ALERT_CURSOR_KEY) {
        cursor.current = readAlertCursor();
        setAfter(cursor.current);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  const { data } = useQuery({
    queryKey: ["alert-delivery", after],
    queryFn: () => apiGet<AlertDelivery>(`/api/alerts/events?after=${after}`),
    enabled: after !== null,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    staleTime: 0,
    retry: 1,
  });
  useEffect(() => {
    if (!data || after === null) return;
    let cancelled = false;
    const deliver = () => {
      if (cancelled) return;
      const writeCursor = (id: number) => {
        cursor.current = id;
        try {
          localStorage.setItem(ALERT_CURSOR_KEY, String(id));
        } catch {
          /* In-memory delivery still works without browser storage. */
        }
        setAfter(id);
      };
      if (data.reset) {
        writeCursor(0);
        return;
      }
      const seen = Math.max(cursor.current, readAlertCursor());
      const unseen = data.events.filter((event) => event.id > seen);
      if (unseen.length) {
        setToasts((previous) => [...previous, ...unseen].slice(-5));
        qc.invalidateQueries({ queryKey: ["price-alerts"] });
        qc.invalidateQueries({ queryKey: ["alert-history"] });
      }
      writeCursor(Math.max(seen, data.nextCursor));
      let desktop = false;
      try {
        desktop = localStorage.getItem(DESKTOP_ALERTS_KEY) === "true";
      } catch {
        /* Desktop delivery requires an explicit saved preference. */
      }
      if (
        !desktop ||
        !("Notification" in window) ||
        Notification.permission !== "granted"
      )
        return;
      // Old events are surfaced in-app, but never replayed as a desktop-notification burst.
      for (const event of unseen
        .filter((e) => Date.parse(e.created_at) >= mountedAt.current)
        .slice(-5)) {
        try {
          const notification = new Notification(
            event.label || `${event.symbol} price alert`,
            {
              body: describeAlert(event),
              tag: `openterminal-alert-${event.id}`,
            },
          );
          notification.onclick = () => {
            window.focus();
            openAlerts(event.symbol);
            notification.close();
          };
        } catch {
          setDesktopError(true);
        }
      }
    };
    // Serialize delivery across tabs where Web Locks is available. Notification tags
    // and the shared cursor also reduce duplicates on browsers without it.
    const job = navigator.locks
      ? navigator.locks.request("openterminal-alert-delivery", deliver)
      : Promise.resolve().then(deliver);
    void job.catch(() => {
      if (!cancelled) deliver();
    });
    return () => {
      cancelled = true;
    };
  }, [data, after, qc]);
  function openAlerts(symbol?: string) {
    const terminal = useTerminal.getState();
    if (symbol) terminal.setActiveSymbol(symbol);
    if (!terminal.widgets.some((w) => w.type === "alerts"))
      terminal.addWidget("alerts");
  }
  if (!toasts.length && !desktopError) return null;
  return (
    <aside
      aria-label={ui("Price alert notifications")}
      aria-live="polite"
      className="fixed top-16 right-3 z-[100] w-80 max-w-[90vw] space-y-2"
    >
      {toasts.map((event) => (
        <div
          key={event.id}
          className="border border-[var(--amber-dim)] bg-[var(--panel-2)] p-3 shadow-xl"
        >
          <div className="flex gap-2">
            <strong className="amber">
              {event.label || `${event.symbol} alert`}
            </strong>
            <button
              aria-label={`Dismiss alert event ${event.id}`}
              className="ml-auto dim"
              onClick={() =>
                setToasts((t) => t.filter((e) => e.id !== event.id))
              }
            >
              ✕
            </button>
          </div>
          <p>{describeAlert(event)}</p>
          <p className="dim text-[10px]">
            {new Date(event.created_at).toLocaleString()} · {event.source}
          </p>
          <button
            className="term-btn mt-1"
            onClick={() => openAlerts(event.symbol)}
          >{ui("View alerts")} </button>
        </div>
      ))}
      {desktopError && (
        <div className="border border-[var(--border)] bg-[var(--panel-2)] p-2">
          <p className="dim">{ui("Desktop notification unavailable. Alerts are saved in history.")} </p>
          <button className="term-btn" onClick={() => setDesktopError(false)}>{ui("Dismiss")} </button>
        </div>
      )}
    </aside>
  );
}

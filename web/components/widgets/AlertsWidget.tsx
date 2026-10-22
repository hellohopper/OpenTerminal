"use client";
import { useI18n } from "../../lib/use-i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api";
import {
  ALERT_CONDITIONS,
  DESKTOP_ALERTS_KEY,
  alertNumber,
  describeAlert,
  type AlertCondition,
  type AlertRule,
  type AlertEvent,
  type AlertStatus,
} from "../../lib/alerts";
import { useTerminal } from "../../store/terminal";

type Form = {
  metric?: "native" | "volume";
  repeat_seconds?: number;
  id?: number;
  symbol: string;
  condition: AlertCondition;
  threshold: string;
  label: string;
  armed: boolean;
};
const blank = (symbol: string): Form => ({
  symbol,
  metric: "native",
  repeat_seconds: 0,
  condition: "PRICE_ABOVE",
  threshold: "",
  label: "",
  armed: true,
});
export default function AlertsWidget({ initialSymbol }: { initialSymbol?: string } = {}) {
  const { t: ui } = useI18n();

  const activeSymbol = useTerminal((s) => s.activeSymbol);
  const symbol = initialSymbol ?? activeSymbol;
  const qc = useQueryClient();
  const [form, setForm] = useState<Form>(() => blank(symbol));
  const [message, setMessage] = useState("");
  const [desktop, setDesktop] = useState(false);
  const [before, setBefore] = useState<number | undefined>();
  useEffect(() => {
    const sync = () => {
      try {
        setDesktop(
          localStorage.getItem(DESKTOP_ALERTS_KEY) === "true" &&
            "Notification" in window &&
            Notification.permission === "granted",
        );
      } catch {
        setDesktop(false);
      }
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("openterminal:desktop-alerts", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("openterminal:desktop-alerts", sync);
    };
  }, []);
  const { data, error } = useQuery({
    queryKey: ["price-alerts"],
    queryFn: () =>
      apiGet<{ alerts: AlertRule[]; monitor: AlertStatus }>("/api/alerts"),
    refetchInterval: 10000,
  });
  const { data: history, error: historyError } = useQuery({
    queryKey: ["alert-history", before],
    queryFn: () =>
      apiGet<{ events: AlertEvent[]; nextCursor: number | null }>(
        `/api/alerts/history${before ? `?before=${before}` : ""}`,
      ),
    refetchInterval: 10000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["price-alerts"] });
    qc.invalidateQueries({ queryKey: ["alert-history"] });
  };
  const save = useMutation({
    mutationFn: () => {
      if (!form.threshold.trim()) throw new Error("Enter a threshold.");
      const body = {
        symbol: form.symbol,
        condition: form.condition,
        threshold: Number(form.threshold),
        label: form.label,
        armed: form.armed,
        metric: form.metric ?? "native",
        repeat_seconds: form.repeat_seconds ?? 0,
      };
      return form.id
        ? apiPut(`/api/alerts/${form.id}`, body)
        : apiPost("/api/alerts", body);
    },
    onSuccess: () => {
      refresh();
      setForm(blank(symbol));
      setMessage(
        "Alert saved. One-shot rules stop after firing; repeating rules respect their cooldown.",
      );
    },
    onError: (err) => setMessage(err.message),
  });
  const check = useMutation({
    mutationFn: () =>
      apiPost<{ triggered: number; deferred: boolean }>(
        "/api/alerts/check",
        {},
      ),
    onSuccess: (result) => {
      refresh();
      qc.invalidateQueries({ queryKey: ["alert-delivery"] });
      setMessage(
        result.deferred
          ? "A recent check already ran. The next scheduled check will include your changes."
          : `Check complete: ${result.triggered} alert(s) triggered. See monitor status for missing feeds.`,
      );
    },
    onError: (err) => setMessage(err.message),
  });
  const mutateRule = async (rule: AlertRule, remove = false) => {
    try {
      if (remove) {
        if (
          !confirm(
            `Delete alert for ${rule.symbol}? Trigger history will be kept.`,
          )
        )
          return;
        await apiDelete(`/api/alerts/${rule.id}`);
        if (form.id === rule.id) setForm(blank(symbol));
      } else await apiPut(`/api/alerts/${rule.id}`, { armed: !rule.armed });
      refresh();
      setMessage(
        remove
          ? "Alert deleted; history retained."
          : rule.armed
            ? "Alert paused."
            : "Alert rearmed for the next fresh sample.",
      );
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  const toggleDesktop = async () => {
    try {
      if (!desktop) {
        if (!("Notification" in window) || !window.isSecureContext) {
          setMessage(
            "Desktop notifications require a supported browser on localhost or HTTPS. In-app alerts still work.",
          );
          return;
        }
        const permission =
          Notification.permission === "granted"
            ? "granted"
            : await Notification.requestPermission();
        if (permission !== "granted") {
          setMessage(
            "Desktop permission was not granted. In-app alerts and history still work.",
          );
          return;
        }
      }
      localStorage.setItem(DESKTOP_ALERTS_KEY, String(!desktop));
      setDesktop(!desktop);
      window.dispatchEvent(new Event("openterminal:desktop-alerts"));
      setMessage(
        desktop
          ? "Desktop notifications disabled."
          : "Desktop notifications enabled while this terminal is open.",
      );
    } catch {
      setMessage(
        "Could not enable desktop notifications. In-app alerts still work.",
      );
    }
  };
  const percent = form.condition.startsWith("CHANGE_");
  return (
    <div className="p-2 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="term-btn"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          {check.isPending ? ui("Checking…") : ui("Check now")}
        </button>
        <button
          className={`term-btn ${desktop ? "active" : ""}`}
          onClick={toggleDesktop}
        >
          {desktop
            ? ui("Disable desktop notifications")
            : ui("Enable desktop notifications")}
        </button>
        <span className="dim">
          {data?.alerts.filter((r) => r.armed).length ?? 0} {ui("enabled")} </span>
      </div>
      {(error || historyError) && (
        <p role="alert" className="down">
          {(error || historyError)?.message}
        </p>
      )}
      <form
        className="space-y-2 border border-[var(--border)] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="flex gap-2 flex-wrap">
          <input
            aria-label={ui("Alert symbol")}
            required
            maxLength={20}
            className="w-28"
            value={form.symbol}
            onChange={(e) =>
              setForm({ ...form, symbol: e.target.value.toUpperCase() })
            }
          />
          <button
            type="button"
            className="term-btn"
            onClick={() => setForm({ ...form, symbol })}
          >{ui("Use")} {symbol}
          </button>
          <select
            aria-label={ui("Alert metric")}
            value={form.metric ?? "native"}
            onChange={(e) =>
              setForm({
                ...form,
                metric: e.target.value as "native" | "volume",
                condition: "PRICE_ABOVE",
                threshold: "",
              })
            }
          >
            <option value="native">{ui("Price / day change")}</option>
            <option value="volume">{ui("Volume")}</option>
          </select>
          <select
            aria-label={ui("Alert condition")}
            value={form.condition}
            onChange={(e) =>
              setForm({
                ...form,
                condition: e.target.value as AlertCondition,
                threshold: "",
              })
            }
          >
            {Object.entries(ALERT_CONDITIONS)
              .filter(
                ([key]) => form.metric !== "volume" || key.startsWith("PRICE_"),
              )
              .map(([value, label]) => (
                <option key={value} value={value}>
                  {form.metric === "volume"
                    ? label.replace("Price", "Volume")
                    : label}
                  {value.startsWith("CHANGE_") ? " (%)" : ""}
                </option>
              ))}
          </select>
          <input
            aria-label={ui("Alert threshold")}
            type="number"
            step="any"
            required
            placeholder={
              form.condition === "CHANGE_BELOW"
                ? "-5"
                : percent
                  ? "5"
                  : ui("Target price")
            }
            min={
              percent
                ? form.condition === "CHANGE_BELOW"
                  ? -100
                  : 0
                : "0.000000000001"
            }
            max={
              form.condition === "CHANGE_BELOW" ? 0 : percent ? 1000000 : 1e15
            }
            value={form.threshold}
            onChange={(e) => setForm({ ...form, threshold: e.target.value })}
          />
        </div>
        <label>{ui("Repeat cooldown (seconds, 0 = once)")} <input
            aria-label={ui("Alert repeat seconds")}
            type="number"
            min="0"
            max="86400"
            value={form.repeat_seconds ?? 0}
            onChange={(e) =>
              setForm({ ...form, repeat_seconds: Number(e.target.value) })
            }
          />
        </label>
        <div className="flex gap-2 flex-wrap">
          <input
            aria-label={ui("Alert label")}
            maxLength={120}
            placeholder={ui("Optional label")}
            className="flex-1 min-w-32"
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
          <label>
            <input
              type="checkbox"
              checked={form.armed}
              onChange={(e) => setForm({ ...form, armed: e.target.checked })}
            />{" "}{ui("Enable / rearm")} </label>
          <button className="term-btn" disabled={save.isPending}>
            {form.id ? ui("Update alert") : ui("Create alert")}
          </button>
          {form.id && (
            <button
              className="term-btn"
              type="button"
              onClick={() => setForm(blank(symbol))}
            >{ui("Cancel edit")} </button>
          )}
        </div>
        <p className="dim text-[10px]">{ui("Price thresholds use the instrument’s quote currency; daily falls use negative percentages. Conditions include equality. If already met, the first fresh check triggers the alert.")} </p>
      </form>
      {message && (
        <p role="status" className="amber">
          {message}
        </p>
      )}
      <div className="dim text-[10px]">
        {data?.monitor.running ? ui("Monitor running") : ui("Monitor not running")} ·{" "}
        {data?.monitor.checking
          ? ui("Fetching fresh quotes…")
          : `Checks every ${(data?.monitor.intervalMs ?? 15000) / 1000}s`}{" "}{ui("· Last completed:")}{" "}
        {data?.monitor.lastCheckedAt
          ? new Date(data.monitor.lastCheckedAt).toLocaleString()
          : ui("not yet")}
      </div>
      {data?.monitor.lastError && (
        <p className="amber">{data.monitor.lastError}</p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>{ui("Symbol / label")}</th>
            <th>{ui("Condition")}</th>
            <th>{ui("Threshold")}</th>
            <th>{ui("Last value")}</th>
            <th>{ui("Status")}</th>
            <th>{ui("Actions")}</th>
          </tr>
        </thead>
        <tbody>
          {data?.alerts.map((rule) => (
            <tr key={rule.id}>
              <td>
                {rule.symbol}
                {rule.label && <div className="dim">{rule.label}</div>}
              </td>
              <td>
                {rule.metric === "volume"
                  ? ALERT_CONDITIONS[rule.condition].replace("Price", "Volume")
                  : ALERT_CONDITIONS[rule.condition]}
                {rule.repeat_seconds ? ` · repeat ${rule.repeat_seconds}s` : ""}
              </td>
              <td>
                {alertNumber(rule.threshold)}
                {rule.condition.startsWith("CHANGE_") ? "%" : ""}
              </td>
              <td>
                {rule.last_value === null ? "—" : alertNumber(rule.last_value)}
              </td>
              <td className={rule.armed ? "up" : "dim"}>
                {rule.armed
                  ? ui("Enabled")
                  : rule.last_checked_at &&
                      rule.last_checked_at === rule.last_triggered_at
                    ? ui("Triggered")
                    : ui("Paused")}
              </td>
              <td>
                <div className="flex gap-1 justify-end">
                  <button
                    className="term-btn"
                    onClick={() =>
                      setForm({
                        ...rule,
                        armed: !!rule.armed,
                        threshold: String(rule.threshold),
                      })
                    }
                  >{ui("Edit")} </button>
                  <button
                    className="term-btn"
                    onClick={() => void mutateRule(rule)}
                  >
                    {rule.armed ? ui("Pause") : ui("Rearm")}
                  </button>
                  <button
                    className="term-btn"
                    onClick={() => void mutateRule(rule, true)}
                  >{ui("Delete")} </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data?.alerts.length === 0 && (
        <p className="dim">{ui("No alerts yet. Create a rule above; it is shared across your workspaces.")} </p>
      )}
      <details>
        <summary className="cursor-pointer amber">{ui("Trigger history")}</summary>
        {history?.events.map((event) => (
          <article
            key={event.id}
            className="border-b border-[var(--border)] py-2"
          >
            <p>{describeAlert(event)}</p>
            {event.label && <p className="dim">{event.label}</p>}
            <p className="dim text-[10px]">{ui("Triggered:")} {new Date(event.created_at).toLocaleString()} ·{" "}
              {event.source} {ui("· Feed as of:")} {event.observed_at ?? ui("not supplied")}
            </p>
          </article>
        ))}
        {history?.events.length === 0 && (
          <p className="dim">{ui("No triggers recorded.")}</p>
        )}
        {history?.nextCursor && (
          <button
            className="term-btn"
            onClick={() => setBefore(history.nextCursor!)}
          >{ui("Older events")} </button>
        )}
        {before && (
          <button className="term-btn" onClick={() => setBefore(undefined)}>{ui("Latest events")} </button>
        )}
      </details>
      <p className="dim text-[10px]">{ui("Keep the API running for background checks. Closing the browser keeps trigger history; desktop notifications require an open terminal and browser permission. Reopening shows missed events in-app. At most 100 saved rules / 20 enabled symbols. Polling can miss brief crossings; indicative or delayed data, not execution-grade. Failed refreshes never trigger from stale fallback data.")} </p>
    </div>
  );
}

import { db } from "./db.js";
import { getQuotes } from "./routes/market.js";
import type { Quote } from "./providers/yahoo.js";
export const ALERT_INTERVAL_MS = 15000;
export const MAX_ALERTS = 100;
export const MAX_ALERT_SYMBOLS = 20;
export type AlertCondition =
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "CHANGE_ABOVE"
  | "CHANGE_BELOW";
export type AlertRule = {
  metric?: "native" | "volume";
  repeat_seconds?: number;
  id: number;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
  label: string;
  armed: number;
  revision: number;
  generation: string;
  created_at: string;
  last_checked_at: string | null;
  last_value: number | null;
  last_triggered_at: string | null;
};
export type AlertEvent = {
  id: number;
  metric?: "native" | "volume";
  alert_id: number | null;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
  label: string;
  value: number;
  price: number;
  currency: string | null;
  source: string;
  observed_at: string | null;
  created_at: string;
};
export const activeAlerts = async () =>
  (await db
    .prepare("SELECT * FROM price_alerts WHERE armed=1 ORDER BY id")
    .all()) as AlertRule[];
export function alertValue(
  rule: Pick<AlertRule, "condition" | "metric">,
  quote: Quote,
): number | null {
  if (!Number.isFinite(quote.price) || quote.price! <= 0) return null;
  const value =
    rule.metric === "volume"
      ? quote.volume
      : rule.condition.startsWith("PRICE_")
        ? quote.price
        : quote.changePercent;
  return value != null &&
    Number.isFinite(value) &&
    (rule.metric !== "volume" || value >= 0)
    ? value
    : null;
}
export function matchesAlert(
  rule: Pick<AlertRule, "condition" | "threshold" | "metric">,
  quote: Quote,
): number | null {
  const value = alertValue(rule, quote);
  if (value === null) return null;
  return (
    rule.condition.endsWith("ABOVE")
      ? value >= rule.threshold
      : value <= rule.threshold
  )
    ? value
    : null;
}
/** Disarm and append the immutable delivery event atomically; old in-flight revisions cannot fire. */
export async function evaluateAlerts(
  rules: AlertRule[],
  quotes: Quote[],
  now = new Date(),
): Promise<number> {
  const bySymbol = new Map(quotes.map((q) => [q.symbol, q]));
  return await db.transaction(async () => {
    let fired = 0;
    for (const rule of rules) {
      if (
        rule.repeat_seconds &&
        rule.last_triggered_at &&
        now.getTime() - Date.parse(rule.last_triggered_at) <
          rule.repeat_seconds * 1000
      )
        continue;
      const quote = bySymbol.get(rule.symbol);
      if (!quote) continue;
      const value = alertValue(rule, quote);
      if (value === null) continue;
      const triggered = matchesAlert(rule, quote) !== null;
      const changed = await db
        .prepare(
          "UPDATE price_alerts SET last_checked_at=?,last_value=?,armed=?,last_triggered_at=CASE WHEN ?=1 THEN ? ELSE last_triggered_at END,revision=revision+? WHERE id=? AND armed=1 AND revision=? AND generation=?",
        )
        .run(
          now.toISOString(),
          value,
          triggered && !rule.repeat_seconds ? 0 : 1,
          triggered ? 1 : 0,
          now.toISOString(),
          triggered ? 1 : 0,
          rule.id,
          rule.revision,
          rule.generation ?? "legacy",
        );
      if (!changed.changes || !triggered) continue;
      const observed = quote.time === null ? null : new Date(quote.time * 1000);
      await db
        .prepare(
          "INSERT INTO price_alert_events (alert_id,symbol,condition,threshold,label,value,price,currency,source,observed_at,created_at,metric) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          rule.id,
          rule.symbol,
          rule.condition,
          rule.threshold,
          rule.label,
          value,
          quote.price,
          quote.currency,
          quote.source,
          observed && Number.isFinite(observed.getTime())
            ? observed.toISOString()
            : null,
          now.toISOString(),
          rule.metric ?? "native",
        );
      fired++;
    }
    return fired;
  })();
}
export function createAlertMonitor(
  loadQuotes: (symbols: string[], signal: AbortSignal) => Promise<Quote[]>,
  intervalMs = ALERT_INTERVAL_MS,
) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let controller: AbortController | undefined;
  let inFlight: Promise<{
    triggered: number;
    deferred: boolean;
  }> | null = null;
  let lastStarted = 0;
  let lastCheckedAt: string | null = null;
  let lastError: string | null = null;
  let missingSymbols: string[] = [];
  const status = () => ({
    running: !!timer,
    checking: !!inFlight,
    intervalMs,
    lastCheckedAt,
    lastError,
    missingSymbols,
    nextCheckAt: lastStarted
      ? new Date(lastStarted + intervalMs).toISOString()
      : null,
  });
  function check(): Promise<{ triggered: number; deferred: boolean }> {
    if (inFlight) return inFlight;
    controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(20000),
    ]);
    inFlight = Promise.resolve().then(async () => {
      let checked = false;
      try {
        const rules = await activeAlerts();
        if (!rules.length) return { triggered: 0, deferred: false };
        if (lastStarted && Date.now() - lastStarted < intervalMs)
          return { triggered: 0, deferred: true };
        lastStarted = Date.now();
        checked = true;
        const symbols = [...new Set(rules.map((r) => r.symbol))];
        const quotes = await loadQuotes(symbols, signal);
        signal.throwIfAborted();
        missingSymbols = symbols.filter((s) => {
          const quote = quotes.find((q) => q.symbol === s);
          return (
            !quote ||
            rules.some((r) => r.symbol === s && alertValue(r, quote) === null)
          );
        });
        lastError = missingSymbols.length
          ? `Fresh quotes unavailable for ${missingSymbols.join(", ")}.`
          : null;
        return {
          triggered: await evaluateAlerts(rules, quotes),
          deferred: false,
        };
      } catch {
        lastError =
          "Quote refresh or database check failed. Active alerts will be retried.";
        return { triggered: 0, deferred: false };
      } finally {
        if (checked) lastCheckedAt = new Date().toISOString();
        inFlight = null;
        controller = undefined;
      }
    });
    return inFlight;
  }
  return {
    check,
    status,
    start: () => {
      if (timer) return;
      timer = setInterval(() => {
        void check();
      }, intervalMs);
      timer.unref();
      void check();
    },
    stop: () => {
      clearInterval(timer);
      timer = undefined;
      controller?.abort();
      return inFlight;
    },
  };
}
export const alertMonitor = createAlertMonitor((symbols, signal) =>
  getQuotes(symbols, { allowStale: false, includeFundamentals: false, signal }),
);

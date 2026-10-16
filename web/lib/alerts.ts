export const ALERT_CONDITIONS = {
  PRICE_ABOVE: "Price ≥",
  PRICE_BELOW: "Price ≤",
  CHANGE_ABOVE: "Day change ≥",
  CHANGE_BELOW: "Day change ≤",
};
export type AlertCondition = keyof typeof ALERT_CONDITIONS;
export type AlertRule = {
  id: number;
  symbol: string;
  condition: AlertCondition;
  threshold: number;
  label: string;
  armed: number;
  created_at: string;
  last_checked_at: string | null;
  last_value: number | null;
  last_triggered_at: string | null;
};
export type AlertEvent = {
  id: number;
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
export type AlertStatus = {
  running: boolean;
  checking: boolean;
  intervalMs: number;
  lastCheckedAt: string | null;
  lastError: string | null;
  missingSymbols: string[];
  nextCheckAt: string | null;
};
export type AlertDelivery = {
  events: AlertEvent[];
  nextCursor: number;
  reset: boolean;
};
export const ALERT_CURSOR_KEY = "openterminal-alert-cursor-v1";
export const DESKTOP_ALERTS_KEY = "openterminal-desktop-alerts-v1";
export const alertNumber = (value: number) =>
  value.toLocaleString("en-US", { maximumSignificantDigits: 10 });
export function describeAlert(
  event: Pick<
    AlertEvent,
    "symbol" | "condition" | "threshold" | "value" | "currency"
  >,
): string {
  const suffix = event.condition.startsWith("CHANGE_")
    ? "%"
    : event.currency
      ? ` ${event.currency}`
      : " quote units";
  return `${event.symbol}: ${ALERT_CONDITIONS[event.condition]} ${alertNumber(event.threshold)}${suffix}; observed ${alertNumber(event.value)}${suffix}`;
}
export function readAlertCursor(): number {
  try {
    const value = Number(localStorage.getItem(ALERT_CURSOR_KEY) ?? 0);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

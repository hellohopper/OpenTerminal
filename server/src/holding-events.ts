import { createHash } from "node:crypto";
import type { EarningsInfo } from "./providers/tradingview.js";
import type { EconEvent } from "./providers/econcalendar.js";
import type { Quote } from "./providers/yahoo.js";
export type HeldAsset = { symbol: string; quantity: number };
export type HoldingEvent = {
  id: string;
  kind: "earnings" | "macro";
  title: string;
  date: string;
  allDay: boolean;
  symbol: string | null;
  impact: string;
  source: string;
  note: string;
  exposure: {
    symbol: string;
    quantity: number;
    marketValue: number | null;
    weight: number | null;
  }[];
};
const id = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 32);
export function assembleHoldingEvents(
  symbols: string[],
  holdings: HeldAsset[],
  earnings: EarningsInfo[],
  economic: EconEvent[],
  quotes: Quote[],
  days: number,
  now = new Date(),
) {
  const until = now.getTime() + days * 86400000,
    startDay = Date.parse(now.toISOString().slice(0, 10));
  const exposure = holdings
    .filter((h) => h.quantity > 0)
    .map((h) => {
      const q = quotes.find((q) => q.symbol === h.symbol),
        fetched = Date.parse(q?.retrievedAt ?? "");
      const valid =
        q &&
        q.currency === "USD" &&
        !q.stale &&
        Number.isFinite(q.price) &&
        q.price! > 0 &&
        Number.isFinite(fetched) &&
        now.getTime() - fetched <= 120000 &&
        fetched <= now.getTime() + 300000;
      const value = valid ? q!.price! * h.quantity : null;
      return {
        ...h,
        marketValue: value !== null && Number.isFinite(value) ? value : null,
        weight: null as number | null,
      };
    });
  const complete = exposure.every((h) => h.marketValue !== null),
    total = complete
      ? exposure.reduce((sum, h) => sum + h.marketValue!, 0)
      : null;
  for (const h of exposure)
    h.weight =
      total && Number.isFinite(total) ? (h.marketValue! / total) * 100 : null;
  const events: HoldingEvent[] = [];
  for (const e of earnings) {
    const time = e.nextEarningsDate === null ? NaN : e.nextEarningsDate * 1000;
    if (
      !symbols.includes(e.symbol) ||
      !Number.isFinite(time) ||
      time < startDay ||
      time > until
    )
      continue;
    const date = new Date(time).toISOString().slice(0, 10);
    events.push({
      id: id(`earnings:${e.symbol}:${date}`),
      kind: "earnings",
      title: `${e.symbol} earnings`,
      date,
      allDay: true,
      symbol: e.symbol,
      impact: "Company",
      source: "TradingView",
      note: "Expected release date; intraday session is unverified. Check the issuer calendar.",
      exposure: exposure.filter((h) => h.symbol === e.symbol),
    });
  }
  for (const e of economic) {
    const time = Date.parse(e.date);
    if (
      !Number.isFinite(time) ||
      time < now.getTime() ||
      time > until ||
      !["High", "Medium"].includes(e.impact)
    )
      continue;
    events.push({
      id: id(`macro:${e.country}:${e.title}:${new Date(time).toISOString()}`),
      kind: "macro",
      title: `${e.country} · ${e.title.slice(0, 200)}`,
      date: new Date(time).toISOString(),
      allDay: false,
      symbol: null,
      impact: e.impact,
      source: "Forex Factory / FRED",
      note: "Broad market context for the selected holdings; this does not predict a company-specific impact.",
      exposure,
    });
  }
  const unique = [...new Map(events.map((e) => [e.id, e])).values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  return {
    events: unique,
    exposure,
    valuationComplete: complete,
    holdingsValue: total,
    missingEarnings: symbols.filter(
      (s) =>
        !earnings.some(
          (e) =>
            e.symbol === s &&
            e.nextEarningsDate !== null &&
            Number.isFinite(e.nextEarningsDate),
        ),
    ),
  };
}

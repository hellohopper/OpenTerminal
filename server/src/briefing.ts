import { cached } from "./cache.js";
import { mapWithConcurrency } from "./concurrency.js";
import { getQuotes } from "./routes/market.js";
import type { Quote } from "./providers/yahoo.js";
import * as news from "./providers/news.js";
import * as tradingview from "./providers/tradingview.js";
import * as econ from "./providers/econcalendar.js";
export type BriefingMode = "pre-market" | "after-close";
export function assembleBriefing(symbols: string[], mode: BriefingMode, parts: { quotes: Quote[]; news: news.NewsItem[]; earnings: tradingview.EarningsInfo[]; economic: econ.EconEvent[]; warnings: string[] }, now = new Date()) {
  const from = now.getTime(), until = from + 7 * 86400000;
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const quotes = parts.quotes.filter((q) => symbols.includes(q.symbol));
  const movers = [...quotes].filter((q) => q.changePercent !== null).sort((a, b) => Math.abs(b.changePercent!) - Math.abs(a.changePercent!));
  const missing = symbols.filter((s) => !quotes.some((q) => q.symbol === s && q.price !== null));
  const indexes = parts.quotes.filter((q) => ["SPY", "QQQ"].includes(q.symbol));
  const earnings = parts.earnings.filter((e) => e.nextEarningsDate !== null && e.nextEarningsDate * 1000 >= Date.parse(now.toISOString().slice(0, 10)) && e.nextEarningsDate * 1000 <= until).sort((a, b) => a.nextEarningsDate! - b.nextEarningsDate!);
  const economic = parts.economic.filter((e) => e.impact === "High" && Date.parse(e.date) >= from && Date.parse(e.date) <= until).sort((a, b) => a.date.localeCompare(b.date));
  const headlines = news.dedupe([parts.news]).filter((n) => { try { return ["https:", "http:"].includes(new URL(n.link).protocol); } catch { return false; } }).filter((n) => n.publishedAt && Date.parse(n.publishedAt) >= from - 72 * 3600000 && Date.parse(n.publishedAt) <= from).slice(0, 20);
  const warnings = [...parts.warnings, ...(missing.length ? [`Quotes missing: ${missing.join(", ")}.`] : [])];
  const leader = movers[0];
  const summary = quotes.length ? `${quotes.length}/${symbols.length} watched assets available. ${leader ? `${leader.symbol} has the largest absolute daily move (${leader.changePercent! >= 0 ? "+" : ""}${leader.changePercent!.toFixed(2)}%).` : "Daily changes unavailable."} ${earnings.length} earnings releases and ${economic.length} high-impact economic events in the next seven days.` : "Watchlist quotes are unavailable; see the remaining sources and warnings below.";
  return { date, mode, generatedAt: now.toISOString(), symbols, summary, quotes, movers, indexes, earnings, economic, headlines, warnings };
}
export async function generateBriefing(symbols: string[], mode: BriefingMode) {
  return cached(`briefing:${mode}:${symbols.join(",")}`, 300000, async () => {
    const parts = await Promise.allSettled([
      getQuotes([...new Set([...symbols, "SPY", "QQQ"])]),
      mapWithConcurrency(symbols, 3, async (s) => ({ symbol: s, items: await cached(`briefing-news:${s}`, 300000, () => news.symbolNews(s).catch(() => news.topNews(`${s} stock`))).catch(() => null) })),
      cached(`briefing-earnings:${symbols.join(",")}`, 3600000, () => tradingview.earningsCalendar(symbols)),
      cached("econ-calendar", 900000, () => econ.weeklyEvents()),
    ]);
    const [quotes, headlines, earnings, economic] = parts;
    const names = ["Quotes", "News", "Earnings", "Economic calendar"];
    return assembleBriefing(symbols, mode, { quotes: quotes.status === "fulfilled" ? quotes.value : [], news: headlines.status === "fulfilled" ? headlines.value.flatMap((r) => r.items ?? []) : [], earnings: earnings.status === "fulfilled" ? earnings.value : [], economic: economic.status === "fulfilled" ? economic.value : [], warnings: [...parts.flatMap((p, i) => p.status === "rejected" ? [`${names[i]} unavailable.`] : []), ...(headlines.status === "fulfilled" ? headlines.value.filter((r) => r.items === null).map((r) => `News unavailable for ${r.symbol}.`) : [])] });
  });
}

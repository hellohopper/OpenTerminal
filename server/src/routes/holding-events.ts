import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { asyncRoute } from "../async-route.js";
import { replayLedger, type Trade, type CashEvent } from "../portfolio.js";
import { assembleHoldingEvents, type HeldAsset } from "../holding-events.js";
import * as tv from "../providers/tradingview.js";
import * as econ from "../providers/econcalendar.js";
import { getQuotes } from "./market.js";
import { cacheGet, cacheSet } from "../cache.js";
export const holdingEventsRouter = Router();
const symbol = z.string().regex(/^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$/);
const schema = z.object({
  symbols: z.array(symbol).max(200),
  days: z.coerce.number().int().min(1).max(30),
  portfolioId: z.coerce.number().int().positive().safe().optional(),
});
async function fresh<T>(key: string, ttl: number, load: () => Promise<T>) {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return hit;
  const value = await load();
  cacheSet(key, value, ttl);
  return value;
}
holdingEventsRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = schema.safeParse({
      symbols: String(req.query.symbols ?? "")
        .split(",")
        .filter(Boolean),
      days: req.query.days ?? 7,
      ...(req.query.portfolioId ? { portfolioId: req.query.portfolioId } : {}),
    });
    if (!parsed.success)
      return res
        .status(400)
        .json({ error: "Use valid symbols, portfolio and a 1–30 day window." });
    const { days, portfolioId } = parsed.data;
    let holdings: HeldAsset[] = [],
      recorded: CashEvent[] = [];
    if (portfolioId) {
      const snapshot = await db.transaction(async () => {
        if (
          !(await db
            .prepare("SELECT id FROM portfolios WHERE id=?")
            .get(portfolioId))
        )
          return null;
        const trades = (await db
          .prepare(
            "SELECT * FROM transactions WHERE portfolio_id=? ORDER BY executed_at,id LIMIT 50001",
          )
          .all(portfolioId)) as Trade[];
        const cash = (await db
          .prepare(
            "SELECT * FROM portfolio_events WHERE portfolio_id=? ORDER BY executed_at,id LIMIT 50001",
          )
          .all(portfolioId)) as CashEvent[];
        if (trades.length > 50000 || cash.length > 50000)
          throw new Error("Ledger exceeds event-center limit.");
        return { trades, cash };
      })();
      if (!snapshot)
        return res.status(404).json({ error: "Portfolio not found." });
      holdings = [...replayLedger(snapshot.trades, snapshot.cash).positions]
        .filter(([, p]) => p.quantity > 0)
        .map(([symbol, p]) => ({ symbol, quantity: p.quantity }));
      if(holdings.length>200)return res.status(400).json({error:"Event center supports up to 200 open holdings per portfolio."});
      recorded = snapshot.cash
        .filter((e) => e.kind === "DIVIDEND" || e.kind === "SPLIT")
        .slice(-20)
        .reverse();
    }
    const requested = [
        ...new Set([...holdings.map((h) => h.symbol), ...parsed.data.symbols]),
      ],
      symbols = requested.slice(0, 30),
      warnings: string[] = [
        "Economic feed covers the current week only; a longer window does not imply complete coverage. Upcoming dividend and split dates are not provided. Recorded corporate actions below are historical ledger entries.",
      ];
    if (requested.length > 30)
      warnings.push(
        `Coverage limited to 30 symbols; ${requested.length - 30} symbols excluded, with holdings prioritized.`,
      );
    const parts = await Promise.allSettled([
      symbols.length
        ? fresh(
            `events:earnings:${[...symbols].sort().join(",")}`,
            3600000,
            () => tv.earningsCalendar(symbols),
          )
        : Promise.resolve([]),
      fresh("events:economic", 900000, () => econ.weeklyEvents()),
      holdings.length
        ? getQuotes(
            holdings
              .filter((h) => symbols.includes(h.symbol))
              .map((h) => h.symbol),
            { allowStale: false, includeFundamentals: false },
          )
        : Promise.resolve([]),
    ]);
    for (const [i, name] of [
      "Earnings",
      "Economic calendar",
      "Valuation quotes",
    ].entries())
      if (parts[i].status === "rejected") warnings.push(`${name} unavailable.`);
    const [earnings, economic, quotes] = parts;
    const result = assembleHoldingEvents(
      symbols,
      holdings,
      earnings.status === "fulfilled" ? earnings.value : [],
      economic.status === "fulfilled" ? economic.value : [],
      quotes.status === "fulfilled" ? quotes.value : [],
      days,
    );
    if (result.missingEarnings.length)
      warnings.push(
        `No earnings date available: ${result.missingEarnings.join(", ")}.`,
      );
    if (!result.valuationComplete)
      warnings.push(
        "Holdings weights unavailable: fresh USD prices are missing. Quantities are still shown.",
      );
    res.json({
      ...result,
      generatedAt: new Date().toISOString(),
      symbols,
      days,
      warnings,
      recorded,
    });
  }),
);

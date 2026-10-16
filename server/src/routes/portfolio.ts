import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { replayLedger, portfolioPerformance, type Trade, type CashEvent } from "../portfolio.js";
import { cached } from "../cache.js";
import { mapWithConcurrency } from "../concurrency.js";
import { withFallback } from "../providers/registry.js";
import * as nasdaq from "../providers/nasdaq.js";
import * as yahoo from "../providers/yahoo.js";
import * as tradingview from "../providers/tradingview.js";
import { getQuotes } from "./market.js";
const tradesFor = (id: string) => db.prepare("SELECT * FROM transactions WHERE portfolio_id=? ORDER BY executed_at,id").all(id) as Trade[];
const eventsFor = (id: string) => db.prepare("SELECT * FROM portfolio_events WHERE portfolio_id=? ORDER BY executed_at,id").all(id) as CashEvent[];
const validateLedger = (id: string) => replayLedger(tradesFor(id), eventsFor(id));

export const portfolioRouter = Router();

portfolioRouter.get("/", (_req, res) => {
  res.json(db.prepare("SELECT * FROM portfolios ORDER BY id").all());
});

portfolioRouter.post("/", (req, res) => {
  const parsed = z.object({ name: z.string().min(1).max(64) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  try {
    const info = db.prepare("INSERT INTO portfolios (name) VALUES (?)").run(parsed.data.name);
    res.status(201).json({ id: info.lastInsertRowid, name: parsed.data.name });
  } catch {
    res.status(409).json({ error: "portfolio name already exists" });
  }
});

portfolioRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM transactions WHERE portfolio_id = ?").run(req.params.id);
  db.prepare("DELETE FROM portfolios WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

const txSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.^=&-]{1,20}$/),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().finite().positive(),
  price: z.number().finite().nonnegative(),
  executed_at: z.string().datetime({ offset: true }).refine((v) => Date.parse(v) <= Date.now(), "Future transactions are not supported.").transform((v) => new Date(v).toISOString()),
});

portfolioRouter.get("/:id/transactions", (req, res) => {
  res.json(
    db
      .prepare("SELECT * FROM transactions WHERE portfolio_id = ? ORDER BY executed_at DESC, id DESC")
      .all(req.params.id)
  );
});

portfolioRouter.post("/:id/transactions", (req, res) => {
  const parsed = txSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const t = parsed.data;
  try {
    const info = db.transaction(() => {
      const inserted = db
      .prepare(
        "INSERT INTO transactions (portfolio_id, symbol, side, quantity, price, executed_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(req.params.id, t.symbol, t.side, t.quantity, t.price, t.executed_at);
      validateLedger(req.params.id);
      return inserted;
    })();
    res.status(201).json({ id: info.lastInsertRowid, ...t });
  } catch (err) {
    const exists = db.prepare("SELECT id FROM portfolios WHERE id=?").get(req.params.id);
    res.status(exists ? 400 : 404).json({ error: exists ? (err as Error).message : "portfolio not found" });
  }
});

portfolioRouter.delete("/:id/transactions/:txId", (req, res) => {
  try {
    db.transaction(() => { db.prepare("DELETE FROM transactions WHERE id = ? AND portfolio_id = ?").run(req.params.txId, req.params.id); validateLedger(req.params.id); })();
    res.status(204).end();
  } catch (err) { res.status(409).json({ error: (err as Error).message }); }
});


portfolioRouter.get("/:id/positions", (req, res) => {
  try { res.json([...validateLedger(req.params.id).positions].map(([symbol, p]) => ({ symbol, ...p })).filter((p) => p.quantity > 0 || p.realizedPnl !== 0 || p.dividends !== 0)); }
  catch (err) { res.status(409).json({ error: (err as Error).message }); }
});
const eventSchema = z.object({ kind: z.enum(["DEPOSIT", "WITHDRAWAL", "DIVIDEND", "SPLIT"]), amount: z.number().finite().positive(), symbol: z.string().trim().toUpperCase().regex(/^[A-Z0-9.^=&-]{1,20}$/).nullable().optional(), executed_at: z.string().datetime({ offset: true }).refine((v) => Date.parse(v) <= Date.now(), "Future transactions are not supported.").transform((v) => new Date(v).toISOString()) }).refine((e) => !["DIVIDEND", "SPLIT"].includes(e.kind) || Boolean(e.symbol), "A symbol is required for dividends and splits.");
portfolioRouter.get("/:id/events", (req, res) => res.json(eventsFor(req.params.id)));
portfolioRouter.post("/:id/events", (req, res) => {
  const parsed = eventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  if (!db.prepare("SELECT id FROM portfolios WHERE id=?").get(req.params.id)) return res.status(404).json({ error: "portfolio not found" });
  try {
    const e = parsed.data;
    const id = db.transaction(() => { const info = db.prepare("INSERT INTO portfolio_events (portfolio_id,kind,symbol,amount,executed_at) VALUES (?,?,?,?,?)").run(req.params.id, e.kind, e.symbol ?? null, e.amount, e.executed_at); validateLedger(req.params.id); return Number(info.lastInsertRowid); })();
    res.status(201).json({ id });
  } catch (err) { res.status(400).json({ error: (err as Error).message }); }
});
portfolioRouter.delete("/:id/events/:eventId", (req, res) => {
  try { db.transaction(() => { db.prepare("DELETE FROM portfolio_events WHERE portfolio_id=? AND id=?").run(req.params.id, req.params.eventId); validateLedger(req.params.id); })(); res.status(204).end(); }
  catch (err) { res.status(409).json({ error: (err as Error).message }); }
});
portfolioRouter.get("/:id/performance", async (req, res) => {
  const trades = tradesFor(req.params.id), events = eventsFor(req.params.id);
  const symbols = [...new Set([...trades.map((t) => t.symbol), ...events.map((e) => e.symbol).filter((s): s is string => !!s)])];
  if (symbols.length > 30) return res.status(400).json({ error: "Performance supports up to 30 symbols per portfolio." });
  try {
    const rows = await mapWithConcurrency([...new Set([...symbols, "SPY"])], 3, async (symbol) => [symbol, await cached(`pf-history:${symbol}`, 300000, () => withFallback([["nasdaq", () => nasdaq.history(symbol, "1Y")], ["yahoo", () => yahoo.history(symbol, "1y", "1d")]])).catch(() => [])] as const);
    const [quotes, sectors] = await Promise.all([getQuotes(symbols).catch(() => []), cached("pf-sectors", 3600000, () => tradingview.marketScan(1500)).catch(() => [])]);
    const result = portfolioPerformance(trades, events, Object.fromEntries(rows), req.query.priceBasis === "raw" ? "raw" : req.query.priceBasis === "split-adjusted" ? "split-adjusted" : "unverified");
    if (symbols.some((s) => quotes.find((q) => q.symbol === s)?.currency !== "USD")) { result.warnings.push("USD prices could not be verified for every asset. FX conversion is not supported."); result.rows = []; result.returnPercent = result.maxDrawdown = null; }
    const positions = result.positions.map((p) => ({ ...p, sector: sectors.find((s) => s.symbol === p.symbol)?.sector ?? "Unclassified" }));
    res.json({ ...result, positions });
  } catch (err) { res.status(409).json({ error: (err as Error).message }); }
});

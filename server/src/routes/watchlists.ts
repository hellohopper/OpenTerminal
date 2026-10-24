import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { asyncRoute } from "../async-route.js";
import { records, addRecord, updateRecord, removeRecord } from "../records.js";
const symbol = z.string().trim().toUpperCase().regex(/^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$/);
const name = z.string().trim().min(1).max(64), version = z.number().int().positive();
const payload = z.object({ name, symbols: z.array(symbol).max(150).transform(a => [...new Set(a)]) });
type SharedList = z.infer<typeof payload>;
const order = async () => (await records<{ ids: number[] }>("shared-watchlist-order"))[0];
async function lists() {
  const rows = await records<SharedList>("shared-watchlist"), saved = await order();
  if (!saved) return rows; // Preserve the order of lists created before ordering was supported.
  const rank = new Map(saved.payload.ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
}
// Retain this record when the last list is deleted, so a phone cannot recreate it on refresh.
async function saveOrder(ids: number[]) {
  const saved = await order();
  if (saved) await updateRecord("shared-watchlist-order", saved.id, saved.version, { ids });
  else await addRecord("shared-watchlist-order", { ids }, "owner");
}
export const watchlistsRouter = Router();
watchlistsRouter.get("/", asyncRoute(async (_req, res) => res.json(await lists())));
watchlistsRouter.post("/default", asyncRoute(async (req,res) => {
  const p=payload.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Use a name and valid symbols."});
  const id = await db.transaction(async () => {
    const existing = await lists(); if (existing.length) return existing[0].id;
    if (await order()) return null;
    const id = await addRecord("shared-watchlist", p.data, "default"); await saveOrder([id]); return id;
  })(); res.json({id});
}));
watchlistsRouter.post("/", asyncRoute(async (req, res) => {
  const p = payload.safeParse(req.body); if (!p.success) return res.status(400).json({ error: "Use a name and up to 150 valid symbols." });
  const result = await db.transaction(async () => {
    const existing = await lists(); if (existing.length >= 20) return null;
    const id = await addRecord("shared-watchlist", p.data); await saveOrder([...existing.map(row => row.id), id]); return id;
  })();
  if (result === null) return res.status(409).json({ error: "Maximum 20 shared watchlists." });
  res.status(201).json({ id: result });
}));
watchlistsRouter.post("/:id/rename", asyncRoute(async (req, res) => {
  const p = z.object({ name, version }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Use a name and current version." });
  const result = await db.transaction(async () => {
    const row = (await lists()).find(row => row.id === Number(req.params.id));
    if (!row) return "missing";
    if (row.version !== p.data.version) return "changed";
    const value = { ...row.payload, name: p.data.name };
    await updateRecord("shared-watchlist", row.id, row.version, value);
    return { ...row, payload: value, version: row.version + 1 };
  })();
  if (result === "missing") return res.status(404).json({ error: "Watchlist no longer exists." });
  if (result === "changed") return res.status(409).json({ error: "This watchlist changed. Refresh and try again." });
  res.json(result);
}));
watchlistsRouter.delete("/:id", asyncRoute(async (req, res) => {
  const p = z.coerce.number().int().positive().safeParse(req.query.version);
  if (!p.success) return res.status(400).json({ error: "Use the current version to delete a watchlist." });
  const result = await db.transaction(async () => {
    const existing = await lists(), row = existing.find(row => row.id === Number(req.params.id));
    if (!row) return "missing";
    if (row.version !== p.data) return "changed";
    await removeRecord("shared-watchlist", row.id);
    await saveOrder(existing.filter(item => item.id !== row.id).map(item => item.id)); return "ok";
  })();
  if (result === "missing") return res.status(404).json({ error: "Watchlist no longer exists." });
  if (result === "changed") return res.status(409).json({ error: "This watchlist changed. Refresh and review it before deleting." });
  res.json({ ok: true });
}));
watchlistsRouter.post("/:id/move", asyncRoute(async (req, res) => {
  const p = z.object({ direction: z.enum(["up", "down"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Choose up or down." });
  const result = await db.transaction(async () => {
    const rows = await lists(), index = rows.findIndex(row => row.id === Number(req.params.id));
    if (index < 0) return null;
    const next = index + (p.data.direction === "up" ? -1 : 1);
    if (next >= 0 && next < rows.length) {
      [rows[index], rows[next]] = [rows[next], rows[index]]; await saveOrder(rows.map(row => row.id));
    }
    return rows;
  })();
  if (!result) return res.status(404).json({ error: "Watchlist no longer exists." });
  res.json(result);
}));
watchlistsRouter.post("/:id/reorder-symbols", asyncRoute(async (req, res) => {
  const p = z.object({ symbols: z.array(symbol).max(150), version }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Use symbols and the current version." });
  const result = await db.transaction(async () => {
    const row = (await lists()).find(row => row.id === Number(req.params.id));
    if (!row) return "missing";
    if (row.version !== p.data.version) return "changed";
    const symbols = p.data.symbols;
    if (symbols.length !== row.payload.symbols.length || new Set(symbols).size !== symbols.length || symbols.some(s => !row.payload.symbols.includes(s))) return "invalid";
    const value = { ...row.payload, symbols };
    await updateRecord("shared-watchlist", row.id, row.version, value);
    return { ...row, payload: value, version: row.version + 1 };
  })();
  if (result === "missing") return res.status(404).json({ error: "Watchlist no longer exists." });
  if (result === "changed") return res.status(409).json({ error: "This watchlist changed. Refresh and try again." });
  if (result === "invalid") return res.status(400).json({ error: "Reordering must keep every existing symbol exactly once." });
  res.json(result);
}));
watchlistsRouter.post("/:id/symbols", asyncRoute(async (req, res) => {
  const p = z.object({ symbol, action: z.enum(["add", "remove"]) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Select a valid symbol and add/remove action." });
  const result = await db.transaction(async () => {
    const row = (await lists()).find(r => r.id === Number(req.params.id)); if (!row) return null;
    const symbols = p.data.action === "remove" ? row.payload.symbols.filter(s => s !== p.data.symbol) : [...new Set([...row.payload.symbols, p.data.symbol])];
    if (symbols.length > 150) return "full" as const;
    await updateRecord("shared-watchlist", row.id, row.version, { ...row.payload, symbols });
    return { ...row, version: row.version + 1, payload: { ...row.payload, symbols } };
  })();
  if (!result) return res.status(404).json({ error: "Watchlist no longer exists." });
  if (result === "full") return res.status(409).json({ error: "Maximum 150 symbols." });
  res.json(result);
}));
watchlistsRouter.put("/:id", asyncRoute(async (req, res) => {
  const p = payload.extend({ version: z.number().int().positive() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Use a name, symbols and current version." });
  try { await db.transaction(async () => { const { version, ...value } = p.data; await updateRecord("shared-watchlist", Number(req.params.id), version, value); })(); res.json({ ok: true }); }
  catch { res.status(409).json({ error: "This watchlist changed. Refresh before replacing it." }); }
}));

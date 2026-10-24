import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { asyncRoute } from "../async-route.js";
import { records, addRecord, updateRecord } from "../records.js";
const symbol = z.string().trim().toUpperCase().regex(/^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$/);
const payload = z.object({ name: z.string().trim().min(1).max(64), symbols: z.array(symbol).max(150).transform(a => [...new Set(a)]) });
type SharedList = z.infer<typeof payload>;
const lists = () => records<SharedList>("shared-watchlist");
export const watchlistsRouter = Router();
watchlistsRouter.get("/", asyncRoute(async (_req, res) => res.json(await lists())));
watchlistsRouter.post("/default", asyncRoute(async (req,res) => {
  const p=payload.safeParse(req.body);if(!p.success)return res.status(400).json({error:"Use a name and valid symbols."});
  const id=await db.transaction(async()=>{const existing=(await lists()).at(-1);return existing?.id ?? await addRecord("shared-watchlist",p.data,"default");})();res.json({id});
}));
watchlistsRouter.post("/", asyncRoute(async (req, res) => {
  const p = payload.safeParse(req.body); if (!p.success) return res.status(400).json({ error: "Use a name and up to 150 valid symbols." });
  const result = await db.transaction(async () => { if ((await lists()).length >= 20) return null; return addRecord("shared-watchlist", p.data); })();
  if (result === null) return res.status(409).json({ error: "Maximum 20 shared watchlists." });
  res.status(201).json({ id: result });
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

import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { generateBriefing } from "../briefing.js";
export const briefingsRouter = Router();
const schema = z.object({ symbols: z.array(z.string().trim().toUpperCase().regex(/^[A-Z0-9.^=&-]{1,20}$/)).min(1).max(12).transform((s) => [...new Set(s)].sort()), mode: z.enum(["pre-market", "after-close"]).default("pre-market") });
briefingsRouter.get("/current", async (req, res) => {
  const parsed = schema.safeParse({ symbols: String(req.query.symbols ?? "").split(","), mode: req.query.mode ?? "pre-market" });
  if (!parsed.success) return res.status(400).json({ error: "Use 1–12 symbols and a valid briefing mode." });
  try { res.json(await generateBriefing(parsed.data.symbols, parsed.data.mode)); } catch { res.status(502).json({ error: "Briefing data unavailable." }); }
});
briefingsRouter.post("/", async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Use 1–12 symbols and a valid briefing mode." });
  try {
    const report = await generateBriefing(parsed.data.symbols, parsed.data.mode);
    const info = db.prepare("INSERT INTO briefings (generated_at,content) VALUES (?,?)").run(report.generatedAt, JSON.stringify(report));
    res.status(201).json({ id: Number(info.lastInsertRowid), report });
  } catch { res.status(502).json({ error: "Could not save briefing." }); }
});
briefingsRouter.get("/", (req, res) => {
  const before = Number(req.query.before ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(before) || before < 1) return res.status(400).json({ error: "invalid history cursor" });
  const rows = db.prepare("SELECT id,generated_at,content FROM briefings WHERE id < ? ORDER BY id DESC LIMIT 21").all(before) as Array<{ id: number; generated_at: string; content: string }>;
  res.json({ entries: rows.slice(0, 20).map((r) => { const report = JSON.parse(r.content); return { id: r.id, generatedAt: r.generated_at, date: report.date, mode: report.mode, symbols: report.symbols, summary: report.summary }; }), nextCursor: rows.length > 20 ? rows[19].id : null });
});
briefingsRouter.get("/:id", (req, res) => {
  const row = db.prepare("SELECT content FROM briefings WHERE id=?").get(req.params.id) as { content: string } | undefined;
  return row ? res.json(JSON.parse(row.content)) : res.status(404).json({ error: "briefing not found" });
});

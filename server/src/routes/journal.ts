import { asyncRoute } from "../async-route.js";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { randomUUID } from "node:crypto";
export const journalRouter = Router();
export const journalSchema = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9.^=&-]{1,20}$/),
  title: z.string().trim().min(1).max(120),
  body: z.string().max(20000),
  kind: z.enum(["research", "trade"]),
  image: z
    .string()
    .max(1400000)
    .nullable()
    .optional()
    .refine((value) => {
      if (!value) return true;
      const match =
        /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
      if (!match) return false;
      const bytes = Buffer.from(match[2], "base64");
      if (bytes.length > 1024 * 1024) return false;
      return match[1] === "png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === "jpeg"
          ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          : bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP";
    }, "Attach a PNG, JPEG or WebP image no larger than 1 MB."),
});
journalRouter.get(
  "/",
  asyncRoute(async (req, res) => {
    const symbol = req.query.symbol
      ? String(req.query.symbol).toUpperCase()
      : "";
    const kind =
      req.query.kind === "trade" || req.query.kind === "research"
        ? req.query.kind
        : "";
    const before = Number(req.query.before ?? Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before < 1)
      return res.status(400).json({ error: "invalid cursor" });
    const rows = (await db
      .prepare(
        "SELECT id, symbol, title, body, kind, version, created_at, updated_at, CASE WHEN image IS NOT NULL THEN 1 ELSE 0 END AS \"hasImage\" FROM journal_entries WHERE (? = '' OR symbol = ?) AND (? = '' OR kind = ?) AND id < ? ORDER BY id DESC LIMIT 51",
      )
      .all(symbol, symbol, kind, kind, before)) as Array<{
      id: number;
    }>;
    res.json({
      entries: rows.slice(0, 50),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    });
  }),
);
journalRouter.param("id", (req, res, next, value) => {
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1
  )
    return res.status(400).json({ error: "invalid entry id" });
  next();
});
journalRouter.get(
  "/:id",
  asyncRoute(async (req, res) => {
    const row = await db
      .prepare("SELECT * FROM journal_entries WHERE id = ?")
      .get(req.params.id);
    return row
      ? res.json(row)
      : res.status(404).json({ error: "entry not found" });
  }),
);
journalRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = journalSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.issues[0].message });
    const n = parsed.data;
    const version = randomUUID();
    const info = await db
      .prepare(
        "INSERT INTO journal_entries (symbol, title, body, kind, image, version) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(n.symbol, n.title, n.body, n.kind, n.image ?? null, version);
    res.status(201).json({ id: Number(info.lastInsertRowid), version });
  }),
);
journalRouter.put(
  "/:id",
  asyncRoute(async (req, res) => {
    const parsed = journalSchema.extend({ version: z.string().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) {
      if (parsed.error.issues.some(issue => issue.path[0] === "version"))
        return res.status(409).json({ error: "Review the saved entry before saving this older draft." });
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const n = parsed.data;
    const version = randomUUID();
    const result = await db
      .prepare(
        "UPDATE journal_entries SET symbol=?, title=?, body=?, kind=?, image=?, updated_at=?, version=? WHERE id=? AND version=?",
      )
      .run(
        n.symbol,
        n.title,
        n.body,
        n.kind,
        n.image ?? null,
        new Date().toISOString().replace("T", " ").slice(0, 19),
        version,
        req.params.id,
        n.version,
      );
    return result.changes
      ? res.json({ id: Number(req.params.id), version })
      : (await db.prepare("SELECT id FROM journal_entries WHERE id=?").get(req.params.id))
        ? res.status(409).json({ error: "This entry changed on another device. Your draft is kept. Review the saved entry before saving again." })
        : res.status(404).json({ error: "entry not found" });
  }),
);
journalRouter.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    await db
      .prepare("DELETE FROM journal_entries WHERE id = ?")
      .run(req.params.id);
    res.status(204).end();
  }),
);

import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import {
  alertMonitor,
  MAX_ALERTS,
  MAX_ALERT_SYMBOLS,
  type AlertRule,
  type AlertEvent,
} from "../alerts.js";
export const alertsRouter = Router();
const fields = z.object({
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$/),
  condition: z.enum([
    "PRICE_ABOVE",
    "PRICE_BELOW",
    "CHANGE_ABOVE",
    "CHANGE_BELOW",
  ]),
  threshold: z.number().finite().min(-100).max(1e15),
  label: z.string().trim().max(120).default(""),
  armed: z.boolean().default(true),
});
const schema = fields.refine(
  (r) =>
    r.condition.startsWith("PRICE_")
      ? r.threshold > 0
      : r.condition === "CHANGE_ABOVE"
        ? r.threshold >= 0 && r.threshold <= 1e6
        : r.threshold <= 0,
  "Price thresholds must be positive; daily rises use nonnegative percentages and daily falls use -100 to 0%.",
);
function checkSymbolLimit(symbol: string, armed: boolean, except = -1) {
  if (!armed) return;
  const rows = db
    .prepare("SELECT DISTINCT symbol FROM price_alerts WHERE armed=1 AND id<>?")
    .all(except) as { symbol: string }[];
  if (new Set([...rows.map((r) => r.symbol), symbol]).size > MAX_ALERT_SYMBOLS)
    throw new Error(
      `Monitor up to ${MAX_ALERT_SYMBOLS} distinct active symbols. Pause or remove another alert first.`,
    );
}
alertsRouter.get("/", (_req, res) =>
  res.json({
    alerts: db.prepare("SELECT * FROM price_alerts ORDER BY id DESC").all(),
    monitor: alertMonitor.status(),
  }),
);
alertsRouter.get("/events", (req, res) => {
  const cursor = Number(req.query.after ?? 0);
  if (!Number.isSafeInteger(cursor) || cursor < 0)
    return res.status(400).json({ error: "invalid event cursor" });
  const latest = (
    db
      .prepare("SELECT COALESCE(MAX(id),0) AS id FROM price_alert_events")
      .get() as { id: number }
  ).id;
  if (cursor > latest)
    return res.json({ events: [], nextCursor: 0, reset: true });
  const rows = db
    .prepare("SELECT * FROM price_alert_events WHERE id>? ORDER BY id LIMIT 50")
    .all(cursor) as AlertEvent[];
  res.json({
    events: rows,
    nextCursor: rows.at(-1)?.id ?? cursor,
    reset: false,
  });
});
alertsRouter.get("/history", (req, res) => {
  const before = Number(req.query.before ?? Number.MAX_SAFE_INTEGER);
  if (!Number.isSafeInteger(before) || before < 1)
    return res.status(400).json({ error: "invalid history cursor" });
  const rows = db
    .prepare(
      "SELECT * FROM price_alert_events WHERE id<? ORDER BY id DESC LIMIT 51",
    )
    .all(before) as AlertEvent[];
  res.json({
    events: rows.slice(0, 50),
    nextCursor: rows.length > 50 ? rows[49].id : null,
  });
});
alertsRouter.post("/check", async (_req, res) => {
  res.json(await alertMonitor.check());
});
alertsRouter.post("/", (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: parsed.error.issues[0].message });
  try {
    const r = parsed.data;
    const id = db
      .transaction(() => {
        if (
          (
            db.prepare("SELECT COUNT(*) AS n FROM price_alerts").get() as {
              n: number;
            }
          ).n >= MAX_ALERTS
        )
          throw new Error(
            `Keep up to ${MAX_ALERTS} saved alerts. Delete an old alert first.`,
          );
        checkSymbolLimit(r.symbol, r.armed);
        return Number(
          db
            .prepare(
              "INSERT INTO price_alerts (symbol,condition,threshold,label,armed,created_at) VALUES (?,?,?,?,?,?)",
            )
            .run(
              r.symbol,
              r.condition,
              r.threshold,
              r.label,
              r.armed ? 1 : 0,
              new Date().toISOString(),
            ).lastInsertRowid,
        );
      })
      .immediate();
    res.status(201).json({ id });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});
alertsRouter.param("id", (_req, res, next, id) => {
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)
    return res.status(400).json({ error: "invalid alert id" });
  next();
});
alertsRouter.put("/:id", (req, res) => {
  const patch = fields.partial().strict().safeParse(req.body);
  if (!patch.success || !Object.keys(patch.data).length)
    return res.status(400).json({ error: "provide valid alert fields" });
  try {
    const found = db
      .transaction(() => {
        const current = db
          .prepare("SELECT * FROM price_alerts WHERE id=?")
          .get(req.params.id) as AlertRule | undefined;
        if (!current) return false;
        const parsed = schema.safeParse({
          ...current,
          armed: !!current.armed,
          ...patch.data,
        });
        if (!parsed.success) throw new Error(parsed.error.issues[0].message);
        const r = parsed.data;
        checkSymbolLimit(r.symbol, r.armed, current.id);
        db.prepare(
          "UPDATE price_alerts SET symbol=?,condition=?,threshold=?,label=?,armed=?,revision=revision+1,last_checked_at=NULL,last_value=NULL WHERE id=?",
        ).run(
          r.symbol,
          r.condition,
          r.threshold,
          r.label,
          r.armed ? 1 : 0,
          req.params.id,
        );
        return true;
      })
      .immediate();
    return found
      ? res.json({ id: Number(req.params.id) })
      : res.status(404).json({ error: "alert not found" });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});
alertsRouter.delete("/:id", (req, res) => {
  db.prepare("DELETE FROM price_alerts WHERE id=?").run(req.params.id);
  res.status(204).end();
});

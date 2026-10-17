import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { asyncRoute } from "../async-route.js";
import { generateBriefing } from "../briefing.js";
import { createBriefingScheduler } from "../scheduler.js";
export const briefingScheduler = createBriefingScheduler(db, generateBriefing),
  deliveryRouter = Router();
const fields = z.object({
  symbols: z
    .array(
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$/),
    )
    .min(1)
    .max(12)
    .transform((v) => [...new Set(v)]),
  mode: z.enum(["pre-market", "after-close"]),
  local_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  timezone: z
    .string()
    .max(100)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone."),
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .transform((v) => [...new Set(v)].sort()),
  enabled: z.boolean().default(true),
});
deliveryRouter.get(
  "/",
  asyncRoute(async (_req, res) =>
    res.json(
      await db
        .prepare("SELECT * FROM briefing_schedules ORDER BY id DESC")
        .all(),
    ),
  ),
);
deliveryRouter.post(
  "/check",
  asyncRoute(async (_req, res) =>
    res.json({ generated: await briefingScheduler.check() }),
  ),
);
deliveryRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    const parsed = fields.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({ error: parsed.error.issues[0].message });
    const r = parsed.data;
    try {
      const id = await db.transaction(async () => {
        if (
          (await db
            .prepare("SELECT COUNT(*) AS n FROM briefing_schedules")
            .get())!.n >= 10
        )
          throw new Error("Keep up to ten schedules.");
        return (
          await db
            .prepare(
              "INSERT INTO briefing_schedules (symbols,mode,local_time,timezone,weekdays,enabled,generation) VALUES (?,?,?,?,?,?,?)",
            )
            .run(
              JSON.stringify(r.symbols),
              r.mode,
              r.local_time,
              r.timezone,
              r.weekdays.join(","),
              r.enabled ? 1 : 0,
              randomUUID(),
            )
        ).lastInsertRowid;
      })();
      res.status(201).json({ id });
    } catch (e) {
      res.status(409).json({ error: (e as Error).message });
    }
  }),
);
deliveryRouter.param("id", (_req, res, next, id) => {
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) < 1)
    return res.status(400).json({ error: "Invalid schedule ID." });
  next();
});
deliveryRouter.put(
  "/:id",
  asyncRoute(async (req, res) => {
    if (typeof req.body?.enabled !== "boolean")
      return res.status(400).json({ error: "Provide enabled." });
    const r = await db
      .prepare(
        "UPDATE briefing_schedules SET enabled=?,generation=? WHERE id=?",
      )
      .run(req.body.enabled ? 1 : 0, randomUUID(), req.params.id);
    return res.status(r.changes ? 200 : 404).json({ updated: !!r.changes });
  }),
);
deliveryRouter.delete(
  "/:id",
  asyncRoute(async (req, res) => {
    await db
      .prepare("DELETE FROM briefing_schedules WHERE id=?")
      .run(req.params.id);
    res.status(204).end();
  }),
);

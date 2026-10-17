import { Router } from "express";
import { db } from "../db.js";
import { asyncRoute } from "../async-route.js";
import { readSync, writeSync } from "../sync.js";
export const syncRouter = Router();
syncRouter.get(
  "/",
  asyncRoute(async (_req, res) => res.json(await readSync(db))),
);
syncRouter.post(
  "/",
  asyncRoute(async (req, res) => {
    try {
      res.json(await writeSync(db, req.body?.payload, req.body?.baseVersion));
    } catch (e) {
      res
        .status((e as { status?: number }).status ?? 400)
        .json({ error: (e as Error).message });
    }
  }),
);

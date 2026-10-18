import { Router } from "express";
import { db } from "../db.js";
import { asyncRoute } from "../async-route.js";
import { readSync, writeSync, listSyncHistory, readSyncVersion, restoreSyncVersion } from "../sync.js";
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

syncRouter.get("/history", asyncRoute(async (_req, res) => {
  res.json(await listSyncHistory(db));
}));
syncRouter.get("/history/:version", asyncRoute(async (req, res) => {
  const saved = await readSyncVersion(db, req.params.version);
  if (!saved) return res.status(404).json({ error: "Sync version no longer exists." });
  res.json(saved);
}));
syncRouter.post("/restore", asyncRoute(async (req, res) => {
  try {
    if (typeof req.body?.version !== "string") throw new Error("Select a sync version.");
    res.json(await restoreSyncVersion(db, req.body.version, req.body.baseVersion));
  } catch (e) {
    res.status((e as { status?: number }).status ?? 400).json({ error: (e as Error).message });
  }
}));

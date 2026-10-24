import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { apiKey } from "../auth.js";
import { asyncRoute } from "../async-route.js";
import { createMobileDevices, ownerBinding } from "../mobile-devices.js";
import { apnsConfig } from "../apns.js";
import { records, addRecord, removeRecord } from "../records.js";
import type { Device } from "../notifications.js";
export const mobileDevices = createMobileDevices(db, () => ownerBinding(process.env.WEB_PASSWORD || apiKey, process.env.WEB_SESSION_SECRET || apiKey));
// Only the web server, using its server-to-server API key, may call these routes.
// The browser proxy blocks this prefix; native login goes through /api/mobile/session.
export const mobileAuthRouter = Router();
mobileAuthRouter.post("/register", asyncRoute(async (req, res) => {
  const p = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Use a device name between 1 and 60 characters." });
  try { res.status(201).json(await mobileDevices.register(p.data.name)); } catch (e) { res.status((e as {status?:number}).status ?? 500).json({ error: (e as Error).message }); }
}));
mobileAuthRouter.post("/verify", asyncRoute(async (req, res) => {
  const device = await mobileDevices.verify(String(req.body?.token ?? ""));
  if (!device) return res.status(401).json({ error: "Device authorization expired or was revoked." });
  res.json({ id: device.id, name: device.name, expiresAt: device.expires_at });
}));
mobileAuthRouter.post("/renew", asyncRoute(async (req, res) => {
  const device = await mobileDevices.renew(String(req.body?.token ?? ""));
  if (!device) return res.status(401).json({ error: "Device authorization expired or was revoked." });
  res.json(device);
}));
export const mobileRouter = Router();
mobileRouter.get("/devices", asyncRoute(async (_req, res) => res.json(await mobileDevices.list())));
mobileRouter.delete("/devices/:id", asyncRoute(async (req, res) => {
  await db.transaction(async () => {
    await mobileDevices.revoke(req.params.id);
    for (const row of await records<Device>("push-device")) {
      if ("ownerDeviceId" in row.payload && row.payload.ownerDeviceId === req.params.id) await removeRecord("push-device", row.id);
    }
  })();
  res.json({ ok: true });
}));
mobileRouter.get("/push", asyncRoute(async (_req,res) => { const config = apnsConfig(); res.json({configured:!!config,topic:config?.topic ?? null,environment:config?.environment ?? null}); }));
mobileRouter.post("/push", asyncRoute(async (req,res) => {
  const config = apnsConfig(); if (!config) return res.status(503).json({error:"Configure APNs on the Mac before registering native notifications."});
  const p = z.object({token:z.string().regex(/^[a-f0-9]{64,256}$/),environment:z.enum(["sandbox","production"])}).safeParse(req.body);
  const ownerDeviceId = req.header("x-mobile-device-id");
  if (!ownerDeviceId || !await mobileDevices.active(ownerDeviceId)) return res.status(401).json({error:"Pair this phone before registering notifications."});
  if (!p.success || p.data.environment !== config.environment) return res.status(400).json({error:"APNs token or environment does not match the server."});
  const registered = await db.transaction(async () => {
    const devices = [];
    for (const row of await records<Device>("push-device")) {
      if ("ownerDeviceId" in row.payload && !await mobileDevices.active(row.payload.ownerDeviceId)) await removeRecord("push-device", row.id);
      else devices.push(row);
    }
    const existing = devices.filter(r => "ownerDeviceId" in r.payload && r.payload.ownerDeviceId === ownerDeviceId);
    if (existing.some(r => "nativeToken" in r.payload && r.payload.nativeToken === p.data.token && r.payload.environment === p.data.environment)) return true;
    if (devices.length - existing.length >= 20) return false;
    for (const row of existing) await removeRecord("push-device", row.id);
    const current = (await records("notification"))[0]?.id ?? 0;
    await addRecord("push-device", {name:"iOS device",ownerDeviceId,nativeToken:p.data.token,environment:p.data.environment,cursor:current,joinedAt:new Date().toISOString()});
    return true;
  })();
  if (!registered) return res.status(409).json({error:"Maximum 20 notification devices."});
  res.json({ok:true});
}));

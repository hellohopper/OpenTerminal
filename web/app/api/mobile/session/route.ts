import { NextRequest, NextResponse } from "next/server";
import { authConfig, sameOrigin, passwordMatches } from "../../../../lib/session";
import { deviceToken, mobileBackend, verifyMobile } from "../../../../lib/mobile-auth";
let attempts = 0, started = 0;
const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return reply({ error: "Same-origin request required." }, 403);
  const now = Date.now(); if (now - started > 60000) { attempts = 0; started = now; }
  if (++attempts > 10) return reply({ error: "Too many sign-in attempts. Try again in one minute." }, 429);
  try {
    const reader = request.body?.getReader(); if (!reader) return reply({ error: "Password required." }, 400);
    let size = 0; const chunks: Uint8Array[] = [];
    for (;;) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > 2048) { await reader.cancel(); return reply({error:"Request too large."},413); } chunks.push(value); }
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8")), config = authConfig();
    if (config.disabled) return reply({error:"Configure owner authentication before pairing devices."},503);
    if (typeof input.password !== "string" || !passwordMatches(input.password, config)) return reply({ error: "Invalid password." }, 401);
    const response = await mobileBackend("mobile-auth/register", { name: input.name });
    if (response.ok) attempts = 0;
    return reply(await response.json(), response.status);
  } catch { return reply({ error: "Device sign-in unavailable. Check the Mac server." }, 503); }
}
export async function GET(request: NextRequest) {
  try { const device = await verifyMobile(request); return device ? reply(device) : reply({error:"Device authorization expired or was revoked."},401); }
  catch { return reply({error:"Device authentication service unavailable."},503); }
}
export async function PUT(request: NextRequest) {
  if (!sameOrigin(request)) return reply({error:"Same-origin request required."},403);
  try { const response = await mobileBackend("mobile-auth/renew", {token:deviceToken(request) ?? ""}); return reply(await response.json(), response.status); }
  catch { return reply({error:"Device authentication service unavailable."},503); }
}
export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return reply({error:"Same-origin request required."},403);
  try { const device = await verifyMobile(request); if (!device) return reply({error:"Device authorization expired or was revoked."},401);
    const response = await mobileBackend(`mobile/devices/${device.id}`, undefined, "DELETE"); return reply(await response.json(), response.status);
  } catch { return reply({error:"Device authentication service unavailable."},503); }
}

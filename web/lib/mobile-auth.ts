import { authConfig, SESSION_COOKIE, validSession } from "./session";
import { getApiKey } from "./api-key";
import type { NextRequest } from "next/server";
export type MobileDevice = { id: string; name: string; expiresAt: string };
export async function mobileBackend(path: string, body?: unknown, method = "POST") {
  const key = getApiKey(); if (!key) throw new Error("The API key is not configured.");
  return fetch(`${process.env.API_URL ?? "http://localhost:4000"}/api/${path}`, {
    method, headers: { "content-type": "application/json", "x-api-key": key },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store", signal: AbortSignal.timeout(10000),
  });
}
export function deviceToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}
export async function verifyMobile(request: Request): Promise<MobileDevice | null> {
  const token = deviceToken(request); if (!token) return null;
  const response = await mobileBackend("mobile-auth/verify", { token });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error("Device authentication service unavailable.");
  return response.json();
}
export async function authorized(request: NextRequest): Promise<boolean> {
  if (request.headers.has("authorization")) return !!await verifyMobile(request);
  return validSession(request.cookies.get(SESSION_COOKIE)?.value, authConfig());
}

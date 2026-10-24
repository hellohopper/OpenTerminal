import { NextRequest, NextResponse } from "next/server";
import {sameOrigin} from "@/lib/session";
import { getApiKey } from "@/lib/api-key";
import { authorized, verifyMobile } from "@/lib/mobile-auth";

// A route handler (rather than next.config.ts rewrites) because rewrites
// can't attach a header to the proxied request — and the shared API key
// must never reach the browser, only travel server-to-server.
const API_URL = process.env.API_URL ?? "http://localhost:4000";

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  if (path.some(segment => segment === "." || segment === ".." || /[/\\]/.test(segment))) return NextResponse.json({error:"Invalid API path."},{status:400});
  if (path[0]?.toLowerCase() === "mobile-auth") return NextResponse.json({error:"Not found."},{status:404});
  try{if(!await authorized(req))return NextResponse.json({error:"Sign in required."},{status:401});}catch{return NextResponse.json({error:"Authentication service is unavailable."},{status:503});}
  if(!["GET","HEAD"].includes(req.method)&&!sameOrigin(req))return NextResponse.json({error:"Same-origin request required."},{status:403});
  const url = `${API_URL}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;
  const apiKey = getApiKey();

  const headers = new Headers();
  const contentType = req.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  if (apiKey) headers.set("x-api-key", apiKey);
  // Derive device identity from the verified credential, never an inbound header.
  if (path[0] === "mobile" && path[1] === "push" && req.headers.has("authorization")) {
    try { const device = await verifyMobile(req); if (!device) return NextResponse.json({error:"Sign in required."},{status:401}); headers.set("x-mobile-device-id", device.id); }
    catch { return NextResponse.json({error:"Authentication service is unavailable."},{status:503}); }
  }
  // Relayed, not fabricated: only meaningful (and only trusted by the API)
  // when TRUST_PROXY=1 is set there — see server/src/index.ts.
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);

  const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE";

  try {
  const upstream = await fetch(url, {
    method: req.method,
    headers,
    body: hasBody ? await req.text() : undefined,
    cache: "no-store",
    signal:AbortSignal.any([req.signal,AbortSignal.timeout(90000)]),
  });

  const body = upstream.status === 204 ? null : await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control":"no-store" },
  });
  }catch{return NextResponse.json({error:"API unavailable or timed out."},{status:502});}
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: RouteContext) {
  return proxy(req, (await ctx.params).path);
}

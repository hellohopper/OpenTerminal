import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect } from "node:http2";
export type ApnsConfig = { keyId: string; teamId: string; topic: string; keyFile: string; environment: "sandbox" | "production" };
export function apnsConfig(): ApnsConfig | null {
  const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_TOPIC: topic, APNS_KEY_FILE: keyFile, APNS_ENVIRONMENT: environment = "sandbox" } = process.env;
  return keyId && /^[A-Z0-9]{10}$/.test(keyId) && teamId && /^[A-Z0-9]{10}$/.test(teamId) && topic && /^[A-Za-z0-9.-]{1,200}$/.test(topic) && keyFile && ["sandbox", "production"].includes(environment)
    ? { keyId, teamId, topic, keyFile, environment: environment as ApnsConfig["environment"] } : null;
}
export function apnsJwt(config: ApnsConfig, now = Date.now()) {
  const encode = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const content = `${encode({alg:"ES256",kid:config.keyId})}.${encode({iss:config.teamId,iat:Math.floor(now/1000)})}`;
  const key = createPrivateKey(readFileSync(config.keyFile));
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("APNs requires a P-256 signing key.");
  return `${content}.${sign("sha256",Buffer.from(content),{key,dsaEncoding:"ieee-p1363"}).toString("base64url")}`;
}
let cached: { signature: string; at: number; identity: string } | undefined;
export async function sendApns(token: string, environment: string, payload: {title:string;body:string;symbol:string}, notificationId: number) {
  const config = apnsConfig(); if (!config) throw new Error("APNs is not configured.");
  if (!/^[a-f0-9]{64,256}$/.test(token) || environment !== config.environment) throw Object.assign(new Error("Invalid APNs registration."), {statusCode:410});
  const identity = JSON.stringify(config), now = Date.now();
  if (!cached || cached.identity !== identity || now - cached.at > 20*60000) cached = {signature:apnsJwt(config,now),at:now,identity};
  const signature = cached.signature;
  const body = JSON.stringify({aps:{alert:{title:payload.title.slice(0,120),body:payload.body.slice(0,500)},sound:"default"},symbol:payload.symbol,notificationId});
  await new Promise<void>((resolve,reject) => {
    const session = connect(config.environment === "production" ? "https://api.push.apple.com" : "https://api.sandbox.push.apple.com");
    let finished = false;
    const finish = (error?: Error) => { if (finished) return; finished = true; clearTimeout(timer); session.destroy(); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error("APNs timed out.")), 8000);
    session.on("error", () => finish(new Error("APNs connection failed.")));
    const request = session.request({":method":"POST",":path":`/3/device/${token}`,authorization:`bearer ${signature}`,"apns-topic":config.topic,"apns-push-type":"alert","apns-priority":"10","apns-expiration":String(Math.floor(now/1000)+3600),"apns-collapse-id":`terminal-${notificationId}`});
    let status = 0, response = "";
    request.on("response", headers => { status = Number(headers[":status"]); });
    request.on("data", chunk => { if (response.length < 4096) response += chunk.toString(); });
    request.on("error", () => finish(new Error("APNs request failed.")));
    request.on("end", () => { if (status === 200) finish(); else { let reason = ""; try { reason=JSON.parse(response).reason; } catch {} if (reason === "ExpiredProviderToken") cached = undefined; finish(Object.assign(new Error("APNs rejected notification."), {statusCode:status===410||["BadDeviceToken","DeviceTokenNotForTopic","Unregistered"].includes(reason)?410:status})); } });
    request.end(body);
  });
}

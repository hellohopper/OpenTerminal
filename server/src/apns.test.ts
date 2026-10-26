import {it,expect,vi,afterAll,beforeEach,afterEach}from"vitest";import{EventEmitter}from"node:events";import{generateKeyPairSync,verify}from"node:crypto";import{mkdtempSync,writeFileSync,readFileSync,rmSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";
const state=vi.hoisted(()=>({status:200,headers:{} as any,body:"",host:"",closed:0}));
vi.mock("node:http2",()=>({connect:(host:string)=>{state.host=host;const session=new EventEmitter()as any;session.destroy=()=>{state.closed++};session.request=(headers:any)=>{state.headers=headers;const request=new EventEmitter()as any;request.end=(body:string)=>{state.body=body;request.emit("response",{":status":state.status});if(state.status!==200)request.emit("data",Buffer.from('{"reason":"Unregistered"}'));request.emit("end")};return request};return session}}));
import{apnsJwt,sendApns,apnsPayload}from"./apns";
const directory=mkdtempSync(join(tmpdir(),"apns-test-")),keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),file=join(directory,"key.p8");writeFileSync(file,keys.privateKey.export({format:"pem",type:"pkcs8"}));
beforeEach(()=>{state.status=200;state.closed=0;Object.assign(process.env,{APNS_KEY_ID:"ABCDEFGHIJ",APNS_TEAM_ID:"0123456789",APNS_TOPIC:"com.openterminal.companion",APNS_KEY_FILE:file,APNS_ENVIRONMENT:"sandbox"});});
afterEach(()=>vi.unstubAllEnvs());
afterAll(()=>{rmSync(directory,{recursive:true,force:true});for(const k of["APNS_KEY_ID","APNS_TEAM_ID","APNS_TOPIC","APNS_KEY_FILE","APNS_ENVIRONMENT"])delete process.env[k];});
it("signs Apple's ES256 JWT and sends a bounded alert through the sandbox with revocable-token failure handling",async()=>{
 Object.assign(process.env,{APNS_KEY_ID:"ABCDEFGHIJ",APNS_TEAM_ID:"0123456789",APNS_TOPIC:"com.openterminal.companion",APNS_KEY_FILE:file,APNS_ENVIRONMENT:"sandbox"});
 const jwt=apnsJwt({keyId:"ABCDEFGHIJ",teamId:"0123456789",topic:"com.openterminal.companion",keyFile:file,environment:"sandbox"},1000000),parts=jwt.split(".");
 expect(JSON.parse(Buffer.from(parts[1],"base64url").toString())).toEqual({iss:"0123456789",iat:1000});expect(verify("sha256",Buffer.from(parts.slice(0,2).join(".")),{key:keys.publicKey,dsaEncoding:"ieee-p1363"},Buffer.from(parts[2],"base64url"))).toBe(true);
 await sendApns("a".repeat(64),"sandbox",{title:"Market alert",body:"Threshold reached",symbol:"AAPL"},7);expect(state.host).toBe("https://api.sandbox.push.apple.com");expect(state.headers["apns-topic"]).toBe("com.openterminal.companion");expect(state.headers["apns-push-type"]).toBe("alert");expect(JSON.parse(state.body)).toMatchObject({aps:{alert:{title:"Market alert"}},symbol:"AAPL",notificationId:7});expect(state.closed).toBe(1);
 state.status=410;await expect(sendApns("a".repeat(64),"sandbox",{title:"x",body:"x",symbol:"AAPL"},8)).rejects.toMatchObject({statusCode:410});
 await expect(sendApns("a".repeat(64),"production",{title:"x",body:"x",symbol:"AAPL"},9)).rejects.toMatchObject({statusCode:410});
});

it("includes only the validated source origin and paired device identity in the shared native routing contract",()=>{
 const fixture=JSON.parse(readFileSync(new URL("../../tests/fixtures/native-notification.json",import.meta.url),"utf8"));
 expect(apnsPayload({title:"AAPL price alert",body:"Target reached",symbol:"AAPL"},7,fixture.deviceId,fixture.serverOrigin)).toEqual(fixture);
 const canonical=apnsPayload({title:"x",body:"y",symbol:"SPY"},1,fixture.deviceId.toUpperCase(),"https://FIXTURE.example.com:443/");
 expect(canonical).toMatchObject({serverOrigin:fixture.serverOrigin,deviceId:fixture.deviceId});
 for(const origin of ["https://secret:password@example.com", "https://example.com/path", "https://example.com?secret=value", "https://example.com#fragment", "http://192.168.1.2:3000", "file:///tmp", "bad"]){
  const result=apnsPayload({title:"Visible alert",body:"Still visible",symbol:"SPY"},1,fixture.deviceId,origin);
  expect(result).not.toHaveProperty("serverOrigin");expect(result).not.toHaveProperty("deviceId");expect(result.aps.alert.title).toBe("Visible alert");
  expect(JSON.stringify(result)).not.toContain("secret");
 }
 expect(apnsPayload({title:"x",body:"y",symbol:"SPY"},1,fixture.deviceId+".private-token",fixture.serverOrigin)).not.toHaveProperty("deviceId");
 expect(apnsPayload({title:"x",body:"y",symbol:"SPY"},1,fixture.deviceId,"http://127.0.0.1:3100")).toHaveProperty("serverOrigin","http://127.0.0.1:3100");
 expect(Buffer.byteLength(JSON.stringify(apnsPayload({title:"界".repeat(1000),body:"界".repeat(1000),symbol:"SPY"},1,fixture.deviceId,"https://"+"a".repeat(490))))).toBeLessThan(4096);
});
it("sends routing metadata and keeps collapse identifiers separate across backend origins",async()=>{
 const id="11111111-1111-4111-8111-111111111111";
 vi.stubEnv("WEB_ORIGIN","https://first.example.com");
 await sendApns("a".repeat(64),"sandbox",{title:"x",body:"y",symbol:"SPY"},7,id);
 const first=state.headers["apns-collapse-id"];
 expect(JSON.parse(state.body)).toMatchObject({serverOrigin:"https://first.example.com",deviceId:id});
 vi.stubEnv("WEB_ORIGIN","https://second.example.com");
 await sendApns("a".repeat(64),"sandbox",{title:"x",body:"y",symbol:"SPY"},7,id);
 expect(state.headers["apns-collapse-id"]).not.toBe(first);expect(state.headers["apns-collapse-id"].length).toBeLessThanOrEqual(64);
 expect(state.body).not.toContain("a".repeat(64));
});

import {it,expect,vi,afterAll}from"vitest";import{EventEmitter}from"node:events";import{generateKeyPairSync,verify}from"node:crypto";import{mkdtempSync,writeFileSync,rmSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";
const state=vi.hoisted(()=>({status:200,headers:{} as any,body:"",host:"",closed:0}));
vi.mock("node:http2",()=>({connect:(host:string)=>{state.host=host;const session=new EventEmitter()as any;session.destroy=()=>{state.closed++};session.request=(headers:any)=>{state.headers=headers;const request=new EventEmitter()as any;request.end=(body:string)=>{state.body=body;request.emit("response",{":status":state.status});if(state.status!==200)request.emit("data",Buffer.from('{"reason":"Unregistered"}'));request.emit("end")};return request};return session}}));
import{apnsJwt,sendApns}from"./apns";
const directory=mkdtempSync(join(tmpdir(),"apns-test-")),keys=generateKeyPairSync("ec",{namedCurve:"prime256v1"}),file=join(directory,"key.p8");writeFileSync(file,keys.privateKey.export({format:"pem",type:"pkcs8"}));
afterAll(()=>{rmSync(directory,{recursive:true,force:true});for(const k of["APNS_KEY_ID","APNS_TEAM_ID","APNS_TOPIC","APNS_KEY_FILE","APNS_ENVIRONMENT"])delete process.env[k];});
it("signs Apple's ES256 JWT and sends a bounded alert through the sandbox with revocable-token failure handling",async()=>{
 Object.assign(process.env,{APNS_KEY_ID:"ABCDEFGHIJ",APNS_TEAM_ID:"0123456789",APNS_TOPIC:"com.openterminal.companion",APNS_KEY_FILE:file,APNS_ENVIRONMENT:"sandbox"});
 const jwt=apnsJwt({keyId:"ABCDEFGHIJ",teamId:"0123456789",topic:"com.openterminal.companion",keyFile:file,environment:"sandbox"},1000000),parts=jwt.split(".");
 expect(JSON.parse(Buffer.from(parts[1],"base64url").toString())).toEqual({iss:"0123456789",iat:1000});expect(verify("sha256",Buffer.from(parts.slice(0,2).join(".")),{key:keys.publicKey,dsaEncoding:"ieee-p1363"},Buffer.from(parts[2],"base64url"))).toBe(true);
 await sendApns("a".repeat(64),"sandbox",{title:"Market alert",body:"Threshold reached",symbol:"AAPL"},7);expect(state.host).toBe("https://api.sandbox.push.apple.com");expect(state.headers["apns-topic"]).toBe("com.openterminal.companion");expect(state.headers["apns-push-type"]).toBe("alert");expect(JSON.parse(state.body)).toMatchObject({aps:{alert:{title:"Market alert"}},symbol:"AAPL",notificationId:7});expect(state.closed).toBe(1);
 state.status=410;await expect(sendApns("a".repeat(64),"sandbox",{title:"x",body:"x",symbol:"AAPL"},8)).rejects.toMatchObject({statusCode:410});
 await expect(sendApns("a".repeat(64),"production",{title:"x",body:"x",symbol:"AAPL"},9)).rejects.toMatchObject({statusCode:410});
});

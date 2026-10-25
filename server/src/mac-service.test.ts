import {it,expect,afterAll,vi}from"vitest";
import{mkdtempSync,rmSync,readFileSync,statSync,writeFileSync,mkdirSync,copyFileSync,realpathSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";import{spawnSync}from"node:child_process";
import{setup,configuration,runtimeEnvironment,launchPlist,inside,rotateLog,startService,serviceStatus,labelFor}from"../../scripts/mac-service-lib.mjs";
const root=realpathSync(mkdtempSync(join(tmpdir(),"mac-service-")));afterAll(()=>rmSync(root,{recursive:true,force:true}));
it("creates repo-local configuration once and isolates every mutable runtime path",()=>{
 const config=setup(root,"https://studio.example.ts.net"),env=runtimeEnvironment(root,configuration(root));
 expect(statSync(join(root,"config/server.json")).mode&0o077).toBe(0);expect(config.password.length).toBeGreaterThan(12);
 for(const key of["DATA_DIR","BACKUP_DIR","API_KEY_FILE"])expect(env[key]).toMatch(root);
 expect(env.API_HOST).toBe("127.0.0.1");expect(env.HOSTNAME).toBe("127.0.0.1");expect(env.DATABASE_URL).toBe("");
 expect(()=>setup(root,"https://other.example")).toThrow("already exists");expect(()=>inside(root,"../elsewhere")).toThrow("inside");
 expect(()=>setup(join(root,"bad"),"http://studio.local")).toThrow("HTTPS");
 const plist=launchPlist(root,config,"api");expect(plist).toContain(join(root,"logs"));expect(plist).not.toContain(config.password);expect(plist).not.toContain(config.apiKey);
});
it("submits the same service without root-opened paths when external-volume plist ownership is rejected",()=>{
 const config=configuration(root),command=vi.fn((_program:string,args:string[])=>{
  if(args[0]==="print")return{status:113,stdout:""};
  if(args[0]==="bootstrap")return{status:5,stderr:"Bootstrap failed: 5: Input/output error"};
  return{status:0,stdout:""};
 });
 expect(startService(root,config,"api",{command,uid:501})).toBe("submitted");
 const args=command.mock.calls.find(call=>call[1][0]==="submit")![1];
 expect(args).toEqual(["submit","-l",labelFor(root,"api"),"--",config.node,join(root,"scripts/mac-service.mjs"),"run","api"]);
 expect(args).not.toContain("-o");expect(args).not.toContain("-e");expect(JSON.stringify(command.mock.calls)).not.toContain(config.password);
});
it("keeps normal plist startup and existing jobs, and never falls back on unrelated failures",()=>{
 const config=configuration(root),normal=vi.fn((_program:string,args:string[])=>({status:args[0]==="print"?113:0,stdout:""}));
 expect(startService(root,config,"web",{command:normal,uid:501})).toBe("plist");
 expect(normal.mock.calls.some(call=>call[1][0]==="submit")).toBe(false);
 const existing=vi.fn(()=>({status:0,stdout:"state = running\n pid = 123\n"}));
 expect(startService(root,config,"web",{command:existing,uid:501})).toBe("existing");expect(existing).toHaveBeenCalledTimes(2);
 const denied=vi.fn((_program:string,args:string[])=>({status:args[0]==="print"?113:1,stderr:"Operation not permitted"}));
 expect(()=>startService(root,config,"web",{command:denied,uid:501})).toThrow("Operation not permitted");
 expect(denied.mock.calls.some(call=>call[1][0]==="submit")).toBe(false);
 const failed=vi.fn((_program:string,args:string[])=>({status:args[0]==="bootstrap"?5:1,stderr:"Submit rejected"}));
 expect(()=>startService(root,config,"web",{command:failed,uid:501})).toThrow("Submit rejected");
});
it("shows scheduled spawn failures instead of presenting them as a running backend",()=>{
 const command=vi.fn(()=>({status:0,stdout:"\n state = spawn scheduled\n last exit code = 78: EX_CONFIG\n"}));
 const state=serviceStatus(root,"api",{command,uid:501});
 expect(state.state).toBe("spawn scheduled");expect(state.lastExit).toBe("78: EX_CONFIG");expect(state.pid).toBeUndefined();
});
it("rotates bounded logs without touching adjacent files or accepting environment overrides",()=>{
 const log=join(root,"logs/api.log");writeFileSync(log,"previous");writeFileSync(join(root,"logs/keep.txt"),"keep");rotateLog(log,1);expect(readFileSync(log+".1","utf8")).toBe("previous");expect(readFileSync(join(root,"logs/keep.txt"),"utf8")).toBe("keep");
 const config=configuration(root),env=runtimeEnvironment(root,{...config,webPush:{DATA_DIR:"/outside",WEB_PUSH_SUBJECT:"mailto:owner@example.com"}});expect(env.DATA_DIR).toBe(join(root,"data"));expect(env.WEB_PUSH_SUBJECT).toBe("mailto:owner@example.com");
});
it("runs a production child with repo-local storage and captures its output",()=>{
 const fixture=join(root,"runtime"),config=setup(fixture,"https://studio.example.ts.net");
 config.keepAwake=false;writeFileSync(join(fixture,"config/server.json"),JSON.stringify(config));
 mkdirSync(join(fixture,"scripts"));mkdirSync(join(fixture,"server/dist"),{recursive:true});
 for(const name of["mac-service.mjs","mac-service-lib.mjs","mac-health.mjs"])copyFileSync(new URL(`../../scripts/${name}`,import.meta.url),join(fixture,"scripts",name));
 writeFileSync(join(fixture,"server/dist/index.js"),"console.log(JSON.stringify({data:process.env.DATA_DIR,backup:process.env.BACKUP_DIR,database:process.env.DATABASE_URL,host:process.env.API_HOST,disabled:process.env.WEB_AUTH_DISABLED,apns:process.env.APNS_KEY_FILE}));console.error('diagnostic');");
 const result=spawnSync(process.execPath,[join(fixture,"scripts/mac-service.mjs"),"run","api"],{env:{...process.env,DATA_DIR:"/outside",DATABASE_URL:"postgresql://outside",WEB_AUTH_DISABLED:"1",APNS_KEY_FILE:"/outside/key.p8"},encoding:"utf8"});
 expect(result.status,result.stderr).toBe(0);expect(JSON.parse(readFileSync(join(fixture,"logs/api.log"),"utf8"))).toEqual({data:join(fixture,"data"),backup:join(fixture,"backups"),database:"",host:"127.0.0.1",disabled:"",apns:""});
 expect(readFileSync(join(fixture,"logs/api.error.log"),"utf8")).toContain("diagnostic");expect(statSync(join(fixture,"logs/api.log")).mode&0o077).toBe(0);
});
it("records early wrapper failures inside the repository even without launchd stderr redirection",()=>{
 const fixture=join(root,"missing-build");setup(fixture,"https://studio.example.ts.net");mkdirSync(join(fixture,"scripts"));
 for(const name of["mac-service.mjs","mac-service-lib.mjs","mac-health.mjs"])copyFileSync(new URL(`../../scripts/${name}`,import.meta.url),join(fixture,"scripts",name));
 const result=spawnSync(process.execPath,[join(fixture,"scripts/mac-service.mjs"),"run","api"],{encoding:"utf8"});
 expect(result.status).toBe(1);const log=join(fixture,"logs/api.launcher.error.log");
 expect(readFileSync(log,"utf8")).toContain("Build the production services first");expect(statSync(log).mode&0o077).toBe(0);
});

import {it,expect,afterAll}from"vitest";
import{mkdtempSync,rmSync,readFileSync,statSync,writeFileSync,mkdirSync,copyFileSync,realpathSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";import{spawnSync}from"node:child_process";
import{setup,configuration,runtimeEnvironment,launchPlist,inside,rotateLog}from"../../scripts/mac-service-lib.mjs";
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
it("rotates bounded logs without touching adjacent files or accepting environment overrides",()=>{
 const log=join(root,"logs/api.log");writeFileSync(log,"previous");writeFileSync(join(root,"logs/keep.txt"),"keep");rotateLog(log,1);expect(readFileSync(log+".1","utf8")).toBe("previous");expect(readFileSync(join(root,"logs/keep.txt"),"utf8")).toBe("keep");
 const config=configuration(root),env=runtimeEnvironment(root,{...config,webPush:{DATA_DIR:"/outside",WEB_PUSH_SUBJECT:"mailto:owner@example.com"}});expect(env.DATA_DIR).toBe(join(root,"data"));expect(env.WEB_PUSH_SUBJECT).toBe("mailto:owner@example.com");
});
it("runs a production child with repo-local storage and captures its output",()=>{
 const fixture=join(root,"runtime"),config=setup(fixture,"https://studio.example.ts.net");
 config.keepAwake=false;writeFileSync(join(fixture,"config/server.json"),JSON.stringify(config));
 mkdirSync(join(fixture,"scripts"));mkdirSync(join(fixture,"server/dist"),{recursive:true});
 for(const name of["mac-service.mjs","mac-service-lib.mjs"])copyFileSync(new URL(`../../scripts/${name}`,import.meta.url),join(fixture,"scripts",name));
 writeFileSync(join(fixture,"server/dist/index.js"),"console.log(JSON.stringify({data:process.env.DATA_DIR,backup:process.env.BACKUP_DIR,database:process.env.DATABASE_URL,host:process.env.API_HOST}));console.error('diagnostic');");
 const result=spawnSync(process.execPath,[join(fixture,"scripts/mac-service.mjs"),"run","api"],{env:{...process.env,DATA_DIR:"/outside",DATABASE_URL:"postgresql://outside"},encoding:"utf8"});
 expect(result.status,result.stderr).toBe(0);expect(JSON.parse(readFileSync(join(fixture,"logs/api.log"),"utf8"))).toEqual({data:join(fixture,"data"),backup:join(fixture,"backups"),database:"",host:"127.0.0.1"});
 expect(readFileSync(join(fixture,"logs/api.error.log"),"utf8")).toContain("diagnostic");expect(statSync(join(fixture,"logs/api.log")).mode&0o077).toBe(0);
});

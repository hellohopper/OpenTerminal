#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, cpSync, chmodSync, appendFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setup, configuration, configureLocal, accessMode, runtimeEnvironment, prepareServices, labelFor, rotateLog, startService, stopService, restartServices, serviceStatus } from './mac-service-lib.mjs';
import { inspectMac, inspectLocal, waitForLocalServices } from './mac-health.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),[command='help',argument,...extra]=process.argv.slice(2);
const run=(program,args,options={})=>{const result=spawnSync(program,args,{stdio:'inherit',...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${program} exited with status ${result.status}`);};
const services=['api','web'];
function assertStopped() {
  if (process.platform !== 'darwin') throw new Error('Mac service commands require macOS.');
  if (services.some(service => serviceStatus(root, service).registered)) throw new Error('Stop the services before changing access or building. Run stop, then retry.');
}
async function menu() {
  if (process.platform !== 'darwin') throw new Error('The Mac control menu requires macOS.');
  const input = createInterface({ input: process.stdin, output: process.stdout });
  const show = () => {
    console.log('\nOpenTerminal — Mac controls');
    try { const config = configuration(root); console.log(`Access: ${accessMode(config)} · ${config.origin}`); }
    catch { console.log('Configuration unavailable. Choose 7 for a new local setup, or correct config/server.json.'); }
    console.log('1 Open browser\n2 Start services\n3 Stop services\n4 Restart services\n5 Service status\n6 Health check\n7 Use local access (services must be stopped)\n8 Build production files (services must be stopped)\n9 Show owner password\n10 Enable login startup\n0 Exit');
    input.setPrompt('Choose: '); input.prompt();
  };
  try {
    show();
    for await (const answer of input) {
      const choice = answer.trim(); if (choice === '0') break;
      try {
        const action = { '1':['open'], '2':['start'], '3':['stop'], '4':['restart'], '5':['status'], '6':['doctor'], '8':['build'], '9':['credentials'], '10':['install'] }[choice];
        if (choice === '7') run(process.execPath, [join(root,'scripts/mac-service.mjs'), ...(existsSync(join(root,'config/server.json')) ? ['access','local'] : ['setup','--local'])]);
        else if (action) run(configuration(root).node, [join(root,'scripts/mac-service.mjs'), ...action]);
        else console.log('Choose a listed action.');
      } catch (error) { console.error(error.message); }
      show();
    }
  } finally { input.close(); }
}
async function main(){
 const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||major===22&&minor<12)throw new Error('Use Node.js 22.12 or newer.');
 if(command==='help'){console.log('Commands: menu | setup --local [--web-port PORT --api-port PORT] | setup --origin HTTPS_URL | access local | open | credentials | build | install | uninstall | start | stop | restart | status [--json] | logs [api|web] | doctor [--json] | serve | run api|web');return;}
 if(command==='menu'){await menu();return;}
 if(command==='setup'){
  if(argument==='--local'){
   const options={local:true},seen=new Set();
   for(let i=0;i<extra.length;i+=2){const key={'--web-port':'webPort','--api-port':'apiPort'}[extra[i]];if(!key||seen.has(key)||!/^\d+$/.test(extra[i+1]??''))throw new Error('Use --web-port PORT and --api-port PORT once each.');options[key]=Number(extra[i+1]);seen.add(key);}
   setup(root,undefined,options);
  }else{if(argument!=='--origin'||!extra[0]||extra.length!==1)throw new Error('Use setup --local or setup --origin HTTPS_URL');setup(root,extra[0]);}
  console.log('Created config/server.json. Read the owner password with the credentials command.');return;
 }
 if(command==='doctor'){
  let report;
  try { report=await inspectMac(root,configuration(root)); }
  catch { report={ok:false,checks:[{name:'configuration',status:'error',detail:'Cannot read valid config/server.json. Run setup --local or correct its fields and permissions.'}]}; }
  if(argument==='--json')console.log(JSON.stringify(report,null,2));
  else { for(const item of report.checks)console.log(`${item.name}: ${item.status.toUpperCase()} — ${item.detail}`);console.log('All application data/config/logs/backups stay in this repository. FileVault may require local unlock/login after reboot.'); }
  process.exitCode=report.ok?0:1;return;
 }
 const config=configuration(root),env={...process.env,...runtimeEnvironment(root,config)};
 if(command==='access'){
  if(argument!=='local'||extra.length)throw new Error('Use access local.');assertStopped();
  const next=configureLocal(root);console.log(`Local access configured: ${next.origin}. Start the services when ready. Previous config is retained at config/server.previous.json when changed. Existing proxy routes must be managed separately.`);return;
 }
 if(command==='open'){if(process.platform!=='darwin')throw new Error('Opening the browser requires macOS.');run('/usr/bin/open',[config.origin]);return;}
 if(command==='credentials'){console.log(`Server: ${config.origin}\nOwner password: ${config.password}`);return;}
 if(command==='build'){
  assertStopped();
  run(config.node,[join(root,'node_modules/typescript/bin/tsc'),'-p',join(root,'server')],{cwd:root,env});
  run(config.node,[join(root,'node_modules/next/dist/bin/next'),'build',join(root,'web')],{cwd:root,env});
  const target=join(root,'web/.next/standalone/web');cpSync(join(root,'web/public'),join(target,'public'),{recursive:true});cpSync(join(root,'web/.next/static'),join(target,'.next/static'),{recursive:true});return;
 }
 if(command==='run'){
  if(!services.includes(argument))throw new Error('Choose api or web.');
  const entry=argument==='api'?join(root,'server/dist/index.js'):join(root,'web/.next/standalone/web/server.js');
  if(!existsSync(entry))throw new Error('Build the production services first.');
  for(const name of ['data','config','logs','backups'])mkdirSync(join(root,name),{recursive:true,mode:0o700});
  for(const suffix of ['log','error.log'])rotateLog(join(root,'logs',`${argument}.${suffix}`));
  const child=spawn(config.node,[entry],{cwd:root,env,stdio:['ignore','pipe','pipe']});
  for(const [stream,suffix]of [[child.stdout,'log'],[child.stderr,'error.log']])stream.on('data',chunk=>{const file=join(root,'logs',`${argument}.${suffix}`);rotateLog(file);appendFileSync(file,chunk,{mode:0o600});});
  const awake=config.keepAwake!==false&&argument==='api'&&process.platform==='darwin'?spawn('/usr/bin/caffeinate',['-i','-w',String(child.pid)],{stdio:'ignore'}):null;
  let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;child.kill(signal);});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('close',(code,signal)=>{awake?.kill();process.exitCode=stopping?0:code??1;});return;
 }
 if(['install','uninstall','start','stop','restart','status'].includes(command)){
  if(process.platform!=='darwin')throw new Error('launchd commands require macOS.');
  const domain=`gui/${process.getuid()}`;
  if(command==='install'){
   prepareServices(root,config);
   const app=join(root,'config','OpenTerminal Launcher.app'),contents=join(app,'Contents'),macos=join(contents,'MacOS');mkdirSync(macos,{recursive:true,mode:0o700});
   const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
   writeFileSync(join(macos,'launch'),`#!/bin/sh\nexec ${quote(config.node)} ${quote(join(root,'scripts/mac-service.mjs'))} start\n`,{mode:0o700});chmodSync(join(macos,'launch'),0o700);
   writeFileSync(join(contents,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>launch</string><key>CFBundleIdentifier</key><string>'+labelFor(root,'launcher')+'</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>');
   try { run('/usr/bin/osascript',['-e','on run argv\n tell application "System Events"\n if exists login item (item 2 of argv) then delete login item (item 2 of argv)\n make new login item at end with properties {path:item 1 of argv,name:item 2 of argv,hidden:true}\n end tell\nend run',app,labelFor(root,'launcher')],{timeout:30000}); }
   catch { throw new Error('Repo-local service files are ready, but login-item registration did not complete. Unlock the Mac and retry install, or add config/OpenTerminal Launcher.app in System Settings → General → Login Items. You can still run start for this session.'); }
   console.log('Created repo-local launchd files and registered the repo-local launcher as a login item. Run start for this session.');return;
  }
  if(command==='uninstall'){for(const service of services){const target=`${domain}/${labelFor(root,service)}`;if(spawnSync('launchctl',['print',target],{stdio:'ignore'}).status===0)run('launchctl',['bootout',target]);}run('/usr/bin/osascript',['-e','on run argv\n tell application "System Events"\n if exists login item (item 1 of argv) then delete login item (item 1 of argv)\n end tell\nend run',labelFor(root,'launcher')]);return;}
  if(command==='stop'){for(const service of ['web','api'])console.log(`${service}: ${stopService(root,service)}`);return;}
  if(command==='status'){
   if(argument&&argument!=='--json')throw new Error('Use status [--json].');
   const states=services.map(service=>({service,...serviceStatus(root,service)})),checks=await inspectLocal(config),ready=checks.every(item=>item.status==='ok');
   if(argument==='--json')console.log(JSON.stringify({accessMode:accessMode(config),origin:config.origin,ready,services:states,checks},null,2));
   else{console.log(`Access: ${accessMode(config)} · ${config.origin}`);for(const state of states)console.log(`${state.service}: ${state.state}${state.pid?` (PID ${state.pid})`:''}${state.lastExit?`; last exit: ${state.lastExit}`:''}`);for(const item of checks)console.log(`${item.name}: ${item.status.toUpperCase()} — ${item.detail}`);}
   process.exitCode=ready?0:1;return;
  }
  prepareServices(root,config);console.log(command==='restart'?'Restarting services…':'Starting services…');
  const started=command==='restart'?restartServices(root,config):services.map(service=>({service,method:startService(root,config,service)}));
  for(const item of started)console.log(`${item.service}: ${item.method}`);
  const readiness=await waitForLocalServices(config);for(const item of readiness.checks)console.log(`${item.name}: ${item.status.toUpperCase()} — ${item.detail}`);
  if(!readiness.ok)throw new Error('Services are registered but local responses are not ready. Check status, doctor and logs under this checkout.');
  console.log(`Ready: ${config.origin}`);return;
 }
 if(command==='logs'){if(!services.includes(argument))throw new Error('Choose logs api or logs web.');run('/usr/bin/tail',['-n','80',join(root,'logs',`${argument}.log`),join(root,'logs',`${argument}.error.log`)]);return;}
 if(command==='serve'){
  if(accessMode(config)==='local')throw new Error('Serve is unavailable in local access mode. Configure Tailscale HTTPS access explicitly first.');
  const binary=config.tailscale??'/usr/local/bin/tailscale';
  const network=spawnSync(binary,['status','--json'],{encoding:'utf8'});if(network.status!==0)throw new Error('Cannot read Tailscale status.');const node=JSON.parse(network.stdout);
  if(node.BackendState!=='Running'||node.Self?.DNSName?.replace(/\.$/,'')!==new URL(config.origin).hostname)throw new Error('WEB_ORIGIN must match this online Tailscale node’s HTTPS hostname.');
  const status=spawnSync(binary,['serve','status','--json'],{encoding:'utf8'});if(status.status!==0)throw new Error('Cannot read Tailscale Serve configuration.');
  if(Object.keys(JSON.parse(status.stdout||'{}')).length)throw new Error('Serve already has configuration. Inspect it before changing its routes.');
  run(binary,['serve','--bg',`http://127.0.0.1:${config.webPort}`]);console.log(`Set iOS server to ${config.origin}. Confirm Serve reports this exact hostname.`);return;
 }
 throw new Error('Unknown command. Run help.');
}
main().catch(error=>{
 if(command==='run'&&services.includes(argument)){
  try { const file=join(root,'logs',`${argument}.launcher.error.log`);mkdirSync(dirname(file),{recursive:true,mode:0o700});rotateLog(file);appendFileSync(file,`${error.message}\n`,{mode:0o600}); } catch { /* The stderr fallback still reports unreadable runtime paths. */ }
 }
 console.error(error.message);process.exitCode=1;
});

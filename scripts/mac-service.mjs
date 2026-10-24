#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, cpSync, chmodSync, appendFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { setup, configuration, runtimeEnvironment, launchPlist, labelFor, rotateLog } from './mac-service-lib.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),[command='help',argument,...extra]=process.argv.slice(2);
const run=(program,args,options={})=>{const result=spawnSync(program,args,{stdio:'inherit',...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${program} exited with status ${result.status}`);};
const serviceFile=service=>join(root,'config','launchd',`${labelFor(root,service)}.plist`);
const services=['api','web'];
async function main(){
 if(command==='help'){console.log('Commands: setup --origin HTTPS_URL | credentials | build | install | uninstall | start | stop | status | logs [api|web] | doctor | serve | run api|web');return;}
 if(command==='setup'){if(argument!=='--origin'||!extra[0])throw new Error('Use setup --origin HTTPS_URL');setup(root,extra[0]);console.log('Created config/server.json. Read the owner password with the credentials command.');return;}
 const config=configuration(root),env={...process.env,...runtimeEnvironment(root,config)};
 if(command==='credentials'){console.log(`Server: ${config.origin}\nOwner password: ${config.password}`);return;}
 if(command==='build'){
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
 if(['install','uninstall','start','stop','status'].includes(command)){
  if(process.platform!=='darwin')throw new Error('launchd commands require macOS.');
  const domain=`gui/${process.getuid()}`;
  if(command==='install'){
   if(!existsSync(join(root,'server/dist/index.js'))||!existsSync(join(root,'web/.next/standalone/web/server.js')))throw new Error('Run build first.');
   mkdirSync(join(root,'config/launchd'),{recursive:true,mode:0o700});
   for(const service of services)writeFileSync(serviceFile(service),launchPlist(root,config,service),{mode:0o600});
   const app=join(root,'config','OpenTerminal Launcher.app'),contents=join(app,'Contents'),macos=join(contents,'MacOS');mkdirSync(macos,{recursive:true,mode:0o700});
   const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
   writeFileSync(join(macos,'launch'),`#!/bin/sh\nexec ${quote(config.node)} ${quote(join(root,'scripts/mac-service.mjs'))} start\n`,{mode:0o700});chmodSync(join(macos,'launch'),0o700);
   writeFileSync(join(contents,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>launch</string><key>CFBundleIdentifier</key><string>'+labelFor(root,'launcher')+'</string><key>CFBundlePackageType</key><string>APPL</string><key>LSBackgroundOnly</key><true/></dict></plist>');
   run('/usr/bin/osascript',['-e','on run argv\n tell application "System Events"\n if exists login item (item 2 of argv) then delete login item (item 2 of argv)\n make new login item at end with properties {path:item 1 of argv,name:item 2 of argv,hidden:true}\n end tell\nend run',app,labelFor(root,'launcher')]);
   console.log('Created repo-local launchd files and registered the repo-local launcher as a login item. Run start for this session.');return;
  }
  if(command==='uninstall'){for(const service of services){const target=`${domain}/${labelFor(root,service)}`;if(spawnSync('launchctl',['print',target],{stdio:'ignore'}).status===0)run('launchctl',['bootout',target]);}run('/usr/bin/osascript',['-e','on run argv\n tell application "System Events"\n if exists login item (item 1 of argv) then delete login item (item 1 of argv)\n end tell\nend run',labelFor(root,'launcher')]);return;}
  for(const service of services){const target=`${domain}/${labelFor(root,service)}`;
   if(command==='start'){if(!existsSync(serviceFile(service)))throw new Error('Run install first.');const state=spawnSync('launchctl',['print',target],{stdio:'ignore'});if(state.status!==0)run('launchctl',['bootstrap',domain,serviceFile(service)]);else run('launchctl',['kickstart',target]);}
   if(command==='stop'){const state=spawnSync('launchctl',['print',target],{stdio:'ignore'});if(state.status===0)run('launchctl',['bootout',target]);}
   if(command==='status'){const state=spawnSync('launchctl',['print',target],{encoding:'utf8'});console.log(`${service}: ${state.status===0?(state.stdout.match(/state = (\S+)/)?.[1]??'registered'):'not registered'}`);}
  }return;
 }
 if(command==='logs'){if(!services.includes(argument))throw new Error('Choose logs api or logs web.');run('/usr/bin/tail',['-n','80',join(root,'logs',`${argument}.log`),join(root,'logs',`${argument}.error.log`)]);return;}
 if(command==='serve'){
  const binary=config.tailscale??'/usr/local/bin/tailscale';
  const network=spawnSync(binary,['status','--json'],{encoding:'utf8'});if(network.status!==0)throw new Error('Cannot read Tailscale status.');const node=JSON.parse(network.stdout);
  if(node.BackendState!=='Running'||node.Self?.DNSName?.replace(/\.$/,'')!==new URL(config.origin).hostname)throw new Error('WEB_ORIGIN must match this online Tailscale node’s HTTPS hostname.');
  const status=spawnSync(binary,['serve','status','--json'],{encoding:'utf8'});if(status.status!==0)throw new Error('Cannot read Tailscale Serve configuration.');
  if(Object.keys(JSON.parse(status.stdout||'{}')).length)throw new Error('Serve already has configuration. Inspect it before changing its routes.');
  run(binary,['serve','--bg',`http://127.0.0.1:${config.webPort}`]);console.log(`Set iOS server to ${config.origin}. Confirm Serve reports this exact hostname.`);return;
 }
 if(command==='doctor'){
  console.log(`Repository: ${root}\nHTTPS origin: ${config.origin}\nData/config/logs/backups: inside repository`);
  for(const [name,port]of [['web',config.webPort],['api',config.apiPort]]){try{const r=await fetch(`http://127.0.0.1:${port}/${name==='api'?'api/status':'login'}`,{signal:AbortSignal.timeout(3000)});console.log(`${name}: HTTP ${r.status}`);}catch{console.log(`${name}: unreachable`);}}
  console.log(`iOS entry: ${config.origin}\nOwner password: not displayed (use credentials)\nAPNs: ${config.apnsKeyFile?'configured; verify Apple signing on device':'not configured'}`);
  const network=spawnSync(config.tailscale??'/usr/local/bin/tailscale',['status','--json'],{encoding:'utf8'});try{const status=JSON.parse(network.stdout);console.log(`Tailscale: ${status.BackendState}; hostname ${status.Self?.DNSName??'unknown'}`);}catch{console.log('Tailscale: unavailable; check the Mac app and CLI installation.');}
  console.log('Install registers a login item pointing into this repo. Runtime files stay here. FileVault may require a local unlock after reboot.');return;
 }
 throw new Error('Unknown command. Run help.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});

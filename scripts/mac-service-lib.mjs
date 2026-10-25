import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
export const readme = 'node scripts/mac-service.mjs setup --origin https://your-mac.your-tailnet.ts.net';
export function directories(root) { return Object.fromEntries(['data','config','logs','backups'].map(name=>[name,join(root,name)])); }
export function validateOrigin(value) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.port&&u.port!=='443')throw new Error('Use an HTTPS origin without a path, credentials or query.');
  return u.origin;
}
export function inside(root,path) {
  const location=resolve(root,path),part=relative(root,location);
  if(part==='..'||part.startsWith(`..${sep}`)||part.startsWith(sep))throw new Error('Runtime paths must stay inside this repository.');
  return location;
}
export function setup(root, origin) {
  origin=validateOrigin(origin); const paths=directories(root);
  for(const path of Object.values(paths))mkdirSync(path,{recursive:true,mode:0o700});
  const file=join(paths.config,'server.json');
  if(existsSync(file))throw new Error('config/server.json already exists. Edit it explicitly; setup never replaces credentials.');
  const config={origin,webPort:3000,apiPort:4000,node:process.execPath,apiKey:randomBytes(32).toString('hex'),password:randomBytes(24).toString('base64url'),sessionSecret:randomBytes(32).toString('hex'),keepAwake:true};
  writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  const policy=join(paths.backups,'policy.json');
  if(!existsSync(policy))writeFileSync(policy,JSON.stringify({enabled:true,hourUtc:7,retain:14})+'\n',{mode:0o600,flag:'wx'});
  return config;
}
export function configuration(root) {
  const file=join(root,'config/server.json'),config=JSON.parse(readFileSync(file,'utf8'));
  validateOrigin(config.origin);
  if(![config.webPort,config.apiPort].every(p=>Number.isInteger(p)&&p>=1024&&p<=65535)||config.webPort===config.apiPort)throw new Error('Use distinct ports between 1024 and 65535.');
  if(typeof config.password!=='string'||config.password.length<12||typeof config.apiKey!=='string'||config.apiKey.length<32||typeof config.sessionSecret!=='string'||config.sessionSecret.length<32)throw new Error('Configure strong owner credentials in config/server.json.');
  if(!config.node||!existsSync(config.node))throw new Error('The configured Node executable is unavailable.');
  if((statSync(file).mode&0o077)!==0)throw new Error('Run chmod 600 config/server.json before starting.');
  if(config.apnsKeyFile)inside(root,config.apnsKeyFile);
  return config;
}
export function runtimeEnvironment(root,config) {
  const paths=directories(root);
  return {NODE_ENV:'production',PATH:`${dirname(config.node)}:${process.env.PATH??'/usr/bin:/bin'}`,DATABASE_URL:'',WEB_AUTH_DISABLED:'',TRUST_PROXY:'',APNS_KEY_FILE:'',APNS_KEY_ID:'',APNS_TEAM_ID:'',APNS_TOPIC:'',APNS_ENVIRONMENT:'sandbox',WEB_PUSH_PUBLIC_KEY:'',WEB_PUSH_PRIVATE_KEY:'',WEB_PUSH_SUBJECT:'',API_HOST:'127.0.0.1',API_PORT:String(config.apiPort),PORT:String(config.webPort),HOSTNAME:'127.0.0.1',API_URL:`http://127.0.0.1:${config.apiPort}`,DATA_DIR:paths.data,BACKUP_DIR:paths.backups,API_KEY_FILE:join(paths.data,'.api-key'),API_KEY:config.apiKey,WEB_PASSWORD:config.password,WEB_SESSION_SECRET:config.sessionSecret,WEB_ORIGIN:config.origin,
    ...Object.fromEntries(['WEB_PUSH_PUBLIC_KEY','WEB_PUSH_PRIVATE_KEY','WEB_PUSH_SUBJECT'].filter(key=>typeof config.webPush?.[key]==='string').map(key=>[key,config.webPush[key]])),...(config.apnsKeyFile?{APNS_KEY_FILE:inside(root,config.apnsKeyFile),APNS_KEY_ID:config.apnsKeyId??'',APNS_TEAM_ID:config.apnsTeamId??'',APNS_TOPIC:config.apnsTopic??'',APNS_ENVIRONMENT:config.apnsEnvironment??'sandbox'}:{})};
}
const xml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function labelFor(root,service) { return `local.openterminal.${createHash('sha256').update(root).digest('hex').slice(0,10)}.${service}`; }
export function launchPlist(root,config,service) {
  const args=[config.node,join(root,'scripts/mac-service.mjs'),'run',service];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${labelFor(root,service)}</string><key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array><key>WorkingDirectory</key><string>${xml(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardOutPath</key><string>${xml(join(root,'logs',`${service}.launcher.log`))}</string><key>StandardErrorPath</key><string>${xml(join(root,'logs',`${service}.launcher.error.log`))}</string></dict></plist>\n`;
}
export function rotateLog(file,limit=5*1024*1024) {
  if(!existsSync(file)||statSync(file).size<limit)return;
  for(let i=2;i>=0;i--){const from=i?`${file}.${i}`:file;if(existsSync(from))renameSync(from,`${file}.${i+1}`);}
}
export function serviceStatus(root, service, { command = spawnSync, uid = process.getuid() } = {}) {
  const target = `gui/${uid}/${labelFor(root, service)}`;
  const result = command('launchctl', ['print', target], { encoding: 'utf8', timeout: 5000 });
  if (result.error) throw result.error;
  if (result.status !== 0) return { target, registered: false, state: 'not registered' };
  const output = result.stdout ?? '';
  return { target, registered: true, state: output.match(/^\s*state = (.+)$/m)?.[1] ?? 'registered',
    pid: Number(output.match(/^\s*pid = (\d+)$/m)?.[1]) || undefined,
    lastExit: output.match(/^\s*last exit code = (.+)$/m)?.[1] };
}
/** A submitted job avoids launchd's root-side ownership checks on ownership-disabled volumes. */
export function startService(root, config, service, { command = spawnSync, uid = process.getuid() } = {}) {
  const options = { encoding: 'utf8', timeout: 10000 };
  const check = result => { if (result.error) throw result.error; if (result.status !== 0) throw new Error((result.stderr ?? '').trim() || `launchctl exited with status ${result.status}`); };
  const state = serviceStatus(root, service, { command, uid });
  if (state.registered) { check(command('launchctl', ['kickstart', state.target], options)); return 'existing'; }
  const loaded = command('launchctl', ['bootstrap', `gui/${uid}`, join(root, 'config/launchd', `${labelFor(root,service)}.plist`)], options);
  if (loaded.error) throw loaded.error;
  if (loaded.status === 0) return 'plist';
  // Only retry the I/O failure used for rejected external-volume plist ownership.
  if (loaded.status !== 5) check(loaded);
  const latest = serviceStatus(root, service, { command, uid });
  if (latest.registered) return 'existing';
  // launchd also opens stdout/stderr before dropping privileges, so the wrapper owns logging.
  check(command('launchctl', ['submit', '-l', labelFor(root,service), '--', config.node, join(root,'scripts/mac-service.mjs'), 'run', service], options));
  return 'submitted';
}

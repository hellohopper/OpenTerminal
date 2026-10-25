import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
export const readme = 'node scripts/mac-service.mjs setup --local';
export function directories(root) { return Object.fromEntries(['data','config','logs','backups'].map(name=>[name,join(root,name)])); }
export function accessMode(config) {
  const mode = config.accessMode ?? 'tailscale'; // Existing HTTPS configurations remain compatible.
  if (!['local', 'tailscale'].includes(mode)) throw new Error('Choose local or tailscale accessMode.');
  return mode;
}
function validatePorts(webPort, apiPort) {
  if (![webPort, apiPort].every(p => Number.isInteger(p) && p >= 1024 && p <= 65535) || webPort === apiPort)
    throw new Error('Use distinct ports between 1024 and 65535.');
}
export function validateAccess(config) {
  validatePorts(config.webPort, config.apiPort);
  if (accessMode(config) === 'local') {
    if (config.origin !== `http://127.0.0.1:${config.webPort}`) throw new Error('Local access must use http://127.0.0.1 with the configured web port.');
  } else validateOrigin(config.origin);
}
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
export function setup(root, origin, { local = false, webPort = 3000, apiPort = 4000 } = {}) {
  if (local) origin = `http://127.0.0.1:${webPort}`; else origin=validateOrigin(origin);
  validateAccess({ origin, accessMode: local ? 'local' : 'tailscale', webPort, apiPort });
  const paths=directories(root);
  for(const path of Object.values(paths))mkdirSync(path,{recursive:true,mode:0o700});
  const file=join(paths.config,'server.json');
  if(existsSync(file))throw new Error('config/server.json already exists. Edit it explicitly; setup never replaces credentials.');
  const config={origin,accessMode:local?'local':'tailscale',webPort,apiPort,node:process.execPath,apiKey:randomBytes(32).toString('hex'),password:randomBytes(24).toString('base64url'),sessionSecret:randomBytes(32).toString('hex'),keepAwake:true};
  writeFileSync(file,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
  const policy=join(paths.backups,'policy.json');
  if(!existsSync(policy))writeFileSync(policy,JSON.stringify({enabled:true,hourUtc:7,retain:14})+'\n',{mode:0o600,flag:'wx'});
  return config;
}
export function configuration(root) {
  const file=join(root,'config/server.json');let config;
  try { config=JSON.parse(readFileSync(file,'utf8')); } catch { throw new Error('Cannot read valid config/server.json. Run setup --local for a new installation, or correct the existing file.'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Use a JSON object in config/server.json.');
  validateAccess(config);
  if(typeof config.password!=='string'||config.password.length<12||typeof config.apiKey!=='string'||config.apiKey.length<32||typeof config.sessionSecret!=='string'||config.sessionSecret.length<32)throw new Error('Configure strong owner credentials in config/server.json.');
  if(!config.node||!existsSync(config.node))throw new Error('The configured Node executable is unavailable.');
  if((statSync(file).mode&0o077)!==0)throw new Error('Run chmod 600 config/server.json before starting.');
  if(config.apnsKeyFile)inside(root,config.apnsKeyFile);
  return config;
}
function atomicConfig(file, contents) {
  const temp = join(dirname(file), `.server-${randomUUID()}.tmp`);
  try { writeFileSync(temp, contents, { mode: 0o600, flag: 'wx' }); renameSync(temp, file); }
  finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function configureLocal(root) {
  const config = configuration(root), file = join(root, 'config/server.json');
  if (accessMode(config) === 'local') return config;
  const next = { ...config, accessMode: 'local', origin: `http://127.0.0.1:${config.webPort}` };
  validateAccess(next);
  atomicConfig(join(root, 'config/server.previous.json'), readFileSync(file));
  atomicConfig(file, JSON.stringify(next, null, 2) + '\n');
  return next;
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
export function prepareServices(root, config) {
  for (const entry of ['server/dist/index.js', 'web/.next/standalone/web/server.js'])
    if (!existsSync(join(root, entry))) throw new Error('Build the production services first.');
  mkdirSync(join(root, 'config/launchd'), { recursive: true, mode: 0o700 });
  for (const service of ['api', 'web'])
    atomicConfig(join(root, 'config/launchd', `${labelFor(root, service)}.plist`), launchPlist(root, config, service));
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
export function stopService(root, service, { command = spawnSync, uid = process.getuid() } = {}) {
  const state = serviceStatus(root, service, { command, uid });
  if (!state.registered) return 'not registered';
  const result = command('launchctl', ['bootout', state.target], { encoding: 'utf8', timeout: 10000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error((result.stderr ?? '').trim() || 'Could not stop the service.');
  return 'stopped';
}
export function restartServices(root, config, dependencies) {
  // Stop both before starting either, so both wrappers reload the same configuration.
  for (const service of ['web', 'api']) stopService(root, service, dependencies);
  return ['api', 'web'].map(service => ({ service, method: startService(root, config, service, dependencies) }));
}

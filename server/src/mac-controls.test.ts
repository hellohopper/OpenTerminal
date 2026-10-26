import { afterAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setup, configuration, configureLocal, accessMode, validateAccess, runtimeEnvironment, prepareServices, restartServices, stopService } from '../../scripts/mac-service-lib.mjs';
import { inspectMac, waitForLocalServices } from '../../scripts/mac-health.mjs';

const roots: string[] = [];
afterAll(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'terminal-controls-')); roots.push(root);
  mkdirSync(join(root, 'scripts'));
  for (const name of ['mac-service.mjs', 'mac-service-lib.mjs', 'mac-health.mjs'])
    copyFileSync(new URL(`../../scripts/${name}`, import.meta.url), join(root, 'scripts', name));
  return root;
}
function built(root: string) {
  for (const entry of ['server/dist/index.js', 'web/.next/standalone/web/server.js']) {
    const file = join(root, entry); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, '// fixture');
  }
}
function cli(root: string, args: string[], preload?: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [...(preload ? ['--import', preload] : []), join(root, 'scripts/mac-service.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 10000 });
}
function fakeMac(root: string) {
  const file = join(root, 'fake-mac.mjs');
  writeFileSync(file, `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {appendFileSync} from 'node:fs';
Object.defineProperty(process,'platform',{value:'darwin'});
const registered={api:process.env.FIXTURE_REGISTERED!=='0',web:process.env.FIXTURE_REGISTERED!=='0'};
cp.spawnSync=(program,args)=>{
 if(program!=='launchctl')throw new Error('Unexpected system command: '+program);
 appendFileSync(${JSON.stringify(join(root, 'calls.jsonl'))},JSON.stringify(args)+'\\n');
 const service=args.some(value=>/\\.api(?:\\.plist)?$/.test(value))?'api':'web';
 if(args[0]==='print')return registered[service]?{status:0,stdout:'state = running\\n pid = 123\\n'}:{status:113,stdout:''};
 if(args[0]==='bootout')registered[service]=false;
 if(args[0]==='bootstrap')registered[service]=true;
 return {status:0,stdout:''};
};syncBuiltinESMExports();
globalThis.fetch=async url=>{if(process.env.FIXTURE_OFFLINE==='1')throw new Error('private diagnostic');return url.endsWith('/api/status')?Response.json({ok:true,database:'sqlite'}):new Response('<title>OpenTerminal</title>',{headers:{'content-type':'text/html'}});};`);
  return file;
}

it('creates authenticated local access on matching loopback ports and retains legacy HTTPS configurations', () => {
  const root = fixture(), config = setup(root, undefined, { local: true, webPort: 5100, apiPort: 5101 });
  expect(configuration(root).origin).toBe('http://127.0.0.1:5100');
  expect(accessMode(config)).toBe('local');
  const env = runtimeEnvironment(root, config);
  expect(env.WEB_ORIGIN).toBe(config.origin); expect(env.WEB_AUTH_DISABLED).toBe('');
  expect(env.API_HOST).toBe('127.0.0.1'); expect(env.HOSTNAME).toBe('127.0.0.1');
  for (const origin of ['http://0.0.0.0:5100', 'http://192.168.1.1:5100', 'http://127.0.0.1:9999', 'https://studio.example'])
    expect(() => validateAccess({ ...config, origin })).toThrow('Local access');
  expect(() => setup(join(root, 'invalid'), undefined, { local: true, webPort: 4000, apiPort: 4000 })).toThrow('distinct');
  const legacy = setup(fixture(), 'https://studio.example.ts.net'); delete legacy.accessMode;
  expect(accessMode(legacy)).toBe('tailscale'); expect(() => validateAccess(legacy)).not.toThrow();
});

it('switches configuration atomically to local access while preserving credentials and a private previous file', () => {
  const root = fixture(), previous = setup(root, 'https://studio.example.ts.net');
  writeFileSync(join(root, 'config/server.previous.json'), 'old backup', { mode: 0o644 });
  const next = configureLocal(root);
  expect(next).toEqual({ ...previous, accessMode: 'local', origin: 'http://127.0.0.1:3000' });
  expect(JSON.parse(readFileSync(join(root, 'config/server.previous.json'), 'utf8'))).toEqual(previous);
  for (const name of ['server.json', 'server.previous.json']) expect(statSync(join(root, 'config', name)).mode & 0o077).toBe(0);
  expect(configureLocal(root)).toEqual(next);
  expect(JSON.parse(readFileSync(join(root, 'config/server.previous.json'), 'utf8'))).toEqual(previous);
});

it('preflights both production builds and prepares repo-local jobs without installing a login item', () => {
  const root = fixture(), config = setup(root, undefined, { local: true });
  expect(() => prepareServices(root, config)).toThrow('Build'); expect(existsSync(join(root, 'config/launchd'))).toBe(false);
  built(root); prepareServices(root, config);
  expect(existsSync(join(root, 'config/OpenTerminal Launcher.app'))).toBe(false);
});

it('stops web and API before restarting either, and cancels restart when stopping fails', () => {
  const root = fixture(), config = setup(root, undefined, { local: true }), active = { api: true, web: true };
  const command = vi.fn((_program: string, args: string[]) => {
    const service = args.some(value => /\.api(?:\.plist)?$/.test(value)) ? 'api' : 'web';
    if (args[0] === 'print') return { status: active[service] ? 0 : 113, stdout: 'state = running\n pid = 123\n' };
    if (args[0] === 'bootout') active[service] = false;
    if (args[0] === 'bootstrap') active[service] = true;
    return { status: 0, stdout: '' };
  });
  restartServices(root, config, { command, uid: 501 });
  const operations = command.mock.calls.filter(call => ['bootout', 'bootstrap'].includes(call[1][0])).map(call => call[1]);
  expect(operations.map(args => args[0])).toEqual(['bootout', 'bootout', 'bootstrap', 'bootstrap']);
  expect(operations[0].at(-1)).toMatch(/\.web$/); expect(operations[1].at(-1)).toMatch(/\.api$/);
  const denied = vi.fn((_program: string, args: string[]) => ({ status: args[0] === 'print' ? 0 : 1, stderr: 'Stop rejected' }));
  expect(() => restartServices(root, config, { command: denied, uid: 501 })).toThrow('Stop rejected');
  expect(denied.mock.calls.some(call => call[1][0] === 'bootstrap')).toBe(false);
  expect(stopService(root, 'api', { command: () => ({ status: 113 }), uid: 501 })).toBe('not registered');
});

it('checks local services without contacting Tailscale and bounds startup readiness retries', async () => {
  const root = fixture(), config = setup(root, undefined, { local: true });
  const request = vi.fn(async (url: string) => url.endsWith('/api/status') ? Response.json({ ok: true, database: 'sqlite' }) : new Response('<title>OpenTerminal</title>', { headers: { 'content-type': 'text/html' } }));
  const command = vi.fn(() => { throw new Error('No network commands expected'); });
  const report = await inspectMac(root, config, { request, command });
  expect(report.ok).toBe(true); expect(report.accessMode).toBe('local'); expect(command).not.toHaveBeenCalled();
  expect(request.mock.calls.every(call => call[0].startsWith('http://127.0.0.1:'))).toBe(true);
  expect(report.checks.some(item => ['https', 'tailscale'].includes(item.name))).toBe(false);
  let attempts = 0; const pause = vi.fn(async () => {});
  const warming = async (url: string) => url.endsWith('/login') && ++attempts === 1 ? new Response('', { status: 503 }) : request(url);
  expect((await waitForLocalServices(config, { request: warming, pause, attempts: 3 })).ok).toBe(true); expect(pause).toHaveBeenCalledTimes(1);
  const failed = await waitForLocalServices(config, { request: async () => new Response('private diagnostic', { status: 503 }), pause, attempts: 2 });
  expect(failed.ok).toBe(false); expect(JSON.stringify(failed)).not.toContain('private diagnostic');
});

it('supports local setup through the CLI and refuses Serve before invoking its CLI', () => {
  const root = fixture(), result = cli(root, ['setup', '--local', '--web-port', '5100', '--api-port', '5101']);
  expect(result.status, result.stderr).toBe(0); const config = configuration(root);
  expect(config.origin).toBe('http://127.0.0.1:5100'); expect(result.stdout).not.toContain(config.password);
  expect(cli(root, ['setup', '--local']).status).toBe(1);
  const serve = cli(root, ['serve']); expect(serve.status).toBe(1); expect(serve.stderr).toContain('local access mode');
});

it('runs restart/status and configuration switching through the real CLI with mocked system commands only', () => {
  const root = fixture(), config = setup(root, 'https://studio.example.ts.net'), preload = fakeMac(root); built(root);
  let result = cli(root, ['access', 'local'], preload);
  expect(result.status).toBe(1); expect(result.stderr).toContain('Stop the services'); expect(configuration(root).origin).toBe(config.origin);
  result = cli(root, ['build'], preload);
  expect(result.status).toBe(1); expect(result.stderr).toContain('Stop the services');
  result = cli(root, ['access', 'local'], preload, { FIXTURE_REGISTERED: '0' });
  expect(result.status, result.stderr).toBe(0); expect(configuration(root).accessMode).toBe('local');
  result = cli(root, ['start'], preload, { FIXTURE_REGISTERED: '0' });
  expect(result.status, result.stderr).toBe(0); expect(existsSync(join(root, 'config/OpenTerminal Launcher.app'))).toBe(false);
  result = cli(root, ['restart'], preload); expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('Ready: http://127.0.0.1:3000');
  result = cli(root, ['status', '--json'], preload); expect(result.status).toBe(0); expect(JSON.parse(result.stdout).ready).toBe(true);
  result = cli(root, ['status', '--json'], preload, { FIXTURE_OFFLINE: '1' });
  expect(result.status).toBe(1); expect(JSON.parse(result.stdout).ready).toBe(false);
  expect(result.stdout).not.toContain(config.password); expect(result.stdout).not.toContain(config.apiKey);
});

it('rejects missing builds before stopping services and redacts malformed configuration errors', () => {
  const root = fixture(), config = setup(root, undefined, { local: true }), preload = fakeMac(root);
  let result = cli(root, ['restart'], preload);
  expect(result.status).toBe(1); expect(result.stderr).toContain('Build');
  expect(existsSync(join(root, 'calls.jsonl'))).toBe(false);
  writeFileSync(join(root, 'config/server.json'), JSON.stringify(config).slice(0, -1));
  result = cli(root, ['status', '--json'], preload);
  expect(result.status).toBe(1); expect(result.stderr).toContain('Cannot read valid');
  for (const secret of [config.password, config.apiKey, config.sessionSecret]) expect(result.stderr).not.toContain(secret);
});

it.skipIf(process.platform !== 'darwin')('opens the control menu from a Finder-style minimal PATH with a configured Node path containing spaces', () => {
  const root = fixture(), config = setup(root, undefined, { local: true });
  const node = join(root, 'Node with spaces'); symlinkSync(process.execPath, node);
  writeFileSync(join(root, 'config/server.json'), JSON.stringify({ ...config, node }));
  const launcher = join(root, 'OpenTerminal.command'); copyFileSync(new URL('../../OpenTerminal.command', import.meta.url), launcher);
  const result = spawnSync('/bin/sh', [launcher], { encoding: 'utf8', input: '0\n', timeout: 5000, env: { ...process.env, PATH: '/usr/bin:/bin', OPENTERMINAL_NODE: '' } });
  expect(result.status, result.stderr).toBe(0); expect(result.stdout).toContain('Restart services');
  expect(result.stdout).not.toContain(config.password); expect(result.stdout).not.toContain(config.apiKey);
});

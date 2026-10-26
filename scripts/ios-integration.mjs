#!/usr/bin/env node
// Disposable, repo-local production builds and real HTTP tests. Never read deployment config.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, cpSync, symlinkSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { runtimeEnvironment } from './mac-service-lib.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const [major, minor] = process.versions.node.split('.').map(Number);
function preflight() {
  if (process.platform !== 'darwin') throw new Error('Run native integration checks on macOS with Swift 6 or newer.');
  if (major < 22 || major === 22 && minor < 12) throw new Error('Use Node.js 22.12 or newer.');
  for (const entry of ['node_modules/typescript/bin/tsc', 'node_modules/next/dist/bin/next'])
    if (!existsSync(join(root, entry))) throw new Error('Install repository dependencies with npm ci first.');
  const found = spawnSync('/usr/bin/xcrun', ['--find', 'swift'], { encoding: 'utf8', timeout: 5000 });
  if (found.status !== 0) throw new Error('Select a Swift 6 toolchain with Xcode or Command Line Tools first.');
  const swift = found.stdout.trim();
  const version = spawnSync(swift, ['--version'], { encoding: 'utf8', timeout: 5000 });
  if (version.status !== 0 || Number(version.stdout.match(/Swift version (\d+)/)?.[1] ?? 0) < 6) throw new Error('Select Swift 6 or newer.');
  return swift;
}
async function unusedPort() {
  const socket = createServer();
  await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return port;
}
async function main() {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/ios-integration.mjs [--check]\nBuild and test a disposable backend/web stack on loopback with the real Swift client. Requires npm ci and Swift 6. Logs remain under test-results/ios-integration/. No live deployment config is read.'); return;
  }
  if (args.length > 1 || args.length === 1 && args[0] !== '--check') throw new Error('Use --check, --help, or no arguments.');
  const swift = preflight();
  if (args[0] === '--check') { console.log('Node, repository dependencies and Swift are available. This check does not verify the iOS SDK, simulator or signing.'); return; }

  const results = join(root, 'test-results/ios-integration'); mkdirSync(results, { recursive: true, mode: 0o700 });
  const run = mkdtempSync(join(results, 'run-'));
  const workspace = join(run, 'workspace'), logs = join(run, 'logs');
  mkdirSync(logs, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
  const children = new Set(), controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const system = Object.fromEntries(['HOME', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'DEVELOPER_DIR', 'TOOLCHAINS'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  let passed = false;
  function launch(name, program, arguments_, env) {
    controller.signal.throwIfAborted();
    const output = createWriteStream(join(logs, `${name}.log`), { mode: 0o600 });
    const child = spawn(program, arguments_, { cwd: workspace, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
    const job = { child, done: false, exit: null };
    job.exit = new Promise(resolve => {
      child.once('error', () => { job.done = true; });
      child.once('close', (code, signal) => { job.done = true; output.end(() => resolve({ code, signal })); });
    });
    children.add(job); return job;
  }
  function kill(job, signal) { if (!job.done && job.child.pid) { try { process.kill(-job.child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } } }
  async function step(name, program, arguments_, env, timeout = 300000) {
    console.log(`${name}…`);
    const job = launch(name, program, arguments_, env);
    let forced, timedOut = false;
    const abort = () => {
      kill(job, 'SIGTERM');
      forced ??= setTimeout(() => kill(job, 'SIGKILL'), 5000); forced.unref();
    };
    controller.signal.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(() => { timedOut = true; abort(); }, timeout); deadline.unref();
    try {
      const result = await job.exit;
      controller.signal.throwIfAborted();
      if (timedOut || result.code !== 0) throw new Error(`${name} failed. See ${join(logs, `${name}.log`)}`);
    } finally { clearTimeout(deadline); clearTimeout(forced); controller.signal.removeEventListener('abort', abort); }
  }
  async function ready(job, url, validate, headers = {}) {
    for (let attempt = 0; attempt < 80; attempt++) {
      controller.signal.throwIfAborted();
      if (job.done) throw new Error('An isolated service exited during startup. Inspect this run’s logs.');
      try {
        const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1000)]) });
        if (response.ok && await validate(response)) return;
      } catch { /* Retry startup failures only; never reuse an existing deployed service. */ }
      await delay(250, undefined, { signal: controller.signal });
    }
    throw new Error('Isolated service readiness timed out. Inspect this run’s logs.');
  }
  try {
    // Copy source/configuration templates only. Do not copy .env, deployment config or prior build output.
    for (const name of ['package.json', 'package-lock.json', 'server/package.json']) {
      mkdirSync(dirname(join(workspace, name)), { recursive: true }); cpSync(join(root, name), join(workspace, name));
    }
    mkdirSync(join(workspace, 'web'));
    for (const name of ['package.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.ts', 'postcss.config.mjs', 'app', 'components', 'lib', 'public', 'store'])
      cpSync(join(root, 'web', name), join(workspace, 'web', name), { recursive: true });
    symlinkSync(join(root, 'node_modules'), join(workspace, 'node_modules'), 'dir');
    const apiPort = await unusedPort(); let webPort;
    do { webPort = await unusedPort(); } while (webPort === apiPort);
    const password = randomBytes(32).toString('hex');
    const config = { accessMode: 'local', origin: `http://127.0.0.1:${webPort}`, webPort, apiPort, node: process.execPath,
      password, apiKey: randomBytes(32).toString('hex'), sessionSecret: randomBytes(32).toString('hex') };
    const env = { ...system, ...runtimeEnvironment(workspace, config), NEXT_TELEMETRY_DISABLED: '1' };
    await step('build-api', process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'server'), '--outDir', join(workspace, 'server/dist')], env);
    await step('build-web', process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build', join(workspace, 'web')], env);
    const api = launch('api', process.execPath, ['--import', join(root, 'tests/fixtures/providers.mjs'), join(workspace, 'server/dist/index.js')], env);
    // An authenticated request also ensures an unrelated process cannot satisfy readiness on a raced port.
    await ready(api, `${env.API_URL}/api/data/status`, response => response.json().then(data => data.database === 'sqlite'), { 'x-api-key': config.apiKey });
    const web = launch('web', process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'start', join(workspace, 'web'), '--hostname', '127.0.0.1', '--port', String(webPort)], env);
    await ready(web, `${config.origin}/login`, response => response.text().then(body => body.includes('OpenTerminal')));
    const plugin = join(dirname(swift), '../lib/swift/host/plugins/testing/libTestingMacros.dylib');
    const flags = existsSync(plugin) ? ['-Xswiftc', '-load-plugin-library', '-Xswiftc', plugin] : [];
    await step('swift-http-tests', swift, ['test', '--disable-xctest', '--package-path', join(root, 'ios'), '--scratch-path', join(run, 'swift'), ...flags, '--filter', 'BackendIntegrationTests'], {
      ...system, TERMINAL_INTEGRATION_ORIGIN: config.origin, TERMINAL_INTEGRATION_PASSWORD: password,
    });
    passed = true;
  } finally {
    controller.abort();
    for (const job of children) kill(job, 'SIGTERM');
    const force = setTimeout(() => { for (const job of children) kill(job, 'SIGKILL'); }, 8000); force.unref();
    await Promise.all([...children].map(job => job.exit)); clearTimeout(force);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    rmSync(workspace, { recursive: true, force: true }); rmSync(join(run, 'swift'), { recursive: true, force: true });
    writeFileSync(join(run, 'result.json'), JSON.stringify({ passed, checkedAt: new Date().toISOString(), scope: 'Swift client → HTTP web proxy → SQLite API; no simulator, signing or external networking validation' }, null, 2) + '\n', { mode: 0o600 });
    console.log(`Integration ${passed ? 'passed' : 'failed'}. Logs: ${logs}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

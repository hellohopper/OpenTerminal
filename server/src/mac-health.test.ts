import { it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { setup } from '../../scripts/mac-service-lib.mjs';
import { inspectMac } from '../../scripts/mac-health.mjs';
const root = mkdtempSync(join(tmpdir(), 'mac-health-')), config = setup(root, 'https://studio.example.ts.net');
afterAll(() => rmSync(root, { recursive: true, force: true }));
const now = Date.parse('2026-10-24T12:00:00Z');
const online = () => ({ status: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'studio.example.ts.net.', Online: true } }) });
const healthy = async (url: string) => url.endsWith('/api/status') ? Response.json({ ok: true, database: 'sqlite' }) : new Response('<title>OpenTerminal</title>', { headers: { 'content-type': 'text/html' } });
it('checks local services and HTTPS; optional unconfigured push does not fail an otherwise healthy host', async () => {
  writeFileSync(join(root, 'backups/status.json'), JSON.stringify({ lastSuccess: new Date(now - 3600000).toISOString(), error: null }));
  const report = await inspectMac(root, config, { request: healthy, command: online, now });
  expect(report.ok).toBe(true); expect(report.checks.find((c: any) => c.name === 'backup').status).toBe('ok');
  expect(report.checks.find((c: any) => c.name === 'apns').status).toBe('warning');
  expect(JSON.stringify(report)).not.toContain(config.password); expect(JSON.stringify(report)).not.toContain(config.apiKey);
});
it('rejects HTTP errors, misleading 200 responses, TLS failures and mismatched Tailscale hosts', async () => {
  for (const request of [async () => new Response('', { status: 503 }), async () => Response.json({ ok: true }), async () => { throw new Error('certificate failure'); }]) {
    const report = await inspectMac(root, config, { request, command: online, now });
    expect(report.ok).toBe(false); expect(report.checks.filter((c: any) => ['web', 'api', 'https'].includes(c.name)).every((c: any) => c.status === 'error')).toBe(true);
  }
  const report = await inspectMac(root, config, { request: healthy, command: () => ({ status: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'other.ts.net.' } }) }), now });
  expect(report.ok).toBe(false); expect(report.checks.find((c: any) => c.name === 'tailscale').status).toBe('error');
});
it('distinguishes stale/failed backups and validates configured APNs keys without exposing them', async () => {
  writeFileSync(join(root, 'backups/status.json'), JSON.stringify({ lastSuccess: '2020-01-01T00:00:00Z', error: null }));
  const missing = { ...config, apnsKeyFile: 'config/missing.p8', apnsKeyId: 'ABCDEFGHIJ', apnsTeamId: 'KLMNOPQRST', apnsTopic: 'com.example.terminal' };
  let report = await inspectMac(root, missing, { request: healthy, command: online, now });
  expect(report.ok).toBe(false); expect(report.checks.find((c: any) => c.name === 'backup').detail).toContain('stale');
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'pem', type: 'pkcs8' });
  writeFileSync(join(root, 'config/key.p8'), key, { mode: 0o600 });
  writeFileSync(join(root, 'backups/status.json'), JSON.stringify({ lastSuccess: new Date(now).toISOString(), error: 'private filesystem diagnostic' }));
  report = await inspectMac(root, { ...missing, apnsKeyFile: 'config/key.p8' }, { request: healthy, command: online, now });
  expect(report.ok).toBe(false); expect(report.checks.find((c: any) => c.name === 'apns').status).toBe('ok');
  expect(report.checks.find((c: any) => c.name === 'backup').detail).toContain('failed');
  expect(JSON.stringify(report)).not.toContain('PRIVATE KEY'); expect(JSON.stringify(report)).not.toContain('private filesystem diagnostic');
});
it('exits nonzero and produces parseable JSON on real CLI failure, including missing configuration', () => {
  const fixture = join(root, 'cli'); mkdirSync(join(fixture, 'scripts'), { recursive: true });
  for (const file of ['mac-service.mjs', 'mac-service-lib.mjs', 'mac-health.mjs']) copyFileSync(new URL(`../../scripts/${file}`, import.meta.url), join(fixture, 'scripts', file));
  const run = (preload: string[] = []) => spawnSync(process.execPath, [...preload, join(fixture, 'scripts/mac-service.mjs'), 'doctor', '--json'], { encoding: 'utf8' });
  let result = run(); expect(result.status).toBe(1); expect(JSON.parse(result.stdout).ok).toBe(false);
  const value = setup(fixture, config.origin); value.tailscale = join(fixture, 'missing-tailscale'); writeFileSync(join(fixture, 'config/server.json'), JSON.stringify(value));
  const preload = join(fixture, 'offline.mjs'); writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline fixture"); };');
  result = run(['--import', preload]); expect(result.status).toBe(1);
  const report = JSON.parse(result.stdout); expect(report.ok).toBe(false); expect(report.checks.find((c: any) => c.name === 'https').status).toBe('error');
  expect(result.stdout).not.toContain(value.password);
  value.tailscale = join(fixture, 'tailscale-fixture');
  writeFileSync(value.tailscale, '#!/bin/sh\nprintf \'%s\\n\' \'{"BackendState":"Running","Self":{"DNSName":"studio.example.ts.net.","Online":true}}\'\n', { mode: 0o700 });
  writeFileSync(join(fixture, 'config/server.json'), JSON.stringify(value));
  writeFileSync(preload, 'globalThis.fetch = async url => url.endsWith("/api/status") ? Response.json({ok:true,database:"sqlite"}) : new Response("<title>OpenTerminal</title>",{headers:{"content-type":"text/html"}});');
  result = run(['--import', preload]); expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout).ok).toBe(true);
});

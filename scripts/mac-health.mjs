import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createPrivateKey } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { inside } from './mac-service-lib.mjs';

// Read-only diagnostics. Never return command output, credentials or key contents.
export async function inspectMac(root, config, { request = fetch, command = spawnSync, now = Date.now() } = {}) {
  const check = (name, status, detail) => ({ name, status, detail });
  const http = async (name, url, api = false) => {
    try {
      const response = await request(url, { redirect: 'error', signal: AbortSignal.timeout(4000) });
      if (!response.ok) return check(name, 'error', `HTTP ${response.status}`);
      if (api) {
        const data = await response.json();
        if (data.ok !== true || data.database !== 'sqlite') return check(name, 'error', 'Unexpected API response; expected the local SQLite backend.');
      } else {
        if (!(response.headers.get('content-type') ?? '').includes('text/html') || !(await response.text()).includes('OpenTerminal')) return check(name, 'error', 'Unexpected web response; check the port or HTTPS route.');
      }
      return check(name, 'ok', 'Reachable');
    } catch { return check(name, 'error', 'Unreachable, timed out, or certificate/response validation failed.'); }
  };
  const checks = await Promise.all([
    http('web', `http://127.0.0.1:${config.webPort}/login`),
    http('api', `http://127.0.0.1:${config.apiPort}/api/status`, true),
    http('https', `${config.origin}/login`),
  ]);
  try {
    const result = command(config.tailscale ?? '/usr/local/bin/tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 4000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) throw new Error();
    const state = JSON.parse(result.stdout);
    const matches = state.Self?.DNSName?.replace(/\.$/, '') === new URL(config.origin).hostname;
    checks.push(check('tailscale', state.BackendState === 'Running' && state.Self?.Online !== false && matches ? 'ok' : 'error',
      state.BackendState === 'Running' && state.Self?.Online !== false && matches ? 'Online; hostname matches the configured HTTPS origin.' : 'Offline or hostname does not match the configured HTTPS origin.'));
  } catch { checks.push(check('tailscale', 'error', 'Cannot read Tailscale status. Check the app and configured CLI path.')); }
  try {
    const policy = JSON.parse(readFileSync(join(root, 'backups/policy.json'), 'utf8'));
    if (typeof policy.enabled !== 'boolean') throw new Error();
    if (!policy.enabled) checks.push(check('backup', 'warning', 'Scheduled backups are disabled.'));
    else {
      let status = {};
      try { status = JSON.parse(readFileSync(join(root, 'backups/status.json'), 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const age = now - Date.parse(status.lastSuccess ?? '');
      const backupState = status.error ? 'error' : !status.lastSuccess ? 'warning' : !Number.isFinite(age) || age < 0 || age > 36 * 3600000 ? 'error' : 'ok';
      checks.push(check('backup', backupState, status.error ? 'Last backup attempt failed. Inspect the Data panel and retry.' : !status.lastSuccess ? 'No successful scheduled backup recorded yet.' : backupState === 'error' ? 'Last backup timestamp is stale or invalid.' : `Last successful backup: ${status.lastSuccess}`));
    }
  } catch { checks.push(check('backup', 'error', 'Cannot read a valid repo-local backup policy/status.')); }
  const apnsFields = ['apnsKeyFile', 'apnsKeyId', 'apnsTeamId', 'apnsTopic'];
  if (!apnsFields.some(key => config[key])) checks.push(check('apns', 'warning', 'Optional native push is not configured.'));
  else {
    try {
      if (!/^[A-Z0-9]{10}$/.test(config.apnsKeyId ?? '') || !/^[A-Z0-9]{10}$/.test(config.apnsTeamId ?? '') || !/^[A-Za-z0-9.-]{1,200}$/.test(config.apnsTopic ?? '') || !['sandbox', 'production'].includes(config.apnsEnvironment ?? 'sandbox') || !config.apnsKeyFile) throw new Error();
      const file = inside(root, config.apnsKeyFile), key = createPrivateKey(readFileSync(file));
      if ((statSync(file).mode & 0o077) !== 0 || key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error();
      checks.push(check('apns', 'ok', 'Signing configuration/key validated locally; device delivery is not verified.'));
    } catch { checks.push(check('apns', 'error', 'Invalid or unreadable APNs configuration/key, or key permissions are not private.')); }
  }
  return { ok: checks.every(item => item.status !== 'error'), checkedAt: new Date(now).toISOString(), checks };
}

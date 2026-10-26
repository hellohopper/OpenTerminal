import { beforeEach, afterAll, it, expect, vi } from 'vitest';
vi.mock('./apns.js', () => ({ apnsConfig: () => ({ environment: 'sandbox' }), sendApns: vi.fn().mockResolvedValue(undefined) }));
import { sendApns } from './apns.js';
import { db } from './db.js';
import { addRecord, records } from './records.js';
import { createNotificationWorker, defaultNotificationSettings } from './notifications.js';
import { mobileDevices } from './routes/mobile.js';
beforeEach(async () => { vi.clearAllMocks(); await db.exec('DELETE FROM research_records; DELETE FROM price_alert_events; DELETE FROM mobile_devices;'); });
afterAll(() => db.close());
async function fixture() {
  const credential = await mobileDevices.register('Native routing fixture'), now = new Date();
  await addRecord('notification-settings', { ...defaultNotificationSettings, enabled: true }, 'owner');
  await addRecord('push-device', { name: 'Phone', nativeToken: 'b'.repeat(64), ownerDeviceId: credential.id, environment: 'sandbox', cursor: 0, joinedAt: new Date(now.getTime() - 1000).toISOString() });
  await addRecord('notification', { title: 'AAPL price alert', body: 'Target reached', symbol: 'AAPL', sourceKey: 'fixture', createdAt: now.toISOString(), read: false });
  return credential;
}
it('passes the verified paired-device ID through the actual native worker send path', async () => {
  const credential = await fixture();
  await createNotificationWorker().check();
  expect(sendApns).toHaveBeenCalledOnce();
  expect(sendApns).toHaveBeenCalledWith('b'.repeat(64), 'sandbox', expect.objectContaining({ symbol: 'AAPL' }), expect.any(Number), credential.id);
  expect(JSON.stringify(vi.mocked(sendApns).mock.calls)).not.toContain(credential.token);
});
it('does not send a notification after that paired device has been revoked', async () => {
  const credential = await fixture(); await mobileDevices.revoke(credential.id);
  await createNotificationWorker().check();
  expect(sendApns).not.toHaveBeenCalled();
  expect(await records('push-device')).toHaveLength(0);
});

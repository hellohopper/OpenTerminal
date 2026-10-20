import {afterAll, afterEach, beforeEach, expect, it, vi} from 'vitest';
import {db} from './db.js';
import {addRecord, records} from './records.js';
import {createPaperMonitor} from './paper-monitor.js';
import type {PaperAccount, PaperOrder, PaperFill} from './paper-trading.js';

vi.mock('./routes/market.js', () => ({
  getQuotes: vi.fn(async (symbols: string[]) => symbols.map(symbol => ({
    symbol, currency: 'USD', price: 100, stale: false,
  }))),
}));

const day = (offset: number) => new Date(Date.UTC(2026, 0, 1 + offset)).toISOString().slice(0, 10);
const history = (offsets: number[]) => ({
  rows: offsets.map(offset => ({
    time: Date.parse(day(offset)) / 1000, open: 100, high: 101,
    low: 99, close: 100, volume: 1000,
  })),
  source: 'test', retrievedAt: '2026-10-01T00:00:00Z', adjustmentBasis: 'raw',
});
async function fixture(after: number) {
  const accountId = await addRecord('paper-account', {
    name: 'Delayed order', capital: 1000, cash: 1000, fee: 1,
    slippageBps: 0, startDate: day(0), lastDate: day(0),
    realized: 0, positions: {},
  } satisfies PaperAccount);
  await addRecord('paper-order', {
    accountId, symbol: 'AAPL', side: 'BUY', type: 'MARKET',
    quantity: 1, price: null, stopLoss: null, takeProfit: null,
    maxLoss: null, afterDate: day(after), status: 'pending',
  } satisfies PaperOrder);
  return accountId;
}

beforeEach(async () => {
  vi.useFakeTimers({toFake: ['Date']});
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  await db.prepare('DELETE FROM research_records').run();
});
afterEach(() => vi.useRealTimers());
afterAll(() => db.close());

it('advances flat checkpoints while waiting for an order to become eligible', async () => {
  const accountId = await fixture(20);
  const monitor = createPaperMonitor(async () => history(Array.from({length: 23}, (_, i) => i + 1)));
  expect(await monitor.check()).toEqual({fills: 1, errors: []});
  const account = (await records<PaperAccount>('paper-account'))[0].payload;
  expect(account.lastDate).toBe(day(23));
  expect(account.cash).toBe(899);
  const fills = await records<PaperFill>(`paper-fill:${accountId}`);
  expect(fills).toHaveLength(1);
  expect(fills[0].payload.date).toBe(day(21));
});

it('makes progress across the 100-bar batch boundary before a delayed order', async () => {
  const accountId = await fixture(120);
  const monitor = createPaperMonitor(async () => history(Array.from({length: 125}, (_, i) => i + 1)));
  expect(await monitor.check()).toEqual({fills: 0, errors: []});
  expect((await records<PaperAccount>('paper-account'))[0].payload.lastDate).toBe(day(100));
  vi.setSystemTime(new Date(Date.now() + 60001));
  expect(await monitor.check()).toEqual({fills: 1, errors: []});
  expect((await records<PaperFill>(`paper-fill:${accountId}`))[0].payload.date).toBe(day(121));
});

it('still rejects missing history when an order was already eligible', async () => {
  const accountId = await fixture(0);
  const monitor = createPaperMonitor(async () => history([20, 21]));
  const result = await monitor.check();
  expect(result).toMatchObject({fills: 0, errors: [expect.stringContaining('large gap')]});
  expect((await records<PaperAccount>('paper-account'))[0].payload.lastDate).toBe(day(0));
  expect(await records<PaperFill>(`paper-fill:${accountId}`)).toHaveLength(0);
  expect((await records<PaperOrder>('paper-order'))[0].payload.status).toBe('pending');
});

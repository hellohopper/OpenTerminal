"use client";
import { useI18n } from "../../lib/use-i18n";
import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete, fmt } from '../../lib/api';
type Result = { asOf: string; totals: Record<string, number>; accounts: { key: string; name: string; nav: number; positions: { symbol: string; currency: string; quantity: number; value: number; pricePnl: number; fxPnl: number; feeImpact: number }[] }[]; warnings: string[]; fxSources: { currency: string; lastDate: string; source: string }[] };
type Entry = { id: number; payload: { kind: string; currency: string; date: string; amount: number; symbol: string | null } };
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="ledger-field"><span>{label}</span>{children}</label>; }
const currencies = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'CNY', 'HKD'];

export default function ConsolidatedLedgerWidget() {
  const { t: ui, locale } = useI18n();
  const qc = useQueryClient();
  const [name, setName] = useState('Foreign account'), [accountId, setAccountId] = useState(0), [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState('DEPOSIT'), [currency, setCurrency] = useState('EUR'), [amount, setAmount] = useState('1000');
  const [symbol, setSymbol] = useState(''), [quantity, setQuantity] = useState('1'), [price, setPrice] = useState('100'), [fee, setFee] = useState('0');
  const [toCurrency, setToCurrency] = useState('USD'), [rate, setRate] = useState('1.1'), [entryFx, setEntryFx] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [marks, setMarks] = useState('');
  const [report, setReport] = useState<{ inputKey: string; data: Result; saved: boolean } | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [feePid, setFeePid] = useState(0), [tradeId, setTradeId] = useState(''), [tradeFee, setTradeFee] = useState('0');
  const q = useQuery({ queryKey: ['consolidated'], queryFn: () => apiGet<{ accounts: { id: number; payload: { name: string } }[]; commissions: { version: number; payload: { portfolioId: number; transactionId: number; fee: number } }[]; reports: { id: number; payload: Result }[] }>('/api/consolidated') });
  const portfolios = useQuery({ queryKey: ['portfolios'], queryFn: () => apiGet<{ id: number; name: string }[]>('/api/portfolios') });
  const id = accountId || q.data?.accounts[0]?.id;
  const entries = useQuery({ queryKey: ['fx-entries', id], queryFn: () => apiGet<Entry[]>(`/api/consolidated/accounts/${id}`), enabled: !!id });
  const trades = useQuery({ queryKey: ['commission-trades', feePid], queryFn: () => apiGet<{ id: number; symbol: string; side: string; executed_at: string }[]>(`/api/portfolios/${feePid}/transactions`), enabled: !!feePid });
  const action = useMutation({ mutationFn: async (fn: () => Promise<unknown>) => fn(), onMutate: () => setMessage(null), onSuccess: () => { qc.invalidateQueries({ queryKey: ['consolidated'] }); qc.invalidateQueries({ queryKey: ['fx-entries'] }); }, onError: error => setMessage({ text: error.message, error: true }) });
  // A response remains associated with the account selection and marks it valued.
  const inputKey = JSON.stringify({ selected: [...selected].sort(), marks });
  const result = report?.inputKey === inputKey ? report.data : null;
  const toggle = (key: string) => { setSelected(previous => previous.includes(key) ? previous.filter(item => item !== key) : [...previous, key]); setReport(null); };
  const isTrade = ['BUY', 'SELL'].includes(kind);
  const moneyLabel = (text: string) => `${ui(text)} (${currency})`;
  return <div className="p-2 space-y-4 ledger-widget">
    <p className="amber">{ui('Consolidated USD ledger · average cost · original and foreign accounts')}</p>
    <section aria-label={ui('Currency accounts')}>
      <div className="ledger-form-grid">
        <Field label={ui('Currency account name')}><input aria-label={ui('Currency account name')} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label={ui('Currency account')}><select aria-label={ui('Currency account')} value={id ?? ''} onChange={e => setAccountId(+e.target.value)}>{!q.data?.accounts.length && <option value="">{ui('Create a currency account first')}</option>}{q.data?.accounts.map(account => <option key={account.id} value={account.id}>{account.payload.name}</option>)}</select></Field>
      </div>
      <button className="term-btn mt-2" disabled={action.isPending || !name.trim()} onClick={() => action.mutate(async () => { const account = await apiPost<{ id: number }>('/api/consolidated/accounts', { name }); setReport(null); setAccountId(account.id); setSelected(previous => [...previous, `a:${account.id}`]); setMessage({ text: 'Currency account created.' }); })}>{ui('Create currency account')}</button>
    </section>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); action.mutate(async () => {
      await apiPost(`/api/consolidated/accounts/${id}`, { kind, currency, amount: isTrade ? 0 : Number(amount), symbol: symbol || null, quantity: isTrade ? Number(quantity) : 0, price: isTrade ? Number(price) : 0, fee: ['BUY', 'SELL', 'FX'].includes(kind) ? Number(fee) : 0, toCurrency: kind === 'FX' ? toCurrency : null, rate: kind === 'FX' ? Number(rate) : null, fxToUsd: entryFx === '' ? null : Number(entryFx), date: date + 'T00:00:00Z' });
      setReport(null); setMessage({ text: 'Currency ledger entry recorded.' });
    }); }}>
      <fieldset><legend className="amber mb-2">{ui('Currency ledger entry')}</legend><div className="ledger-form-grid">
        <Field label={ui('Currency entry type')}><select aria-label={ui('Currency entry type')} value={kind} onChange={e => setKind(e.target.value)}>{['DEPOSIT', 'WITHDRAWAL', 'BUY', 'SELL', 'DIVIDEND', 'SPLIT', 'FX', 'FEE'].map(item => <option key={item} value={item}>{ui(item)}</option>)}</select></Field>
        <Field label={ui('Entry currency')}><select aria-label={ui('Entry currency')} value={currency} onChange={e => setCurrency(e.target.value)}>{currencies.map(item => <option key={item}>{item}</option>)}</select></Field>
        <Field label={ui('Currency entry date')}><input aria-label={ui('Currency entry date')} type="date" required value={date} onChange={e => setDate(e.target.value)} /></Field>
        {!isTrade && <Field label={kind === 'SPLIT' ? ui('Split ratio') : moneyLabel('Cash amount')}><input aria-label={ui('Entry cash amount or split ratio')} type="number" step="any" required value={amount} onChange={e => setAmount(e.target.value)} /></Field>}
        {(isTrade || kind === 'SPLIT') && <Field label={ui('Currency trade symbol')}><input aria-label={ui('Currency trade symbol')} required value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} /></Field>}
        {isTrade && <>
          <Field label={ui('Quantity (shares)')}><input aria-label={ui('Currency trade quantity')} type="number" step="any" required value={quantity} onChange={e => setQuantity(e.target.value)} /></Field>
          <Field label={moneyLabel('Price per share')}><input aria-label={ui('Currency trade price')} type="number" step="any" required value={price} onChange={e => setPrice(e.target.value)} /></Field>
        </>}
        {['BUY', 'SELL', 'FX'].includes(kind) && <Field label={moneyLabel('Commission')}><input aria-label={ui('Entry commission')} type="number" step="any" min="0" required value={fee} onChange={e => setFee(e.target.value)} /></Field>}
        {kind === 'FX' && <>
          <Field label={ui('FX target currency')}><select aria-label={ui('FX target currency')} value={toCurrency} onChange={e => setToCurrency(e.target.value)}>{currencies.map(item => <option key={item}>{item}</option>)}</select></Field>
          <Field label={`${ui('Exchange rate')} (${toCurrency}/${currency})`}><input aria-label={ui('Executed FX target per source')} type="number" step="any" required value={rate} onChange={e => setRate(e.target.value)} /></Field>
        </>}
      </div></fieldset>
      <details className="ledger-advanced"><summary>{ui('Advanced currency conversion')}</summary><Field label={`${ui('Entry USD per currency override')} (USD/${currency})`}><input aria-label={ui('Entry USD per currency override')} placeholder={ui('USD per currency (optional)')} type="number" step="any" value={entryFx} onChange={e => setEntryFx(e.target.value)} /></Field><p className="dim">{ui('Commission is paid in the entry currency. FX rate is target units per source unit. Optional entry USD rate records your historical conversion assumption.')}</p></details>
      <button className="term-btn" disabled={!id || action.isPending}>{ui(action.isPending ? 'Saving…' : 'Record currency entry')}</button>
    </form>
    <details><summary>{ui('Currency ledger entries')}</summary>{entries.data?.map(entry => <div className="ledger-entry" key={entry.id}><span>{entry.payload.date.slice(0, 10)} · {ui(entry.payload.kind)} · {entry.payload.currency} {entry.payload.amount} {entry.payload.symbol}</span><button className="term-btn" disabled={action.isPending} onClick={() => action.mutate(async () => { await apiDelete(`/api/consolidated/accounts/${id}/entries/${entry.id}`); setReport(null); })}>{ui('Delete entry #')}{entry.id}</button></div>)}</details>
    <details><summary>{ui('Annotate an existing USD trade commission')}</summary><div className="ledger-form-grid mt-2">
      <Field label={ui('Commission portfolio')}><select aria-label={ui('Commission portfolio')} value={feePid} onChange={e => { setFeePid(+e.target.value); setTradeId(''); }}><option value="0">{ui('Select portfolio')}</option>{portfolios.data?.map(portfolio => <option key={portfolio.id} value={portfolio.id}>{portfolio.name}</option>)}</select></Field>
      <Field label={ui('Commission trade')}><select aria-label={ui('Commission trade')} value={tradeId} onChange={e => setTradeId(e.target.value)}><option value="">{ui('Select trade')}</option>{trades.data?.map(trade => <option key={trade.id} value={trade.id}>{trade.symbol} {ui(trade.side)} {trade.executed_at}</option>)}</select></Field>
      <Field label={`${ui('Commission')} (USD)`}><input aria-label={ui('Existing trade commission USD')} type="number" min="0" value={tradeFee} onChange={e => setTradeFee(e.target.value)} /></Field>
    </div><button className="term-btn mt-2" disabled={!tradeId || action.isPending} onClick={() => action.mutate(async () => { await apiPost('/api/consolidated/commission', { portfolioId: feePid, transactionId: Number(tradeId), fee: Number(tradeFee), version: q.data?.commissions.find(item => item.payload.portfolioId === feePid && item.payload.transactionId === Number(tradeId))?.version ?? 0 }); setReport(null); setMessage({ text: 'Commission annotation saved.' }); })}>{ui('Save commission annotation')}</button></details>
    <section><h3 className="amber">{ui('Select accounts for consolidation')}</h3>
      {portfolios.data?.map(portfolio => <label className="block" key={`p:${portfolio.id}`}><input type="checkbox" checked={selected.includes(`p:${portfolio.id}`)} onChange={() => toggle(`p:${portfolio.id}`)} />{ui('Portfolio:')} {portfolio.name}</label>)}
      {q.data?.accounts.map(account => <label className="block" key={`a:${account.id}`}><input type="checkbox" checked={selected.includes(`a:${account.id}`)} onChange={() => toggle(`a:${account.id}`)} />{ui('Currency:')} {account.payload.name}</label>)}
      <Field label={ui('Optional manual marks: SYMBOL,CURRENCY,PRICE,YYYY-MM-DD')}><textarea aria-label={ui('Manual currency marks')} value={marks} onChange={e => setMarks(e.target.value)} /></Field>
      <div className="flex gap-2 flex-wrap mt-2">{[false, true].map(save => <button key={String(save)} className="term-btn" disabled={action.isPending || !selected.length} onClick={() => action.mutate(async () => {
        const parsed = marks.split('\n').filter(line => line.trim()).map(line => { const [symbol, currency, price, date, ...rest] = line.split(',').map(value => value.trim()); if (rest.length || !symbol || !currency || !price || !Number.isFinite(Number(price)) || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Invalid mark row'); return { symbol, currency, price: Number(price), date }; });
        setReport({ inputKey, saved: save, data: await apiPost<Result>('/api/consolidated/report', { portfolioIds: selected.filter(key => key.startsWith('p:')).map(key => +key.slice(2)), accountIds: selected.filter(key => key.startsWith('a:')).map(key => +key.slice(2)), marks: parsed, save }) });
        if (save) setMessage({ text: 'Consolidated report saved.' });
      })}>{ui(save ? 'Save consolidated report' : 'Calculate consolidated report')}</button>)}</div>
    </section>
    {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'down' : 'up'}>{ui(message.text)}</p>}
    {result && <section className="space-y-2"><p className="dim">{ui(report?.saved ? 'Saved snapshot' : 'Calculated report')} · {new Date(result.asOf).toLocaleString(locale)}</p><p className="amber" data-testid="consolidated-result">{ui('NAV')} {fmt(result.totals.nav)} {ui('USD · Net deposits')} {fmt(result.totals.netDeposits)} {ui('· Net P&L')} {fmt(result.totals.netPnl)}</p><p>{ui('Price effect')} {fmt(result.totals.priceEffect)} {ui('+ FX/cash effect')} {fmt(result.totals.fxEffect)} {ui('+ Dividends')} {fmt(result.totals.dividends)} {ui('− Fees')} {fmt(result.totals.fees)}</p>{result.accounts.map(account => <section key={account.key}><h3>{account.name} {ui('· NAV')} {fmt(account.nav)}</h3>{account.positions.map(position => <p key={position.symbol + position.currency}>{position.symbol} {position.currency} · {fmt(position.quantity, 4)} {ui('shares · Value USD')} {fmt(position.value)} {ui('· Price')} {fmt(position.pricePnl)} {ui('· FX')} {fmt(position.fxPnl)} {ui('· Entry fees')} {fmt(position.feeImpact)}</p>)}</section>)}{result.warnings.map(warning => <p className="dim" key={warning}>{ui(warning)}</p>)}{result.fxSources.map(source => <p key={source.currency} className="dim">{source.currency}: {source.lastDate} · {source.source}</p>)}</section>}
    <section><h3 className="amber">{ui('Saved reports')}</h3><div className="flex gap-2 flex-wrap">{q.data?.reports.map(saved => <button key={saved.id} className="term-btn" onClick={() => setReport({ inputKey, data: saved.payload, saved: true })}>{new Date(saved.payload.asOf).toLocaleString(locale)}</button>)}</div></section>
  </div>;
}

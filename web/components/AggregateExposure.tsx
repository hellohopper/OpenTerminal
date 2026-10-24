"use client";
import {useRef,useState} from 'react';
import {useQuery,useMutation} from '@tanstack/react-query';
import {apiGet,apiPost,fmt} from '../lib/api';
import {useI18n} from '../lib/use-i18n';
type Report={asOf:string;nav:number;cash:number;largestPositionPercent:number;holdings:{symbol:string;currency:string;quantity:number;value:number;weight:number;sector:string;accounts:string[]}[];currencies:{currency:string;value:number;weight:number}[];accounts:{key:string;name:string;nav:number;weight:number}[];sectors:{sector:string;value:number;weight:number}[];warnings:string[];fxSources:unknown[];marks:unknown[]};
export default function AggregateExposure(){
 const {t}=useI18n(),[portfolios,setPortfolios]=useState<number[]>([]),[accounts,setAccounts]=useState<number[]>([]),[marks,setMarks]=useState(''),[result,setResult]=useState<Report|null>(null);
 const inputKey=JSON.stringify([portfolios,accounts,marks]),latest=useRef(inputKey);latest.current=inputKey;
 const p=useQuery({queryKey:['portfolios'],queryFn:()=>apiGet<{id:number;name:string}[]>('/api/portfolios')}),a=useQuery({queryKey:['consolidated'],queryFn:()=>apiGet<{accounts:{id:number;payload:{name:string}}[]}>('/api/consolidated')});
 const request=useMutation({mutationFn:async()=>{
   const selected=inputKey;
   const manual=marks.trim()?marks.trim().split('\n').map(line=>{const [symbol,currency,price,date,...extra]=line.split(',').map(v=>v.trim());if(extra.length||!symbol||!currency||!price||!date||!Number.isFinite(Number(price)))throw new Error(t('Use SYMBOL,CURRENCY,PRICE,YYYY-MM-DD per line.'));return {symbol:symbol.toUpperCase(),currency:currency.toUpperCase(),price:Number(price),date};}):[];
   const report=await apiPost<Report>('/api/portfolio-risk/aggregate',{portfolioIds:portfolios,accountIds:accounts,marks:manual});
   if(latest.current===selected)setResult(report);
 },onMutate:()=>setResult(null)});
 const toggle=(values:number[],id:number)=>values.includes(id)?values.filter(v=>v!==id):[...values,id];
 const changed=()=>{setResult(null);request.reset();};
 return <section className="border border-[var(--border)] p-2 space-y-2"><h3 className="amber">{t('Combined account exposure')}</h3><p className="dim">{t('Choose actual accounts once. Imported copies of the same account must not be selected together. Paper and option simulations are excluded.')}</p>
 <details open><summary>{t('Select accounts')}</summary>{p.data?.map(r=><label className="block" key={r.id}><input type="checkbox" aria-label={`${t('Exposure portfolio')} ${r.name}`} checked={portfolios.includes(r.id)} onChange={()=>{setPortfolios(toggle(portfolios,r.id));changed();}}/>{t('Portfolio')} · {r.name}</label>)}{a.data?.accounts.map(r=><label className="block" key={r.id}><input type="checkbox" aria-label={`${t('Exposure currency account')} ${r.payload.name}`} checked={accounts.includes(r.id)} onChange={()=>{setAccounts(toggle(accounts,r.id));changed();}}/>{t('Currency account')} · {r.payload.name}</label>)}</details>
 {(p.error||a.error)&&<p role="alert">{p.error?.message||a.error?.message}</p>}
 <details><summary>{t('Optional manual price marks')}</summary><label>{t('Use SYMBOL,CURRENCY,PRICE,YYYY-MM-DD per line.')}<textarea className="w-full" aria-label={t('Exposure manual marks')} value={marks} onChange={e=>{setMarks(e.target.value);changed();}}/></label></details>
 <button className="term-btn" disabled={request.isPending||!portfolios.length&&!accounts.length} onClick={()=>request.mutate()}>{t('Analyze combined exposure')}</button>{request.error&&<p role="alert">{request.error.message}</p>}
 {result&&<div data-testid="combined-exposure"><p>{t('NAV')} USD {fmt(result.nav)} · {t('Cash')} {fmt(result.cash)} · {t('Largest position')} {fmt(result.largestPositionPercent)}%</p><p className="dim">{result.asOf}</p>
 <table className="data-table"><thead><tr><th>{t('Asset')}</th><th>{t('Currency')}</th><th>{t('Quantity')}</th><th>{t('Value USD')}</th><th>{t('Weight %')}</th><th>{t('Accounts')}</th></tr></thead><tbody>{result.holdings.map(r=><tr key={`${r.symbol}:${r.currency}`}><td>{r.symbol}</td><td>{r.currency}</td><td>{fmt(r.quantity)}</td><td>{fmt(r.value)}</td><td>{fmt(r.weight)}</td><td>{r.accounts.join(', ')}</td></tr>)}</tbody></table>
 <h4>{t('Currency exposure')}</h4>{result.currencies.map(r=><p key={r.currency}>{r.currency} · USD {fmt(r.value)} · {fmt(r.weight)}%</p>)}<h4>{t('Sector exposure')}</h4>{result.sectors.map(r=><p key={r.sector}>{r.sector} · {fmt(r.weight)}%</p>)}<details><summary>{t('Accounts and sources')}</summary>{result.accounts.map(r=><p key={r.key}>{r.name} ({r.key}) · USD {fmt(r.nav)}</p>)}<pre className="whitespace-pre-wrap">{JSON.stringify({marks:result.marks,fxSources:result.fxSources},null,2)}</pre></details>{result.warnings.map(w=><p className="dim" key={w}>{t(w)}</p>)}</div>}
 </section>;
}

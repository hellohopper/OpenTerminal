import {it,expect} from 'vitest';import {parseAccountCsv,previewAccount,reconcileAccount} from './account-import.js';
import {multiEntry} from './multicurrency.js';
const csv='kind,currency,date,amount,symbol,quantity,price,fee,sourceId\nDEPOSIT,USD,2026-01-01,1000,,,,,D1\nBUY,USD,2026-01-02,,AAPL,2,100,2,B1\nFEE,USD,2026-01-03,3,,,,,F1';
it('imports fees with cash validation, source conflicts, row errors and duplicate fingerprints',()=>{const parsed=parseAccountCsv(csv),p=previewAccount(parsed,[],[]);expect(p.errors).toEqual([]);expect(p.rows).toHaveLength(3);const existing=p.rows.map((r,i)=>({id:i+1,payload:r.entry}));expect(previewAccount(parsed,existing,[]).duplicates).toBe(3);expect(previewAccount(parsed,existing.map((r,i)=>i===1?{...r,payload:{...r.payload,date:'2026-01-02T01:00:00+01:00'}}:r),[]).duplicates).toBe(3);expect(previewAccount(parsed,[],[{sourceId:'B1',hash:'conflict'}]).errors).not.toHaveLength(0);expect(previewAccount(parseAccountCsv(csv.replace('1000','1')),[],[]).errors[0].error).toContain('Insufficient');expect(parseAccountCsv(csv+'\nBUY,USD,2026-01-01,,AAPL,-2,100,,bad').errors).toHaveLength(1);});
it('reconciles complete native balances at the statement date without hiding omitted holdings',()=>{const entries=parseAccountCsv(csv).parsed.map(r=>r.entry);expect(reconcileAccount(entries,'kind,currency,symbol,value\nCASH,USD,,795\nPOSITION,USD,AAPL,2','2026-01-03').matched).toBe(true);expect(reconcileAccount(entries,'kind,currency,symbol,value\nCASH,USD,,795','2026-01-03').matched).toBe(false);expect(reconcileAccount(entries,'kind,currency,symbol,value\nCASH,USD,,1000','2026-01-01').matched).toBe(true);});

it('maps quoted CSV column labels consistently with the browser selectors',async()=>{const {csvHeaders}=await import('../../web/lib/csv-headers');const csv='"Action, detail",Currency,Date,Amount\nDEPOSIT,USD,2026-01-01,1000';expect(csvHeaders(csv)).toEqual(['Action, detail','Currency','Date','Amount']);expect(parseAccountCsv(csv,{kind:'Action, detail',currency:'Currency',date:'Date',amount:'Amount'}).parsed[0].entry.amount).toBe(1000);});

it('detects conflicting source IDs even when their first row duplicates an existing entry',()=>{
 const existing=[{id:1,payload:multiEntry.parse({kind:'DEPOSIT',currency:'USD',amount:1000,date:'2026-01-01T00:00:00Z'})}];
 const parsed=parseAccountCsv('kind,currency,date,amount,sourceId\nDEPOSIT,USD,2026-01-01,1000,D1\nDEPOSIT,USD,2026-01-01,2000,D1');
 const result=previewAccount(parsed,existing,[]);
 expect(result.duplicates).toBe(1);
 expect(result.rows).toHaveLength(0);
 expect(result.errors).toEqual([{row:3,error:expect.stringContaining('Source transaction ID conflicts')}]);
});

it('reconciles offset timestamps against the UTC statement day in both directions',()=>{
 const entries=[
  multiEntry.parse({kind:'DEPOSIT',currency:'USD',amount:100,date:'2026-01-02T00:30:00+02:00'}),
  multiEntry.parse({kind:'DEPOSIT',currency:'USD',amount:200,date:'2026-01-01T23:30:00-02:00'}),
 ];
 expect(reconcileAccount(entries,'kind,currency,symbol,value\nCASH,USD,,100','2026-01-01').matched).toBe(true);
 expect(reconcileAccount(entries,'kind,currency,symbol,value\nCASH,USD,,300','2026-01-02').matched).toBe(true);
});

import {describe,it,expect} from 'vitest';import {parseCsv,previewCsv,exportTrades} from './trade-csv.js';
const csv='Ticker,Action,Qty,Price,Date\r\nAAPL,BUY,2,100,2026-01-01\r\n';
describe('trade CSV',()=>{
 it('handles BOM, escaped quotes, CRLF and quoted newlines',()=>{expect(parseCsv('\uFEFFa,b\r\n"x,y","a""b\nc"')).toEqual([['a','b'],['x,y','a"b\nc']]);expect(()=>parseCsv('a\n"bad')).toThrow('Unclosed');});
 it('maps headers and identifies duplicates including within one import',()=>{const first=previewCsv(csv,[]);expect(first.rows).toHaveLength(1);expect(previewCsv(csv,first.rows).duplicates).toBe(1);expect(previewCsv(csv+'AAPL,BUY,2,100,2026-01-01',[]).rows).toHaveLength(1);});
 it('rejects invalid dates, non-finite numbers, blank prices and ambiguous headers',()=>{for(const row of ['AAPL,BUY,2,,2026-01-01','AAPL,BUY,NaN,1,2026-01-01','AAPL,SELL,2,1,2026-02-30'])expect(previewCsv('Ticker,Action,Qty,Price,Date\n'+row,[]).errors).not.toHaveLength(0);expect(()=>previewCsv('a,a\nx,y',[])).toThrow('unique');});
 it('exports a roundtrippable canonical CSV and supports explicit mappings',()=>{const rows=previewCsv(csv,[]).rows;expect(previewCsv(exportTrades(rows),[]).rows).toEqual(rows);expect(previewCsv('S,D,Q,P,T\nAAPL,BUY,1,0,2026-01-01',[],{symbol:'S',side:'D',quantity:'Q',price:'P',executed_at:'T'}).rows).toHaveLength(1);});
});

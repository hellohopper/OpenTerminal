import {it,expect} from 'vitest';import {multiEntry,replayMulti,valueMulti} from './multicurrency.js';
const e=(v:Record<string,unknown>)=>multiEntry.parse({currency:'EUR',date:'2026-01-01T00:00:00Z',...v});
it('looks up daily FX using the UTC transaction date, including existing offset entries',()=>{
 const dates:string[]=[];
 const state=replayMulti([
  e({kind:'DEPOSIT',amount:100,date:'2026-01-02T00:30:00+02:00'}),
  e({kind:'DEPOSIT',amount:200,date:'2026-01-01T23:30:00-02:00'}),
 ],(_currency,date)=>{dates.push(date);return date==='2026-01-01'?1.1:1.2;});
 expect(dates).toEqual(['2026-01-01','2026-01-02']);
 expect(state.netDeposits).toBeCloseTo(350);
});
it('reconciles price, FX, fees and cash under foreign-currency valuation',()=>{const state=replayMulti([e({kind:'DEPOSIT',amount:1000,fxToUsd:1.1}),e({kind:'BUY',symbol:'EURTEST',quantity:5,price:100,fee:2,fxToUsd:1.1})],()=>1.1),r=valueMulti(state,[{symbol:'EURTEST',currency:'EUR',price:110}],()=>1.2);expect(r.nav).toBeCloseTo(1257.6);expect(r.netPnl).toBeCloseTo(157.6);expect(r.positions[0].pricePnl).toBeCloseTo(60);expect(r.positions[0].fxPnl).toBeCloseTo(50);expect(r.priceEffect+r.fxEffect+r.dividends-r.fees).toBeCloseTo(r.netPnl);});
it('records executed FX cash and fees without treating conversion as funding',()=>{const s=replayMulti([e({kind:'DEPOSIT',currency:'USD',amount:1100}),e({kind:'FX',currency:'USD',amount:1000,toCurrency:'EUR',rate:.9,fee:2})],()=>1.2),r=valueMulti(s,[],c=>c==='USD'?1:1.2);expect(s.netDeposits).toBe(1100);expect(r.nav).toBe(1178);expect(r.netPnl).toBe(78);expect(r.fees).toBe(2);});
it('keeps split basis, handles partial exits and rejects unfunded or oversold histories',()=>{const entries=[e({kind:'DEPOSIT',amount:1000}),e({kind:'BUY',symbol:'EURTEST',quantity:5,price:100}),e({kind:'SPLIT',symbol:'EURTEST',amount:2}),e({kind:'SELL',symbol:'EURTEST',quantity:2,price:60})],s=replayMulti(entries,()=>1);expect(s.positions[0].quantity).toBe(8);expect(s.positions[0].principalLocal).toBe(400);expect(s.realized).toBe(20);expect(()=>replayMulti(entries.slice(1),()=>1)).toThrow('funding');expect(()=>replayMulti([e({kind:'SELL',symbol:'X',quantity:1,price:1})],()=>1)).toThrow('Sell exceeds');});

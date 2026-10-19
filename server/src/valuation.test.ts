import {describe,it,expect} from 'vitest';
import {valuePortfolio} from '../../web/lib/valuation';
import type {Quote} from '../../web/lib/api';
const now=Date.parse('2026-10-16T16:00:00Z');
const p={symbol:'AAPL',quantity:2,avgCost:100,realizedPnl:10};
const q={symbol:'AAPL',price:110,currency:'USD',retrievedAt:new Date(now).toISOString(),stale:false} as Quote;
describe('truthful portfolio valuation',()=>{
 it('withholds aggregate values instead of substituting cost for missing prices',()=>{expect(valuePortfolio([p],[],now)).toMatchObject({marketValue:null,unrealized:null,realized:10,missing:['AAPL']});});
 it('rejects stale, expired, nonfinite and unverified currency quotes',()=>{for(const patch of [{stale:true},{retrievedAt:undefined},{retrievedAt:new Date(now-130000).toISOString()},{price:NaN},{currency:'EUR'}])expect(valuePortfolio([p],[{...q,...patch}],now).marketValue).toBeNull();});
 it('values valid USD holdings and preserves realized closed positions without a quote',()=>{expect(valuePortfolio([p],[q],now)).toMatchObject({marketValue:220,unrealized:20,realized:10});expect(valuePortfolio([{...p,quantity:0}],[],now)).toMatchObject({marketValue:0,unrealized:0,realized:10});});
});

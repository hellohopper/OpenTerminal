import {it,expect} from 'vitest';
import {aggregateExposure} from './aggregate-exposure.js';
const a={key:'portfolio:1',name:'One',nav:1000,cash:[{currency:'USD',amount:500,value:500}],positions:[{symbol:'ABC',currency:'USD',quantity:5,value:500}]};
const b={key:'currency:2',name:'Two',nav:1000,cash:[{currency:'EUR',amount:100,value:200}],positions:[{symbol:'ABC',currency:'USD',quantity:8,value:800}]};
it('merges positions without losing account provenance and reconciles currency exposure to NAV',()=>{
 const r=aggregateExposure([a,b],{ABC:'Technology'});expect(r.nav).toBe(2000);expect(r.cash).toBe(700);expect(r.holdings).toHaveLength(1);expect(r.holdings[0]).toMatchObject({quantity:13,weight:65,accounts:['portfolio:1','currency:2']});expect(r.largestPositionPercent).toBe(65);expect(r.currencies.reduce((s,c)=>s+c.weight,0)).toBe(100);expect(r.sectors[0].weight).toBe(65);
});
it('rejects duplicate and simulated accounts and withholds empty NAV',()=>{
 expect(()=>aggregateExposure([a,a],{})).toThrow('twice');expect(()=>aggregateExposure([{...a,key:'paper:1'}],{})).toThrow('Simulated');expect(()=>aggregateExposure([],{})).toThrow('positive');expect(aggregateExposure([a],{}).holdings[0].sector).toBe('Unclassified');
});

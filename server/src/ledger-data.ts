import {db} from './db.js';import type {Trade,CashEvent} from './portfolio.js';
export async function ledgerData(id:number){
 if(!Number.isSafeInteger(id)||id<1)throw new Error('Invalid portfolio');
 if(!await db.prepare('SELECT id FROM portfolios WHERE id=?').get(id))throw new Error('Portfolio not found');
 const trades=await db.prepare('SELECT * FROM transactions WHERE portfolio_id=? ORDER BY executed_at,id LIMIT 50001').all(id) as Trade[];
 const events=await db.prepare('SELECT * FROM portfolio_events WHERE portfolio_id=? ORDER BY executed_at,id LIMIT 50001').all(id) as CashEvent[];
 if(trades.length+events.length>50000)throw new Error('Up to 50000 ledger entries are supported.');return {trades,events};
}

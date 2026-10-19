const realFetch = globalThis.fetch;
const now = new Date(), today = now.toISOString().slice(0,10), next = new Date(Date.now()+2*86400000).toISOString().slice(0,10);
const expiry = new Date(Date.now()+15*86400000).toISOString().slice(0,10);
const json = (body) => new Response(JSON.stringify(body), { headers:{'content-type':'application/json'} });
const day = (offset) => new Date(Date.parse(today)+offset*86400000);
globalThis.fetch = async (input, init) => {
 const url = String(input);
 if (url.includes('api.nasdaq.com/api/autocomplete')) return json({data:[{symbol:'AAPL',asset:'STOCKS'},{symbol:'MSFT',asset:'STOCKS'}]});
 if (url.includes('api.nasdaq.com') && url.includes('/info?')) return json({data:{companyName:'Fixture Company',exchange:'NASDAQ',marketStatus:'Closed',primaryData:{lastSalePrice:'$110.00',netChange:'$1',percentageChange:'+1%',previousClose:'$109',volume:'100000'},keyStats:{dayrange:{value:'$108 - $111'},fiftyTwoWeekHighLow:{value:'$80 - $120'}}}});
 if (url.includes('api.nasdaq.com') && url.includes('/summary?')) return json({data:{summaryData:{MarketCap:{value:'1000000000'},PreviousClose:{value:'$109'},AverageVolume:{value:'100000'}}}});
 if (url.includes('/BTEST/chart?')) {const days=Array.from({length:130},(_,i)=>day(i-130)).filter(d=>![0,6].includes(d.getUTCDay())).slice(-80);return json({data:{chart:days.map((d,i)=>{const price=100+Math.sin(i/5)*8+i*.15;return {x:d.getTime(),z:{open:String(price-.5),high:String(price+2),low:String(price-2),close:String(price),volume:'10000'}};})}});}
 if (url.includes('api.nasdaq.com') && url.includes('/chart?')) return json({data:{chart:Array.from({length:20},(_,i)=>({x:day(i-19).getTime(),z:{open:`$${100+i}`,high:`$${102+i}`,low:`$${99+i}`,close:`$${101+i}`,volume:'10000'}}))}});
 if (url.includes('api.nasdaq.com') && url.includes('/option-chain?')) return json({data:{lastTrade:'$110',table:{rows:[100,110,120,130].map(strike=>({expiryDate:expiry,strike:String(strike),c_Last:'5',c_Bid:'4',c_Ask:'6',p_Last:'4',p_Bid:'3',p_Ask:'5',c_Volume:'100',p_Volume:'100'}))}}});
 if (url.includes('www.sec.gov/Archives/edgar/data/')) return new Response('<html><p>Quarterly results</p><p>Revenue increased to 100 million.</p><p>Risk: customer concentration remains material.</p></html>',{headers:{'content-type':'text/html'}});
 if (url.includes('company_tickers.json')) return json({0:{ticker:'AAPL',cik_str:320193},1:{ticker:'MSFT',cik_str:789019}});
 if (url.includes('data.sec.gov/submissions/CIK')) return json({filings:{recent:{accessionNumber:['0000320193-26-000001'],form:['10-Q'],filingDate:[today],primaryDocument:['fixture.htm'],primaryDocDescription:['Quarterly results fixture'],acceptanceDateTime:[now.toISOString()]}}});
 if (url.includes('companyfacts')) { const f=(start,end,val)=>({start,end,val,accn:'0000320193-26-000001',filed:'2026-08-01',form:'10-Q'});return json({entityName:'Fixture Company',facts:{'us-gaap':{Revenues:{units:{USD:[f('2026-01-01','2026-03-31',100000000),f('2026-04-01','2026-06-30',120000000)]}},NetIncomeLoss:{units:{USD:[f('2026-01-01','2026-03-31',20000000),f('2026-04-01','2026-06-30',25000000)]}}}}}); }
 if (url.includes('scanner.tradingview.com')) { const body=JSON.parse(init?.body||'{}');if(body.columns?.includes('earnings_release_next_date')) return json({data:[{s:'NASDAQ:AAPL',d:[Date.parse(next)/1000,null,2]}]});if(body.range) return json({data:['AAPL','MSFT','SPY'].map(s=>({s:`NASDAQ:${s}`,d:[s,110,1,1e9,'Technology',10000,'NASDAQ']}))});return json({data:[]}); }
 if (url.includes('ff_calendar_')) return json([{title:'Fixture CPI',country:'USD',date:next+'T12:30:00Z',impact:'High',forecast:'2.0%',previous:'2.1%'}]);
 if (url.includes('feeds.finance.yahoo.com') || url.includes('news.google.com/rss')) return new Response(`<rss><channel><item><title>Fixture company outlook</title><link>https://example.com/fixture-news</link><pubDate>${now.toUTCString()}</pubDate></item></channel></rss>`);
 if(url.includes('data-api.ecb.europa.eu/service/data/EXR/')) {const currency=(url.match(/D\.([A-Z]+)\.EUR/)||[])[1];const values={USD:1.2,GBP:.8,CHF:.95,JPY:160,CAD:1.5,AUD:1.7,CNY:7.8,HKD:8.5};return new Response(`TIME_PERIOD,OBS_VALUE\n2026-01-01,${values[currency]||1}\n${today},${values[currency]||1}\n`);}
 if(url.startsWith('http://127.0.0.1')||url.startsWith('http://localhost')) return realFetch(input,init);
 throw new Error('Unmocked smoke provider: '+url);
};

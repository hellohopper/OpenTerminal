import type {Trade} from './portfolio.js';
export const TRADE_FIELDS=['symbol','side','quantity','price','executed_at'] as const;
export type Mapping=Partial<Record<typeof TRADE_FIELDS[number],string>>;
export function parseCsv(input:string):string[][]{
 if(Buffer.byteLength(input,'utf8')>524288)throw new Error('CSV limit is 512 KB.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const text=input.replace(/^\uFEFF/,'');
 const endCell=()=>{row.push(cell);cell='';closed=false;};const endRow=()=>{endCell();if(row.some(v=>v.trim()))rows.push(row);row=[];if(rows.length>5001)throw new Error('Import at most 5000 rows.');};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(closed&&c!==','&&c!=='\r'&&c!=='\n')throw new Error('Unexpected content after a closing quote.');
  if(c==='"'){if(cell)throw new Error('Quote inside an unquoted field.');quoted=true;}
  else if(c===',')endCell();else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();}else cell+=c;
 }
 if(quoted)throw new Error('Unclosed quoted field.');
 if(cell||row.length||closed)endRow();
 if(!rows.length)throw new Error('CSV is empty.');return rows;
}
export const tradeFingerprint=(t:Trade)=>JSON.stringify(TRADE_FIELDS.map(k=>t[k]));
export function previewCsv(csv:string,existing:Trade[],supplied:Mapping={},skipDuplicates=true){
 const [headers,...data]=parseCsv(csv);
 if(headers.length>50||new Set(headers).size!==headers.length||headers.some(h=>!h.trim()||h.length>120))throw new Error('Use unique, nonempty column headers (up to 50).');
 const aliases:Record<string,string[]>={symbol:['symbol','ticker'],side:['side','action'],quantity:['quantity','qty','shares'],price:['price'],executed_at:['executedat','date','tradedate']};
 const mapping:Mapping={};for(const field of TRADE_FIELDS)mapping[field]=supplied[field]??headers.find(h=>aliases[field].includes(h.toLowerCase().replace(/[ _-]/g,'')));
 const missing=TRADE_FIELDS.filter(f=>!mapping[f]||!headers.includes(mapping[f]!));
 const errors:Array<{row:number;error:string}>=missing.map(f=>({row:1,error:`Map the ${f} column.`}));
 const rows:Trade[]=[],seen=new Set(existing.map(tradeFingerprint));let duplicates=0;
 if(!missing.length)for(const [i,values] of data.entries()){
  const get=(f:typeof TRADE_FIELDS[number])=>(values[headers.indexOf(mapping[f]!)]??'').trim();
  const date=get('executed_at');let timestamp=Date.parse(date);const day=new Date(date.slice(0,10)+'T00:00:00Z');const validDay=Number.isFinite(day.getTime())&&day.toISOString().slice(0,10)===date.slice(0,10);
  const trade:Trade={symbol:get('symbol').toUpperCase(),side:get('side').toUpperCase() as Trade['side'],quantity:get('quantity')?Number(get('quantity')):NaN,price:get('price')?Number(get('price')):NaN,executed_at:Number.isFinite(timestamp)?new Date(timestamp).toISOString():''};
  let error='';
  if(values.length!==headers.length)error='Column count differs from header.';
  else if(!/^(?=.*[A-Z0-9])[A-Z0-9.^=&-]{1,20}$/.test(trade.symbol)||!['BUY','SELL'].includes(trade.side))error='Invalid symbol or side (BUY/SELL).';
  else if(!Number.isFinite(trade.quantity)||trade.quantity<=0||!Number.isFinite(trade.price)||trade.price<0)error='Quantity must be positive and price nonnegative.';
  else if(!(/^\d{4}-\d{2}-\d{2}$/.test(date)||/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(date))||!validDay||!Number.isFinite(timestamp)||timestamp>Date.now()||(/^\d{4}-\d{2}-\d{2}$/.test(date)&&trade.executed_at.slice(0,10)!==date))error='Use a valid past UTC date or timestamp with timezone.';
  if(error){errors.push({row:i+2,error});continue;}
  const fingerprint=tradeFingerprint(trade);if(seen.has(fingerprint)){duplicates++;if(skipDuplicates)continue;}seen.add(fingerprint);rows.push(trade);
 }
 return {headers,mapping,rows,duplicates,errors,total:data.length};
}
export function exportTrades(rows:Trade[]){
 const escape=(value:unknown)=>{let s=String(value??'');if(/^[=+@\-\t\r]/.test(s)&&typeof value==='string')s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
 return [TRADE_FIELDS.join(','),...rows.map(t=>TRADE_FIELDS.map(k=>escape(t[k])).join(','))].join('\r\n');
}

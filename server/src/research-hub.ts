import {db} from './db.js';
import {records} from './records.js';
export type ResearchEntry={kind:string;id:number;symbol:string;title:string;updatedAt:string;body:string;details:unknown;paragraphs?:{id:string;text:string}[];truncated?:boolean};
export const researchKinds=['thesis-rule','journal','thesis','thesis-history','valuation-scenario','filing','filing-document','filing-annotation','earnings-review','paper-order'] as const;
export function researchEntry(kind:string,row:any,documents:any[]=[]):ResearchEntry|null{
 const p=row.payload??row,doc=kind==='filing-annotation'?documents.find(d=>d.id===p.documentId)?.payload:null;
 const symbol=p.symbol??p.input?.symbol??p.filing?.symbol??p.card?.symbol??doc?.filing?.symbol;if(typeof symbol!=='string')return null;
 const title=p.title??p.name??p.card?.title??p.thesis?.card?.title??(p.filing?`${p.filing.form} · ${p.filing.filedAt}`:p.form?`${p.form} · ${p.filedAt}`:kind==='filing-annotation'?`Annotation ${p.paragraphId}`:`${p.side??''} ${p.type??kind} ${p.quantity??''}`);
 const {paragraphs,...details}=p;return {kind,id:row.id,symbol,title:String(title),updatedAt:row.updated_at??p.createdAt??'',body:kind==='journal'?p.body:JSON.stringify(p),details,paragraphs:kind==='filing-document'?paragraphs:undefined,truncated:p.truncated};
}
export async function researchEntries(symbol?:string){const documents=await records<any>('filing-document'),entries:ResearchEntry[]=[];for(const kind of researchKinds){if(kind==='journal')continue;for(const row of kind==='filing-document'?documents:await records(kind)){const entry=researchEntry(kind,row,documents);if(entry&&(!symbol||entry.symbol===symbol))entries.push(entry);}}
 const journals=await db.prepare(`SELECT id,symbol,title,body,kind,updated_at FROM journal_entries ${symbol?'WHERE symbol=?':''} ORDER BY id DESC LIMIT 5001`).all(...(symbol?[symbol]:[]));for(const row of journals.slice(0,5000))entries.push(researchEntry('journal',row)!);return {entries:entries.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.id-a.id),coverage:journals.length>5000?'Latest 5000 journal entries are included; narrow by symbol to inspect older company records.':'All retained research records in this scope.'};}

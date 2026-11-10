import { createHash } from "node:crypto";
import { db } from "./db.js";
import { records, addRecord, removeRecord, type RecordRow } from "./records.js";
import { researchEntries } from "./research-hub.js";

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type SnapshotEntry = { key: string; kind: string; id: number; title: string; updatedAt: string; fingerprint: string; summary: string };
export type ResearchSnapshot = { symbol: string; capturedAt: string; entries: SnapshotEntry[]; coverage: string };
export function compareResearch(current: SnapshotEntry[], previous: SnapshotEntry[] | undefined) {
  const before = new Map(previous?.map(e => [e.key, e]) ?? []), after = new Set(current.map(e => e.key));
  return { baseline: !previous, changes: current.flatMap<{type:"added"|"changed";current:SnapshotEntry;previous:SnapshotEntry|null}>(e => {
    const old = before.get(e.key);
    return !old ? [{ type: "added" as const, current: e, previous: null as SnapshotEntry | null }]
      : old.fingerprint !== e.fingerprint ? [{ type: "changed" as const, current: e, previous: old }] : [];
  }), removed: previous?.filter(e => !after.has(e.key)) ?? [] };
}
function compactDetails(kind: string, details: any) {
  // Polling timestamps are not research changes. Monitor comparisons track evidence/status only.
  if (kind === "thesis-rule") return { name: details.name, conditions: details.conditions, thesisVersion: details.thesisVersion,
    status: details.lastResult?.status, evidence: details.lastResult?.evidence?.map((e: any) => ({metric:e.metric,value:e.value,satisfied:e.satisfied,asOf:e.asOf})) };
  return details;
}
export async function researchSnapshot(symbol: string): Promise<ResearchSnapshot> {
  const source = await researchEntries(symbol);
  const entries = source.entries.filter(e => ["journal", "thesis", "valuation-scenario", "filing", "thesis-rule", "earnings-review"].includes(e.kind)).map(e => {
    const detail = compactDetails(e.kind, e.details);
    const summary = e.kind === "journal" ? e.body : JSON.stringify(detail);
    return { key: `${e.kind}:${e.id}`, kind:e.kind,id:e.id,title:e.title,updatedAt:e.updatedAt,fingerprint:digest(detail),summary:summary.slice(0,4000) };
  }).sort((a,b)=>a.key.localeCompare(b.key));
  return { symbol, capturedAt:new Date().toISOString(), entries, coverage:source.coverage };
}
export const snapshotToken = (snapshot: ResearchSnapshot) => digest([snapshot.symbol,snapshot.entries]);
export async function changesFor(symbol: string) {
  const current = await researchSnapshot(symbol), history = await records<ResearchSnapshot>(`research-baseline:${symbol}`), previous = history[0];
  return { ...compareResearch(current.entries,previous?.payload.entries), current, token:snapshotToken(current), version:previous?.id??0,
    history:history.map(r=>({id:r.id,capturedAt:r.payload.capturedAt,count:r.payload.entries.length})) };
}
export async function acknowledgeResearch(symbol:string, token:string, version:number) {
  return db.transaction(async()=>{
    const current = await changesFor(symbol);
    if(current.token!==token || current.version!==version) throw new Error("Research changed. Refresh and review before marking it read.");
    const count=await db.prepare("SELECT COUNT(DISTINCT kind) AS n FROM research_records WHERE kind LIKE 'research-baseline:%'").get();
    if(!version && count!.n>=100) throw new Error("Up to 100 researched symbols can retain read snapshots.");
    const id=await addRecord(`research-baseline:${symbol}`,current.current);
    for(const old of (await records(`research-baseline:${symbol}`)).slice(10)) await removeRecord(`research-baseline:${symbol}`,old.id);
    return {id};
  })();
}
export type ChartEvent = { key:string;kind:string;id:number;symbol:string;title:string;at:string;dateOnly:boolean;body:string;target?:{kind:string;id:number} };
export function eventDate(value:unknown):string|null {
  if(typeof value!=="string") return null;
  const date=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value)?`${value}T00:00:00Z`:value.includes("T")?value:`${value.replace(" ","T")}Z`);
  return Number.isFinite(date)?new Date(date).toISOString():null;
}
export async function chartEvents(symbol:string) {
  const events:ChartEvent[]=[];
  const push=(kind:string,id:number,title:string,at:unknown,body:string,target?:ChartEvent["target"],dateOnly=false)=>{
    const parsed=eventDate(at); if(parsed) events.push({key:`${kind}:${id}`,kind,id,symbol,title,at:parsed,dateOnly,body,target});
  };
  const journals=await db.prepare("SELECT id,title,body,created_at FROM journal_entries WHERE symbol=? ORDER BY id DESC LIMIT 1001").all(symbol);
  for(const j of journals.slice(0,1000))push("journal",j.id,j.title,j.created_at,j.body.slice(0,2000),{kind:"journal",id:j.id});
  const trades=await db.prepare("SELECT t.*,p.name AS account FROM transactions t JOIN portfolios p ON p.id=t.portfolio_id WHERE t.symbol=? ORDER BY t.executed_at DESC,t.id DESC LIMIT 1001").all(symbol);
  for(const t of trades.slice(0,1000))push("trade",t.id,`${t.side} ${t.quantity} @ ${t.price}`,t.executed_at,`${t.account} · recorded execution`);
  for(const r of await records<any>("thesis-history"))if(r.payload.card.symbol===symbol)push("thesis",r.id,`Thesis revised: ${r.payload.card.title}`,r.updated_at,r.payload.card.rationale,{kind:"thesis-history",id:r.id});
  for(const r of await records<any>("filing"))if(r.payload.symbol===symbol)push("filing",r.id,`${r.payload.form} filed`,r.payload.filedAt,r.payload.description??"",{kind:"filing",id:r.id},true);
  for(const r of await records<any>("earnings-review"))if(r.payload.symbol===symbol)push("earnings",r.id,"Earnings review saved",r.updated_at,JSON.stringify(r.payload).slice(0,2000),{kind:"earnings-review",id:r.id});
  return {events:events.sort((a,b)=>a.at.localeCompare(b.at)||a.key.localeCompare(b.key)),coverage:`Latest 1000 notes and 1000 trades; retained thesis revisions, filings and earnings reviews. ${journals.length>1000||trades.length>1000?"Older events omitted.":""} Note markers use creation dates but show current saved text, which may include later edits. Filing dates are disclosure dates, not fiscal period ends. Earnings markers mark saved reviews, not inferred release times.`};
}

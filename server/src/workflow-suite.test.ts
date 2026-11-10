import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("./routes/market.js",()=>({getQuotes:vi.fn(async()=>[])}));
vi.mock("./daily-history.js",async importOriginal=>({...await importOriginal<any>(),dailyHistory:vi.fn(async()=>[])}));
vi.mock("./providers/tradingview.js",()=>({earningsCalendar:vi.fn(async()=>[])}));
import { db } from "./db.js";
import { records,addRecord,updateRecord,removeRecord } from "./records.js";
import { changesFor,acknowledgeResearch,chartEvents,eventDate } from "./workflow-research.js";
import { captureInbox,convertInbox,inboxSchema } from "./research-inbox.js";
import { forecastStats,type Forecast } from "./forecasts.js";
import { forecastsRouter } from "./routes/forecasts.js";
import { compoundSchema,evaluateCompound,advanceCompound,createCompoundMonitor,compoundEvidence,type CompoundRule,type CompoundState } from "./compound-alerts.js";
import { calculateWeek,weekBounds,lastCompleteWeek,createWeeklyScheduler,generateWeekly } from "./weekly-reports.js";
import { dailyHistory } from "./daily-history.js";
import { getQuotes } from "./routes/market.js";
import { placeChartEvents,type ChartEvent } from "../../web/lib/chart-events.js";
import { createBackup,restoreBackup } from "./storage/backup.js";
afterAll(()=>db.close());
beforeEach(async()=>{vi.clearAllMocks();await db.prepare("DELETE FROM research_records").run();await db.prepare("DELETE FROM journal_entries").run();await db.prepare("DELETE FROM transactions").run();await db.prepare("DELETE FROM portfolio_events").run();});
const journal=async(symbol="AAPL",body="Original evidence")=>Number((await db.prepare("INSERT INTO journal_entries (symbol,title,body,kind,version) VALUES (?,?,?,?,?)").run(symbol,"Thesis evidence",body,"research",randomUUID())).lastInsertRowid);
async function route(router:any,method:string,path:string,body?:unknown,id="1"){
 const response={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis(),end:vi.fn()},next=vi.fn();
 await router.stack.find((l:any)=>l.route?.path===path&&l.route.methods[method]).route.stack[0].handle({params:{id},query:{},body},response,next);
 expect(next).not.toHaveBeenCalled();return response;
}
describe("reviewed research baselines",()=>{
 it("does not mark read on GET, isolates symbols and rejects an unreviewed concurrent change",async()=>{
  const id=await journal();await journal("MSFT");const shown=await changesFor("AAPL");expect(shown.changes).toHaveLength(1);expect(await records("research-baseline:AAPL")).toHaveLength(0);
  await db.prepare("UPDATE journal_entries SET body=? WHERE id=?").run("New evidence",id);
  await expect(acknowledgeResearch("AAPL",shown.token,shown.version)).rejects.toThrow("Research changed");
  const next=await changesFor("AAPL");await acknowledgeResearch("AAPL",next.token,next.version);expect((await changesFor("AAPL")).changes).toHaveLength(0);expect((await changesFor("MSFT")).baseline).toBe(true);
  await expect(acknowledgeResearch("AAPL",next.token,next.version)).rejects.toThrow("Research changed");
 });
 it("retains before/after values, reports removal and bounds snapshot history",async()=>{
  const id=await journal();const first=await changesFor("AAPL");await acknowledgeResearch("AAPL",first.token,first.version);
  await db.prepare("UPDATE journal_entries SET body=? WHERE id=?").run("Revised evidence",id);
  const changes=await changesFor("AAPL");expect(changes.changes[0]).toMatchObject({type:"changed",previous:{summary:"Original evidence"},current:{summary:"Revised evidence"}});
  await db.prepare("DELETE FROM journal_entries WHERE id=?").run(id);expect((await changesFor("AAPL")).removed).toHaveLength(1);
  for(let i=0;i<12;i++){const c=await changesFor("AAPL");await acknowledgeResearch("AAPL",c.token,c.version);}expect(await records("research-baseline:AAPL")).toHaveLength(10);
 });
 it("does not treat monitor polling timestamps as an evidence change",async()=>{
  const id=await addRecord("thesis-rule",{symbol:"AAPL",name:"Monitor",lastResult:{status:"met",checkedAt:"2026-01-01",evidence:[]}}),shown=await changesFor("AAPL");await acknowledgeResearch("AAPL",shown.token,shown.version);
  await updateRecord("thesis-rule",id,1,{symbol:"AAPL",name:"Monitor",lastResult:{status:"met",checkedAt:"2026-01-02",evidence:[]}});expect((await changesFor("AAPL")).changes).toHaveLength(0);
 });
});
describe("chart event chronology",()=>{
 it("uses filing disclosure dates, original note creation and recorded trade executions",async()=>{
  const id=await journal();await db.prepare("UPDATE journal_entries SET created_at=?,updated_at=? WHERE id=?").run("2026-01-02 12:00:00","2026-03-04 12:00:00",id);
  await addRecord("filing",{symbol:"AAPL",form:"10-K",filedAt:"2026-02-01",period:"2025-12-31"});
  const result=await chartEvents("AAPL");expect(result.events.find(e=>e.kind==="journal")?.at).toBe("2026-01-02T12:00:00.000Z");expect(result.events.find(e=>e.kind==="filing")).toMatchObject({at:"2026-02-01T00:00:00.000Z",dateOnly:true});expect((await chartEvents("MSFT")).events).toHaveLength(0);
 });
 it("never moves weekend or intraday evidence into an earlier bar",()=>{
  const event:ChartEvent={key:"filing:1",kind:"filing",id:1,symbol:"AAPL",title:"Filed",at:"2026-10-24T00:00:00Z",body:"",dateOnly:true};
  const times=["2026-10-23","2026-10-26"].map(s=>Date.parse(s)/1000);
  expect(placeChartEvents([event],times,false)[0].time).toBe(times[1]);expect(placeChartEvents([event],times,true)).toEqual([]);
  expect(placeChartEvents([{...event,at:"2026-10-22T00:00:00Z"}],times,false)).toEqual([]);
  expect(eventDate("not a date")).toBeNull();
 });
});
describe("research capture durability",()=>{
 const capture=()=>inboxSchema.parse({clientId:randomUUID(),title:"Collected link",text:"Original thought",url:"https://example.com/source"});
 it("deduplicates concurrent retries and rejects reuse with different content",async()=>{
  const input=capture(),results=await Promise.all([captureInbox(input),captureInbox(input)]);expect(results[0].id).toBe(results[1].id);expect(await records("research-inbox")).toHaveLength(1);
  await expect(captureInbox({...input,text:"different"})).rejects.toThrow("different content");
 });
 it("does not resurrect a deleted item when its acknowledgement was lost",async()=>{
  const input=capture(),result=await captureInbox(input);await removeRecord("research-inbox",result.id);expect(await captureInbox(input)).toMatchObject({id:result.id,duplicate:true});expect(await records("research-inbox")).toHaveLength(0);
 });
 it("converts once atomically, preserves the source, and rejects stale edits",async()=>{
  const input=capture(),{id}=await captureInbox(input),saved=await convertInbox(id,1,"AAPL","Reviewed","Evidence");
  expect(await db.prepare("SELECT body,symbol FROM journal_entries WHERE id=?").get(saved.id)).toMatchObject({body:"Evidence\n\nSource: https://example.com/source",symbol:"AAPL"});
  await expect(convertInbox(id,1,"MSFT","Other","Evidence")).rejects.toThrow("changed");expect((await db.prepare("SELECT COUNT(*) AS n FROM journal_entries").get())!.n).toBe(1);
 });
 it("rejects unsafe URLs and invalid image bytes",()=>{
  expect(inboxSchema.safeParse({...capture(),url:"javascript:alert(1)"}).success).toBe(false);
  expect(inboxSchema.safeParse({...capture(),url:"invalid"}).success).toBe(false);
  expect(inboxSchema.safeParse({...capture(),image:"data:image/png;base64,aGVsbG8="}).success).toBe(false);
 });
 it("backs up pending captures and preserves retry receipts after restore",async()=>{
  const input=capture(),created=await captureInbox(input),backup=await createBackup(db);await restoreBackup(db,backup);
  expect(await captureInbox(input)).toMatchObject({id:created.id,duplicate:true});await expect(convertInbox(created.id,1,"AAPL","Title","Body")).rejects.toThrow("changed");
 });
});
const forecast:Forecast={symbol:"AAPL",question:"Revenue reaches target",metric:"Revenue growth",unit:"%",operator:"gte",threshold:10,probability:.8,deadline:"2026-01-02T00:00:00.000Z",rationale:"Evidence",createdAt:"2026-01-01T00:00:00.000Z"};
describe("forecast accountability",()=>{
 it("calculates calibration and Brier scores without hiding unresolved judgments",()=>{
  const stats=forecastStats([{...forecast,resolution:{value:12,evidence:"10-Q",url:"",resolvedAt:"2026-01-03"}},{...forecast,probability:.2,resolution:{value:2,evidence:"10-Q",url:"",resolvedAt:"2026-01-03"}},forecast,{...forecast,resolution:{value:null,reason:"no comparable disclosure",evidence:"missing",url:"",resolvedAt:"2026-01-03"}}],new Date("2026-02-01"));
  expect(stats).toMatchObject({total:4,resolved:2,pending:1,overdue:1,unresolvable:1});expect(stats.brier).toBeCloseTo(.04);expect(stats.calibration[4]).toMatchObject({count:1,actual:1});
 });
 it("rejects retroactive predictions and resolution before the deadline",async()=>{
  const past=await route(forecastsRouter,"post","/",forecast);expect(past.status).toHaveBeenCalledWith(400);
  const id=await addRecord("forecast",{...forecast,deadline:"2099-01-01T00:00:00.000Z"});const early=await route(forecastsRouter,"post","/:id/resolve",{version:1,value:12,evidence:"Future result",url:""},String(id));expect(early.status).toHaveBeenCalledWith(409);
 });
 it("resolves once with the reviewed revision and keeps the original probability",async()=>{
  const id=await addRecord("forecast",forecast),input={version:1,value:8,evidence:"Published statement",url:"https://example.com/filing"};
  const stale=await route(forecastsRouter,"post","/:id/resolve",{...input,version:2},String(id));expect(stale.status).toHaveBeenCalledWith(409);
  const saved=await route(forecastsRouter,"post","/:id/resolve",input,String(id));expect(saved.json).toHaveBeenCalledWith({ok:true});
  const repeat=await route(forecastsRouter,"post","/:id/resolve",{...input,version:2},String(id));expect(repeat.status).toHaveBeenCalledWith(409);expect((await records<Forecast>("forecast"))[0].payload.probability).toBe(.8);
 });
});
const rule:CompoundRule={name:"Breakout and position",symbol:"AAPL",portfolioId:1,enabled:true,mode:"all",trigger:"crossing",sustainMinutes:2,cooldownMinutes:1,conditions:[{metric:"price",operator:"gte",threshold:100},{metric:"heldQuantity",operator:"gte",threshold:1}]};
const evidence=(price:number|null,held=2)=>({price:{value:price,source:"fixture",asOf:"2026-10-01T00:00:00Z",valid:price!==null},heldQuantity:{value:held,source:"ledger",asOf:"2026-10-01T00:00:00Z",valid:true}});
describe("compound alerts",()=>{
 it("uses three-valued ALL/ANY logic and requires account scope",()=>{
  expect(evaluateCompound(rule,evidence(null)).status).toBe("unknown");expect(evaluateCompound(rule,evidence(null,0)).status).toBe("unmet");expect(evaluateCompound({...rule,mode:"any"},evidence(null)).status).toBe("met");expect(compoundSchema.safeParse({...rule,portfolioId:undefined}).success).toBe(false);
 });
 it("fires once per satisfied episode, ignores unknown gaps and rearms only on unmet",()=>{
  let time=new Date("2026-10-01"),state:CompoundState={};const step=(price:number|null)=>{const next=advanceCompound(rule,state,evaluateCompound(rule,evidence(price),time),time);state=next.state;time=new Date(+time+61000);return next.notify;};
  expect(step(110)).toBe(true);expect(step(110)).toBe(false);expect(step(null)).toBe(false);expect(step(110)).toBe(false);expect(step(90)).toBe(false);expect(step(110)).toBe(true);
 });
 it("requires continuous valid sustained observations and a new close for daily alerts",()=>{
  const sustained={...rule,trigger:"sustained" as const};let state:CompoundState={};const step=(at:string,p:number|null)=>{const now=new Date(at),next=advanceCompound(sustained,state,evaluateCompound(sustained,evidence(p),now),now);state=next.state;return next.notify;};
  expect(step("2026-10-01T00:00:00Z",110)).toBe(false);expect(step("2026-10-01T00:01:00Z",null)).toBe(false);expect(step("2026-10-01T00:02:00Z",110)).toBe(false);expect(step("2026-10-01T00:04:00Z",110)).toBe(true);
  const close={...rule,trigger:"close" as const},now=new Date("2026-10-02"),result=evaluateCompound(close,evidence(110),now),first=advanceCompound(close,{},result,now);
  expect(first.notify).toBe(true);expect(advanceCompound(close,first.state,result,new Date(+now+86400000)).notify).toBe(false);
 });
 it("discards in-flight results after a rule is paused or edited",async()=>{
  const id=await addRecord("compound-rule",rule),monitor=createCompoundMonitor(async()=>{await updateRecord("compound-rule",id,1,{...rule,enabled:false});return evidence(110);},()=>new Date("2026-10-02"));
  await monitor.check();expect(await records("notification")).toHaveLength(0);expect(await records(`compound-observation:${id}`)).toHaveLength(0);await monitor.stop();
 });
 it("deduplicates simultaneous checks and saves notification evidence",async()=>{
  await addRecord("compound-rule",rule);const load=vi.fn(async()=>evidence(110)),monitor=createCompoundMonitor(load,()=>new Date("2026-10-02"));await Promise.all([monitor.check(),monitor.check()]);expect(load).toHaveBeenCalledTimes(1);expect(await records("notification")).toHaveLength(1);await monitor.stop();
 });
 it("does not use stale quote retrievals or stale completed bars",async()=>{
  vi.mocked(getQuotes).mockResolvedValueOnce([{symbol:"AAPL",price:110,retrievedAt:"2000-01-01",stale:false}] as any);
  expect((await compoundEvidence({...rule,conditions:[rule.conditions[0]]})).price.valid).toBe(false);
  vi.mocked(dailyHistory).mockResolvedValueOnce(Array.from({length:21},(_,i)=>({time:Date.parse(`2000-01-${String(i+1).padStart(2,"0")}`)/1000,open:100,high:110,low:90,close:101,volume:1000})));
  expect((await compoundEvidence({...rule,trigger:"close"})).breakout20.valid).toBe(false);
 });
});
const funding={kind:"DEPOSIT" as const,amount:1000,symbol:null,executed_at:"2026-10-01T00:00:00.000Z"};
const buy={symbol:"AAPL",side:"BUY" as const,quantity:5,price:100,executed_at:"2026-10-01T01:00:00.000Z"};
const week={portfolioId:1,week:"2026-10-19",priceBasis:"raw" as const};
const history={AAPL:[{time:Date.parse("2026-10-16")/1000,close:110},{time:Date.parse("2026-10-23")/1000,close:120}]};
describe("weekly portfolio review",()=>{
 it("reconciles contribution to NAV change excluding funding across buys, sells and dividends",()=>{
  const trades=[buy,{...buy,quantity:2,price:112,executed_at:"2026-10-20T00:00:00.000Z"},{...buy,side:"SELL" as const,quantity:1,price:118,executed_at:"2026-10-22T00:00:00.000Z"}];
  const report=calculateWeek(trades,[funding,{...funding,amount:500,executed_at:"2026-10-21T00:00:00.000Z"},{kind:"DIVIDEND",amount:5,symbol:"AAPL",executed_at:"2026-10-23T00:00:00.000Z"}],history,week,new Date("2026-11-01"));
  expect(report.openingNav).toBe(1050);expect(report.closingNav).toBe(1619);expect(report.externalFlows).toBe(500);expect(report.pnl).toBe(69);expect(report.rows[0].contribution).toBe(69);
 });
 it("handles a completely closed position without requiring an ending quote",()=>{
  const report=calculateWeek([buy,{...buy,side:"SELL",price:120,executed_at:"2026-10-23T00:00:00.000Z"}],[funding],{AAPL:[history.AAPL[0]]},week,new Date("2026-11-01"));expect(report.pnl).toBe(50);expect(report.rows[0].endValue).toBe(0);
 });
 it("withholds incomplete and unverified split results; applies declared split basis only once",()=>{
  const split={kind:"SPLIT" as const,amount:2,symbol:"AAPL",executed_at:"2026-10-21T00:00:00.000Z"},adjusted={AAPL:[{...history.AAPL[0],close:55},{...history.AAPL[1],close:60}]};
  expect(calculateWeek([buy],[funding],{},week).pnl).toBeNull();
  const unknown=calculateWeek([buy],[funding,split],adjusted,{...week,priceBasis:"unverified"});expect(unknown.pnl).toBeNull();expect(unknown.rows[0].contribution).toBeNull();
  expect(calculateWeek([buy],[funding,split],adjusted,{...week,priceBasis:"split-adjusted"}).pnl).toBe(50);
 });
 it("withholds totals when late funding hides an earlier negative cash balance",()=>{
  const report=calculateWeek([buy],[{...funding,executed_at:"2026-10-02T00:00:00.000Z"}],history,week);
  expect(report.pnl).toBeNull();expect(report.warnings.join(" ")).toContain("complete funding");
 });
 it("atomically saves a scheduled report and rejects a stale schedule without a second report",async()=>{
  const id=await addRecord("weekly-schedule",{portfolioId:1,enabled:true,priceBasis:"raw"});
  const row=(await records("weekly-schedule")).find(r=>r.id===id)!;
  const report=await generateWeekly(week,{id,version:row.version});
  expect((await records<any>("weekly-schedule"))[0].payload).toMatchObject({lastWeek:week.week,reportId:report.id});
  await expect(generateWeekly(week,{id,version:row.version})).rejects.toThrow("schedule changed");
  expect(await records("weekly-report")).toHaveLength(1);
 });
 it("uses completed Monday-to-Sunday windows even around DST boundaries",()=>{
  expect(lastCompleteWeek(new Date("2026-11-02T00:00:00Z"))).toBe("2026-10-26");expect(()=>weekBounds("2026-10-20")).toThrow("Monday");expect(()=>weekBounds("2099-01-05")).toThrow();expect(weekBounds("2026-10-26",new Date("2026-11-02")).until).toBe("2026-11-02T00:00:00.000Z");
 });
 it("retries a failed weekly run at most hourly and records one successful week",async()=>{
  await addRecord("weekly-schedule",{portfolioId:1,enabled:true,priceBasis:"raw"});let time=Date.parse("2026-11-02T02:00:00Z");const generate=vi.fn().mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValue({id:123});const scheduler=createWeeklyScheduler(generate,()=>new Date(time));
  await scheduler.check();await scheduler.check();expect(generate).toHaveBeenCalledTimes(1);time+=3600001;await scheduler.check();time+=3600001;await scheduler.check();expect(generate).toHaveBeenCalledTimes(2);expect((await records<any>("weekly-schedule"))[0].payload).toMatchObject({lastWeek:"2026-10-26",reportId:123});await scheduler.stop();
 });
});

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./db.js";
import { addRecord, records, updateRecord, removeRecord } from "./records.js";
import { journalSchema } from "./routes/journal.js";
import { symbolSchema } from "./validation.js";
import { digest } from "./workflow-research.js";
export const inboxSchema=z.object({clientId:z.string().uuid(),title:z.string().trim().min(1).max(120),text:z.string().max(17000),url:z.string().max(2000).refine(v=>{try{return !v||/^https?:$/.test(new URL(v).protocol);}catch{return false;}},"Use an HTTP(S) link.").or(z.literal("")),symbol:symbolSchema.optional(),image:journalSchema.shape.image});
export type InboxItem=z.infer<typeof inboxSchema>&{status:"pending"|"archived"|"converted";journalId?:number;receivedAt:string;inputHash:string};
export async function captureInbox(input:z.infer<typeof inboxSchema>){return db.transaction(async()=>{
 const hash=digest(input),existing=(await records<InboxItem>("research-inbox")).find(r=>r.payload.clientId===input.clientId);
 if(existing){if(existing.payload.inputHash!==hash)throw new Error("This capture ID already belongs to different content.");return {id:existing.id,duplicate:true};}
 const receipt=(await records<{clientId:string;inputHash:string;id:number}>("inbox-receipt")).find(r=>r.payload.clientId===input.clientId);
 if(receipt){if(receipt.payload.inputHash!==hash)throw new Error("This capture ID already belongs to different content.");return {id:receipt.payload.id,duplicate:true};}
 if((await records("research-inbox")).length>=200)throw new Error("Inbox limit is 200 items. Remove finished items before collecting more.");
 const id=await addRecord("research-inbox",{...input,status:"pending",receivedAt:new Date().toISOString(),inputHash:hash},input.clientId);
 await addRecord("inbox-receipt",{clientId:input.clientId,inputHash:hash,id},input.clientId);
 for(const old of (await records("inbox-receipt")).slice(400))await removeRecord("inbox-receipt",old.id);
 return {id,duplicate:false};
})();}
export async function convertInbox(id:number,version:number,symbol:string,title:string,text:string){return db.transaction(async()=>{
 const row=(await records<InboxItem>("research-inbox")).find(r=>r.id===id);
 if(!row||row.version!==version)throw new Error("Inbox item changed. Reload before converting.");
 if(row.payload.status==="converted")return {id:row.payload.journalId};
 const body=[text,row.payload.url?`Source: ${row.payload.url}`:""].filter(Boolean).join("\n\n");
 const parsed=journalSchema.parse({symbol,title,body,kind:"research",image:row.payload.image});
 const result=await db.prepare("INSERT INTO journal_entries (symbol,title,body,kind,image,version) VALUES (?,?,?,?,?,?)").run(parsed.symbol,parsed.title,parsed.body,parsed.kind,parsed.image??null,randomUUID());
 const journalId=Number(result.lastInsertRowid);
 await updateRecord("research-inbox",id,version,{...row.payload,symbol,status:"converted",journalId});
 return {id:journalId};
})();}

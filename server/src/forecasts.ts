import { z } from "zod";
import { symbolSchema } from "./validation.js";
export const forecastSchema=z.object({symbol:symbolSchema,question:z.string().trim().min(1).max(200),metric:z.string().trim().min(1).max(100),unit:z.string().trim().max(40),operator:z.enum(["gte","lte"]),threshold:z.number().finite().min(-1e15).max(1e15),probability:z.number().min(0).max(1),deadline:z.string().datetime(),rationale:z.string().max(6000),thesisId:z.number().int().positive().optional()});
export type Forecast=z.infer<typeof forecastSchema>&{createdAt:string;resolution?:{value:number|null;evidence:string;url:string;resolvedAt:string;reason?:string}};
export const resolutionSchema=z.object({version:z.number().int().positive(),value:z.number().finite().min(-1e15).max(1e15).nullable(),evidence:z.string().trim().min(1).max(6000),url:z.string().max(2000).refine(v=>{try{return !v||/^https?:$/.test(new URL(v).protocol);}catch{return false;}},"Use an HTTP(S) evidence link."),reason:z.string().max(1000).optional()}).refine(v=>v.value!==null||!!v.reason?.trim(),"Explain why this forecast cannot be resolved.");
export function forecastScore(f:Forecast){if(!f.resolution||f.resolution.value===null)return null;const outcome=f.operator==="gte"?f.resolution.value>=f.threshold:f.resolution.value<=f.threshold;return {outcome,brier:(f.probability-Number(outcome))**2};}
export function forecastStats(rows:Forecast[],now=new Date()){
 const scored=rows.flatMap(f=>{const score=forecastScore(f);return score?[{...score,probability:f.probability}]:[];});
 return {total:rows.length,resolved:scored.length,unresolvable:rows.filter(f=>f.resolution?.value===null).length,pending:rows.filter(f=>!f.resolution).length,overdue:rows.filter(f=>!f.resolution&&Date.parse(f.deadline)<=now.getTime()).length,brier:scored.length?scored.reduce((s,f)=>s+f.brier,0)/scored.length:null,
 calibration:Array.from({length:5},(_,i)=>{const group=scored.filter(f=>Math.min(4,Math.floor(f.probability*5))===i);return {from:i*.2,to:(i+1)*.2,count:group.length,predicted:group.length?group.reduce((s,f)=>s+f.probability,0)/group.length:null,actual:group.length?group.filter(f=>f.outcome).length/group.length:null};})};
}

import {z} from 'zod';
import {symbolSchema} from './validation.js';
export const thesisSchema=z.object({symbol:symbolSchema,title:z.string().trim().min(1).max(120),rationale:z.string().max(6000),metrics:z.string().max(3000),catalysts:z.string().max(3000),invalidation:z.string().max(3000),reviewDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v=>!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),status:z.enum(['watching','active','invalidated','archived'])});
export type Thesis=z.infer<typeof thesisSchema>;
export function dueTheses<T extends {payload:Thesis}>(rows:T[],symbols:string[],today=new Date().toISOString().slice(0,10)){return rows.filter(r=>symbols.includes(r.payload.symbol)&&['watching','active'].includes(r.payload.status)&&r.payload.reviewDate<=today);}

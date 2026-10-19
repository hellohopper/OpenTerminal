import type {RecordRow} from './records.js';
export type TodayTask={key:string;kind:string;title:string;detail:string;symbol:string|null;target:string;record?:{kind:string;id:number}};
export type TaskState={key:string;status:'pending'|'done'|'snoozed';until:string|null};
export function applyTaskStates(tasks:TodayTask[],states:RecordRow<TaskState>[],now=new Date()){
 return tasks.map(t=>{const r=states.find(s=>s.payload.key===t.key),p=r?.payload;return {...t,version:r?.version??0,status:p?.status==='done'?'done':p?.status==='snoozed'&&p.until&&Date.parse(p.until)>now.getTime()?'snoozed':'pending',until:p?.until??null};}).sort((a,b)=>a.kind.localeCompare(b.kind)||a.key.localeCompare(b.key));
}

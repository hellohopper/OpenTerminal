export type ChartEvent={key:string;kind:string;id:number;symbol:string;title:string;at:string;dateOnly:boolean;body:string;target?:{kind:string;id:number}};
/** Never position an event before its observed date/time; weekends map to the next supplied bar. */
export function placeChartEvents(events:ChartEvent[],times:number[],intraday:boolean){
 if(!times.length)return [];
 const bars=[...new Set(times)].sort((a,b)=>a-b),keys=bars.map(t=>intraday?t:new Date(t*1000).toISOString().slice(0,10));
 return events.flatMap(event=>{
  const timestamp=Date.parse(event.at)/1000;if(!Number.isFinite(timestamp))return [];
  const key=intraday?timestamp:event.at.slice(0,10);
  if(key<keys[0]||key>keys.at(-1)!)return [];
  // Date-only announcements have no defensible intraday placement.
  if(intraday&&event.dateOnly)return [];
  let lo=0,hi=keys.length;while(lo<hi){const mid=(lo+hi)>>>1;if(keys[mid]<key)lo=mid+1;else hi=mid;}
  return lo<bars.length?[{event,time:bars[lo]}]:[];
 }).sort((a,b)=>a.time-b.time||a.event.key.localeCompare(b.event.key));
}

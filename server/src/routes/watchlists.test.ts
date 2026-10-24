import {it,expect,afterAll,beforeAll,beforeEach,vi}from"vitest";import{mkdtempSync,rmSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";
let directory:string,router:any,db:any;
beforeAll(async()=>{directory=mkdtempSync(join(tmpdir(),"shared-lists-"));process.env.DATA_DIR=directory;db=(await import("../db")).db;router=(await import("./watchlists")).watchlistsRouter;});
afterAll(async()=>{await db.close();rmSync(directory,{recursive:true,force:true});});
beforeEach(async()=>{await db.exec("DELETE FROM research_records WHERE kind IN ('shared-watchlist','shared-watchlist-order')");});
async function call(method:string,path:string,body?:unknown,params={},query={}){const res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};const layer=router.stack.find((l:any)=>l.route?.path===path&&l.route.methods[method]);await layer.route.stack[0].handle({body,params,query},res,(e:unknown)=>{throw e});return res;}
it("shares atomic symbol edits and rejects stale replacements",async()=>{
 const created=await call("post","/",{name:"Shared",symbols:["aapl","AAPL"]}),id=created.json.mock.calls[0][0].id;
 await Promise.all([call("post","/:id/symbols",{symbol:"IBM",action:"add"},{id}),call("post","/:id/symbols",{symbol:"MSFT",action:"add"},{id})]);
 let row=(await call("get","/")).json.mock.calls[0][0][0];expect(row.payload.symbols).toEqual(expect.arrayContaining(["AAPL","IBM","MSFT"]));expect(row.payload.symbols).toHaveLength(3);
 const stale=await call("put","/:id",{name:"Oops",symbols:[],version:1},{id});expect(stale.status).toHaveBeenCalledWith(409);
 await call("post","/:id/symbols",{symbol:"IBM",action:"remove"},{id});row=(await call("get","/")).json.mock.calls[0][0][0];expect(row.payload.symbols).toEqual(["AAPL","MSFT"]);
 const bad=await call("post","/",{name:"Bad",symbols:[".."]});expect(bad.status).toHaveBeenCalledWith(400);
});
it("returns the same initial list to concurrent phones",async()=>{await db.exec("DELETE FROM research_records WHERE kind='shared-watchlist'");const replies=await Promise.all([call("post","/default",{name:"Main",symbols:["AAPL"]}),call("post","/default",{name:"Main",symbols:["IBM"]})]);expect(replies[0].json.mock.calls[0][0].id).toBe(replies[1].json.mock.calls[0][0].id);});
it("rejects additions beyond the symbol limit without changing the saved list",async()=>{
 const symbols=Array.from({length:150},(_,i)=>`S${i}`),created=await call("post","/",{name:"Full",symbols}),id=created.json.mock.calls[0][0].id;
 const result=await call("post","/:id/symbols",{symbol:"EXTRA",action:"add"},{id});expect(result.status).toHaveBeenCalledWith(409);
 const row=(await call("get","/")).json.mock.calls[0][0].find((r:any)=>r.id===id);expect(row.payload.symbols).toEqual(symbols);expect(row.version).toBe(1);
});
const body=(res:any)=>res.json.mock.calls[0][0];
const rows=async()=>body(await call("get","/"));
const create=async(name:string,symbols:string[]=[])=>body(await call("post","/",{name,symbols})).id;
it("renames without losing symbols and rejects stale rename, reorder and delete",async()=>{
 const id=await create("Main",["AAPL","IBM"]);
 await call("post","/:id/symbols",{symbol:"MSFT",action:"add"},{id});
 for(const [method,path,value,query] of [
  ["post","/:id/rename",{name:"Stale",version:1},{}],
  ["post","/:id/reorder-symbols",{symbols:["IBM","AAPL"],version:1},{}],
  ["delete","/:id",undefined,{version:"1"}]
 ] as const){expect((await call(method,path,value,{id},query)).status).toHaveBeenCalledWith(409);}
 expect((await rows())[0].payload).toEqual({name:"Main",symbols:["AAPL","IBM","MSFT"]});
 const renamed=body(await call("post","/:id/rename",{name:"  Renamed  ",version:2},{id}));
 expect(renamed.payload).toEqual({name:"Renamed",symbols:["AAPL","IBM","MSFT"]});
 expect(renamed.version).toBe(3);
 expect((await call("post","/:id/rename",{name:" ",version:3},{id})).status).toHaveBeenCalledWith(400);
});
it("only accepts an exact symbol permutation at the current version",async()=>{
 const id=await create("Ordered",["AAPL","IBM","MSFT"]);
 for(const symbols of [["AAPL","IBM"],["AAPL","IBM","EXTRA"],["AAPL","AAPL","MSFT"]]){
  expect((await call("post","/:id/reorder-symbols",{symbols,version:1},{id})).status).toHaveBeenCalledWith(400);
 }
 const reordered=body(await call("post","/:id/reorder-symbols",{symbols:["MSFT","IBM","AAPL"],version:1},{id}));
 expect(reordered.payload.symbols).toEqual(["MSFT","IBM","AAPL"]);expect(reordered.version).toBe(2);
});
it("persists relative list moves and keeps concurrent creations without lost IDs",async()=>{
 const a=await create("A"),b=await create("B"),c=await create("C");
 expect((await rows()).map((r:any)=>r.id)).toEqual([a,b,c]);
 await call("post","/:id/move",{direction:"up"},{id:c});
 expect((await rows()).map((r:any)=>r.id)).toEqual([a,c,b]);
 await Promise.all([create("D"),call("post","/:id/move",{direction:"down"},{id:a})]);
 expect((await rows()).map((r:any)=>r.payload.name)).toEqual(["C","A","B","D"]);
 expect((await call("post","/:id/move",{direction:"up"},{id:99999})).status).toHaveBeenCalledWith(404);
 expect((await call("post","/:id/move",{direction:"sideways"},{id:a})).status).toHaveBeenCalledWith(400);
});
it("does not resurrect the last deleted list when phones refresh and permits explicit creation",async()=>{
 const id=await create("Disposable");
 expect((await call("delete","/:id",undefined,{id})).status).toHaveBeenCalledWith(400);
 expect((await call("delete","/:id",undefined,{id},{version:"1"})).status).not.toHaveBeenCalled();
 const replies=await Promise.all([call("post","/default",{name:"Default",symbols:["AAPL"]}),call("post","/default",{name:"Default",symbols:["IBM"]})]);
 expect(replies.map(r=>body(r).id)).toEqual([null,null]);expect(await rows()).toEqual([]);
 const next=await create("Explicit",["NVDA"]);expect((await rows()).map((r:any)=>r.id)).toEqual([next]);
 expect((await call("delete","/:id",undefined,{id},{version:"1"})).status).toHaveBeenCalledWith(404);
});
it("retains list order and intentional empty state through a database backup",async()=>{
 const {createBackup,restoreBackup}=await import("../storage/backup");
 const a=await create("A"),b=await create("B");await call("post","/:id/move",{direction:"up"},{id:b});
 const backup=await createBackup(db);await call("post","/:id/move",{direction:"up"},{id:a});await restoreBackup(db,backup);
 expect((await rows()).map((r:any)=>r.id)).toEqual([b,a]);
 for(const row of await rows())await call("delete","/:id",undefined,{id:row.id},{version:String(row.version)});
 const empty=await createBackup(db);await create("Temporary");await restoreBackup(db,empty);
 expect(body(await call("post","/default",{name:"Default",symbols:[]})).id).toBeNull();
});

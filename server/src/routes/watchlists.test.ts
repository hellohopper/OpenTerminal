import {it,expect,afterAll,beforeAll,vi}from"vitest";import{mkdtempSync,rmSync}from"node:fs";import{tmpdir}from"node:os";import{join}from"node:path";
let directory:string,router:any,db:any;
beforeAll(async()=>{directory=mkdtempSync(join(tmpdir(),"shared-lists-"));process.env.DATA_DIR=directory;db=(await import("../db")).db;router=(await import("./watchlists")).watchlistsRouter;});
afterAll(async()=>{await db.close();rmSync(directory,{recursive:true,force:true});});
async function call(method:string,path:string,body?:unknown,params={}){const res={status:vi.fn().mockReturnThis(),json:vi.fn().mockReturnThis()};const layer=router.stack.find((l:any)=>l.route?.path===path&&l.route.methods[method]);await layer.route.stack[0].handle({body,params},res,(e:unknown)=>{throw e});return res;}
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

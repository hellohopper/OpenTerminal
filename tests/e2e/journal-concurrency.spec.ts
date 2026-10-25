import {test,expect,type Page,type Route} from '@playwright/test';
import {signIn,blank} from './helpers';
test.use({serviceWorkers:'block'});

test('searches journal titles and bodies through the authenticated proxy with literal special characters',async({page})=>{
 await signIn(page);
 const note={symbol:'JHTTP',title:'现金流 +20% C++',body:'100% growth_! evidence',kind:'research'};
 const match=await(await page.request.post('/api/journal',{headers,data:note})).json();
 await page.request.post('/api/journal',{headers,data:{...note,title:'现金流 20% C',body:'100X growthZ! evidence'}});
 await page.request.post('/api/journal',{headers,data:{...note,kind:'trade'}});
 const parameters=new URLSearchParams({symbol:'JHTTP',kind:'research',q:'现金流 +20% C++ 100% growth_!'});
 const response=await page.request.get(`/api/journal?${parameters}`);expect(response.status()).toBe(200);
 const found=await response.json();expect(found.entries.map((entry:any)=>entry.id)).toEqual([match.id]);expect(found.nextCursor).toBeNull();expect(found.query).toBe(parameters.get('q'));
 parameters.set('before',String(match.id));expect((await(await page.request.get(`/api/journal?${parameters}`)).json()).entries).toEqual([]);
});

const headers={origin:'http://127.0.0.1:3100'};
async function holdCreate(page:Page) {
 let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 let saved:{id:number;version:string}|undefined;
 const handler=async(route:Route)=>{
  if(route.request().method()!=='POST'){await route.continue();return;}
  const response=await route.fetch();saved=await response.json();await gate;await route.fulfill({response});
 };
 await page.route(/\/api\/journal$/,handler);
 return {release:()=>release(),saved:()=>saved};
}

test('keeps edits made during save and updates the same entry on the next save',async({page})=>{
 await signIn(page);await blank(page,'Journal pending edits');
 await page.getByRole('button',{name:'JOURNAL',exact:true}).click();await page.getByRole('button',{name:'New entry',exact:true}).click();
 await page.getByLabel('Entry title',{exact:true}).fill('Pending edits evidence');await page.getByLabel('Entry notes',{exact:true}).fill('First submitted text');
 const held=await holdCreate(page);await page.getByRole('button',{name:'Save entry',exact:true}).click();
 await expect.poll(()=>held.saved()?.id).toBeTruthy();
 await page.getByLabel('Entry notes',{exact:true}).fill('First submitted text plus newer edits');held.release();
 await expect(page.getByRole('button',{name:'Save entry',exact:true})).toBeEnabled();
 await expect(page.getByLabel('Entry notes',{exact:true})).toHaveValue('First submitted text plus newer edits');
 const saved=held.saved()!;
 await expect.poll(()=>page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('openterminal-journal-draft-v1:')).map(([,value])=>JSON.parse(value).draft))).toEqual([expect.objectContaining({id:saved.id,version:saved.version,body:'First submitted text plus newer edits'})]);
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByLabel('Entry notes',{exact:true})).toHaveCount(0);
 const current=await(await page.request.get(`/api/journal/${saved.id}`)).json();expect(current.body).toBe('First submitted text plus newer edits');expect(current.version).not.toBe(saved.version);
 const rows=await(await page.request.get('/api/journal?symbol=AAPL')).json();expect(rows.entries.filter((entry:any)=>entry.title==='Pending edits evidence')).toHaveLength(1);
});

test('keeps a conflicted draft, compares server content and rejects a second stale review',async({page})=>{
 await signIn(page);await blank(page,'Journal conflict review');
 const input={symbol:'AAPL',title:'Conflict evidence',body:'Original text',kind:'research',image:null};
 const created=await(await page.request.post('/api/journal',{headers,data:input})).json();
 await page.getByRole('button',{name:'JOURNAL',exact:true}).click();await page.getByRole('button',{name:'AAPL · Conflict evidence',exact:true}).click();
 await page.getByLabel('Entry notes',{exact:true}).fill('My local merge');
 const changed=await(await page.request.put(`/api/journal/${created.id}`,{headers,data:{...input,version:created.version,body:'Other device text'}})).json();
 await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'This entry changed on another device.'})).toBeVisible();
 await expect(page.getByLabel('Entry notes',{exact:true})).toHaveValue('My local merge');
 await page.getByRole('button',{name:'Review saved entry',exact:true}).click();const comparison=page.getByRole('region',{name:'Saved entry comparison',exact:true});await expect(comparison).toContainText('Other device text');
 await page.request.put(`/api/journal/${created.id}`,{headers,data:{...input,version:changed.version,body:'Another edit after comparison'}});
 page.once('dialog',dialog=>dialog.accept());await comparison.getByRole('button',{name:'Save my current edits',exact:true}).click();await expect(page.getByRole('button',{name:'Save entry',exact:true})).toBeEnabled();
 expect((await(await page.request.get(`/api/journal/${created.id}`)).json()).body).toBe('Another edit after comparison');await expect(page.getByLabel('Entry notes',{exact:true})).toHaveValue('My local merge');
 await page.getByRole('button',{name:'Review saved entry',exact:true}).click();await expect(comparison).toContainText('Another edit after comparison');
 page.once('dialog',dialog=>dialog.accept());await comparison.getByRole('button',{name:'Save my current edits',exact:true}).click();await expect(page.getByLabel('Entry notes',{exact:true})).toHaveCount(0);
 expect((await(await page.request.get(`/api/journal/${created.id}`)).json()).body).toBe('My local merge');
});

test('a reopened research editor shares its pending save and clears after completion',async({page})=>{
 await signIn(page);await page.getByRole('button',{name:'Research AAPL',exact:true}).first().click();
 const research=page.getByRole('dialog',{name:'AAPL research',exact:true});await research.getByRole('button',{name:'Write note',exact:true}).click();
 await research.getByLabel('Entry title',{exact:true}).fill('Reopened pending note');await research.getByLabel('Entry notes',{exact:true}).fill('Saved exactly once');
 const held=await holdCreate(page);await research.getByRole('button',{name:'Save entry',exact:true}).click();await expect.poll(()=>held.saved()?.id).toBeTruthy();
 await research.getByRole('button',{name:'Close research',exact:true}).click();await page.getByRole('region',{name:'Watchlist',exact:true}).getByRole('button',{name:'Research AAPL',exact:true}).click();await research.getByRole('button',{name:'Notes',exact:true}).click();
 await expect(research.getByRole('button',{name:'Save entry',exact:true})).toBeDisabled();await expect(research.getByLabel('Entry title',{exact:true})).toHaveValue('Reopened pending note');
 held.release();await expect(research.getByLabel('Entry title',{exact:true})).toHaveCount(0);await expect(research.getByRole('button',{name:'AAPL · Reopened pending note',exact:true})).toBeVisible();
});

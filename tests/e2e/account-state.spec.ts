import {test,expect} from '@playwright/test';
import {signIn,blank} from './helpers';

test('keeps late option valuations and ledger details attached to their account',async({page})=>{
 await signIn(page);
 await blank(page,'Option account isolation');
 const accounts=[101,202].map(id=>({id,version:1,payload:{name:`Account ${id}`,cash:1000,realized:0,stocks:{}}}));
 await page.route('**/api/option-positions',route=>route.fulfill({json:{accounts,lots:[{id:1,payload:{accountId:101,symbol:'AAPL',expiry:'2026-12-01',remaining:1,status:'open',legs:[{premium:5}]}}]}}));
 await page.route('**/api/option-positions/accounts/101/events',route=>route.fulfill({json:[{type:'FIRST_ACCOUNT_EVENT'}]}));
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/option-positions/report',async route=>{
  await gate;
  await route.fulfill({json:{accountId:101,nav:111,netPnl:11,coverage:'First account valuation',positions:[],stocks:[]}});
 });
 await page.getByRole('button',{name:'OPTION HOLDINGS',exact:true}).click();
 await page.getByRole('button',{name:/AAPL .*1 remaining/}).click();
 await page.getByRole('button',{name:'Inspect option ledger',exact:true}).click();
 await expect(page.getByText(/FIRST_ACCOUNT_EVENT/)).toBeVisible();
 const requested=page.waitForRequest('**/api/option-positions/report');
 await page.getByRole('button',{name:'Refresh option valuation',exact:true}).click();
 await requested;
 await page.getByLabel('Option account',{exact:true}).selectOption('202');
 await expect(page.getByText(/FIRST_ACCOUNT_EVENT/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Record option close',exact:true})).toBeDisabled();
 const response=page.waitForResponse('**/api/option-positions/report');
 release();
 await response;
 await expect(page.getByText('First account valuation',{exact:true})).toHaveCount(0);
 // A completed request is still available under its original account.
 await page.getByLabel('Option account',{exact:true}).selectOption('101');
 await expect(page.getByText('First account valuation',{exact:true})).toBeVisible();
});

test('discards late import previews after editing and hides another account reconciliation',async({page})=>{
 await signIn(page);
 await blank(page,'Import account isolation');
 await page.route('**/api/account-import',route=>route.fulfill({json:{accounts:[101,202].map(id=>({id,payload:{name:`Account ${id}`}})),profiles:[],batches:[],reconciliations:[]}}));
 let release!:()=>void;
 const gate=new Promise<void>(resolve=>{release=resolve;});
 await page.route('**/api/account-import/preview',async route=>{
  await gate;
  await route.fulfill({json:{canImport:true,total:1,ready:1,duplicates:0,errors:[],rows:[],token:'old-input'}});
 });
 await page.route('**/api/account-import/reconcile',route=>route.fulfill({json:{accountId:101,matched:true,rows:[]}}));
 await page.getByRole('button',{name:'ACCOUNT RECONCILE',exact:true}).click();
 await page.getByLabel('Account CSV text',{exact:true}).fill('kind,currency,date,amount\nDEPOSIT,USD,2026-01-01,100');
 const requested=page.waitForRequest('**/api/account-import/preview');
 await page.getByRole('button',{name:'Preview account import',exact:true}).click();
 await requested;
 await page.getByLabel('Account CSV text',{exact:true}).fill('kind,currency,date,amount\nDEPOSIT,USD,2026-01-01,200');
 const response=page.waitForResponse('**/api/account-import/preview');
 release();
 await response;
 await expect(page.getByRole('button',{name:'Preview account import',exact:true})).toBeEnabled();
 await expect(page.getByRole('button',{name:'Import reviewed account batch',exact:true})).toBeDisabled();
 await expect(page.getByText('1 input · 1 new · 0 duplicates · 0 errors',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Reconcile account',exact:true}).click();
 await expect(page.getByText('Statement matches ledger.',{exact:true})).toBeVisible();
 await page.getByLabel('Import currency account',{exact:true}).selectOption('202');
 await expect(page.getByText('Statement matches ledger.',{exact:true})).toHaveCount(0);
});

test('does not poll an idle validation workspace every second',async({page})=>{
 await signIn(page);
 await blank(page,'Idle validation');
 let requests=0;
 await page.route('**/api/walkforward',route=>{requests++;return route.fulfill({json:[]});});
 await page.getByRole('button',{name:'STRATEGY VALIDATION',exact:true}).click();
 await expect.poll(()=>requests).toBe(1);
 // Observe more than two former one-second polling intervals.
 await page.waitForTimeout(2200);
 expect(requests).toBe(1);
});

import {test,expect} from '@playwright/test';import {signIn,blank} from './helpers';
test('private API requires a signed session and rejects cross-origin mutations',async({page,request})=>{
 expect((await request.get('/api/portfolios')).status()).toBe(401);
 await page.goto('/');await expect(page).toHaveURL(/\/login$/);
 await page.getByLabel('Terminal password').fill('incorrect');await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByText('Invalid password.',{exact:true})).toContainText('Invalid password');
 await signIn(page);expect((await page.request.get('/api/portfolios')).status()).toBe(200);
 expect((await page.request.post('/api/portfolios',{headers:{origin:'https://outside.invalid'},data:{name:'Forbidden'}})).status()).toBe(403);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page).toHaveURL(/\/login$/);expect((await page.request.get('/api/portfolios')).status()).toBe(401);
});
test('workspace and journal remain usable after authentication',async({page})=>{await signIn(page);await blank(page,'Journal');await page.getByRole('button',{name:'JOURNAL',exact:true}).click();await page.getByRole('button',{name:'New entry',exact:true}).click();await page.getByLabel('Entry title').fill('Browser evidence');await page.getByLabel('Entry notes').fill('Saved through authenticated proxy');await page.getByRole('button',{name:'Save entry',exact:true}).click();await expect(page.getByRole('button',{name:'AAPL · Browser evidence',exact:true})).toBeVisible();await page.reload();await expect(page.locator('#workspace-select')).toBeVisible();});

test('quote quality shows retrieval separately from observation time',async({page})=>{await signIn(page);await blank(page,'Quality');await page.getByRole('button',{name:'DATA QUALITY',exact:true}).click();await expect(page.getByRole('cell',{name:'Recently retrieved',exact:true}).first()).toBeVisible();await expect(page.getByRole('columnheader',{name:'Observed UTC',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'not supplied',exact:true}).first()).toBeVisible();});

import {test,expect} from '@playwright/test';import {signIn,blank} from './helpers';
test('saves grouped AND signals, survives reload, pauses and retains history',async({page})=>{
 await signIn(page);await blank(page,'Signals');await page.getByRole('button',{name:'SIGNALS',exact:true}).click();
 await page.getByLabel('Signal name').fill('Group breakout');await page.getByLabel('Signal symbols').fill('AAPL,MSFT');await page.getByLabel('Signal condition').selectOption('BREAKOUT');await page.getByText('AND volume ≥').check();await page.getByRole('button',{name:'Save signal',exact:true}).click();await expect(page.getByText('Group breakout · AAPL, MSFT · Active',{exact:false})).toBeVisible();
 await page.reload();await expect(page.getByText('Group breakout · AAPL, MSFT · Active',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Pause / resume'}).click();await expect(page.getByText('Group breakout · AAPL, MSFT · Paused',{exact:false})).toBeVisible();await page.getByRole('button',{name:'Delete',exact:true}).click();await expect(page.getByRole('button',{name:'Pause / resume'})).toHaveCount(0);
});

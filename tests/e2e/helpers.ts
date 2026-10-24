import {createHash} from 'node:crypto';
import {test,expect,type Page} from '@playwright/test';
export async function signIn(page:Page){
 // The fixture API trusts this local proxy; isolate each test's request budget without disabling limits.
 const bytes=createHash('sha256').update(test.info().testId).digest();
 await page.context().setExtraHTTPHeaders({'x-forwarded-for':`10.${bytes[0]}.${bytes[1]}.${bytes[2]}`});
 await page.goto('/');await page.getByLabel('Terminal password').fill('fixture owner password');const delivery=page.waitForResponse(r=>r.url().includes('/api/alerts/events?')&&r.request().method()==='GET');await page.getByRole('button',{name:'Sign in',exact:true}).click();await delivery;await expect(page.locator('#workspace-select')).toBeVisible();}
export async function blank(page:Page,name:string){const manage=page.getByText('Manage',{exact:true});if(!await manage.evaluate(e=>(e.parentElement as HTMLDetailsElement).open))await manage.click();await page.getByLabel('Workspace name').fill(name);await page.getByLabel('Workspace preset').selectOption('blank');await page.getByRole('button',{name:'Create',exact:true}).click();await manage.click();const toasts=page.getByRole('button',{name:/^Dismiss alert event /});while(await toasts.count())await toasts.first().click();}

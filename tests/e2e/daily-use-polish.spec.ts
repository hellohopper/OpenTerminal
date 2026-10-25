import {test,expect} from "@playwright/test";
import {signIn,blank} from "./helpers";

test("simple navigation exposes alerts and remembers each workspace portfolio across reloads",async({page})=>{
 await page.route("**/api/portfolios",route=>route.fulfill({json:[{id:701,name:"First account"},{id:702,name:"Second account"}]}));
 await page.route(/\/api\/portfolios\/70[12]\/positions$/,route=>route.fulfill({json:[]}));
 await signIn(page);const first=await page.locator("#workspace-select").inputValue();
 await page.getByLabel("Interface mode",{exact:true}).selectOption("simple");
 const nav=page.getByRole("navigation",{name:"Simple navigation",exact:true});
 await nav.getByRole("button",{name:"Holdings",exact:true}).click();await page.getByLabel("Portfolio account",{exact:true}).selectOption("702");
 await nav.getByRole("button",{name:"Alerts",exact:true}).click();await expect(page.getByRole("heading",{name:"Alerts",exact:true})).toBeVisible();
 await nav.getByRole("button",{name:"Holdings",exact:true}).click();await expect(page.getByLabel("Portfolio account",{exact:true})).toHaveValue("702");
 await page.reload();await expect(page.getByLabel("Portfolio account",{exact:true})).toHaveValue("702");
 await blank(page,"Other simple account");await expect(page.getByLabel("Portfolio account",{exact:true})).toHaveValue("701");
 await page.locator("#workspace-select").selectOption(first);await expect(page.getByLabel("Portfolio account",{exact:true})).toHaveValue("702");
});

test("previews, saves and restores a layout checkpoint without replacing symbols",async({page},info)=>{
 await signIn(page);await blank(page,"Checkpoint example");
 await page.getByRole("button",{name:"WATCHLIST",exact:true}).click();await page.getByRole("button",{name:"Save current layout",exact:true}).click();
 await expect(page.getByText("Saved layout matches current view",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:/^CHART/}).click();await expect(page.getByText("Changes since saved layout",{exact:true})).toBeVisible();
 const watch=page.getByRole("region",{name:"Watchlist",exact:true});await watch.getByRole("textbox",{name:"Add ticker",exact:true}).fill("IBM");await watch.getByRole("button",{name:"Add ticker",exact:true}).click();
 await page.reload();await expect(page.getByText("Changes since saved layout",{exact:true})).toBeVisible();
 await page.getByRole("button",{name:"Preview layout",exact:true}).click();const preview=page.getByRole("dialog",{name:"Layout preview",exact:true});
 await expect(preview.getByRole("img",{name:"Panel positions preview"})).toBeVisible();await page.screenshot({path:info.outputPath("layout-preview.png")});
 await preview.getByRole("button",{name:"Saved version",exact:true}).click();await expect(preview.getByText("Chart",{exact:true})).toHaveCount(0);
 await preview.getByRole("button",{name:"Restore saved layout",exact:true}).click();await preview.getByRole("button",{name:"Confirm restore",exact:true}).click();await preview.getByRole("button",{name:"Done",exact:true}).click();
 await expect(page.getByRole("region",{name:"Chart",exact:true})).toHaveCount(0);await expect(watch.getByRole("button",{name:"Select IBM",exact:true})).toBeVisible();
 await expect(page.getByText("Saved layout matches current view",{exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});await page.getByLabel("Interface mode",{exact:true}).selectOption("simple");await page.getByRole("button",{name:"Preview layout",exact:true}).click();
 await expect(preview.getByRole("button",{name:"Save current layout",exact:true})).toBeVisible();await expect(preview.getByRole("button",{name:"Save layout as…",exact:true})).toBeVisible();
 await page.screenshot({path:info.outputPath("layout-preview-phone.png")});await preview.getByRole("button",{name:"Save layout as…",exact:true}).click();
 await expect(page.getByRole("textbox",{name:"New layout name",exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("pauses periodic shared-list refresh in manual and background modes and preserves manual refresh",async({page})=>{
 await page.clock.install();await signIn(page);await blank(page,"Refresh policy");await page.getByRole("button",{name:"WATCHLIST",exact:true}).click();
 let requests=0;await page.route(/\/api\/watchlists$/,route=>{requests++;return route.fulfill({json:[]});});
 await page.getByRole("button",{name:"UI settings",exact:true}).click();const settings=page.getByRole("dialog",{name:"UI settings",exact:true});
 await settings.getByLabel("Automatic data refresh",{exact:true}).selectOption("0");await settings.getByRole("button",{name:"Done",exact:true}).click();
 const initial=requests;await page.clock.fastForward(65000);expect(requests).toBe(initial);
 await page.getByRole("region",{name:"Watchlist",exact:true}).getByText("Shared watchlists",{exact:true}).click();await expect.poll(()=>requests).toBeGreaterThan(initial);
 await page.getByRole("button",{name:"UI settings",exact:true}).click();await settings.getByLabel("Automatic data refresh",{exact:true}).selectOption("1000");await settings.getByRole("button",{name:"Done",exact:true}).click();
 await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"hidden"});document.dispatchEvent(new Event("visibilitychange"));});
 const hidden=requests;await page.clock.fastForward(65000);expect(requests).toBe(hidden);
 await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,get:()=>"visible"});document.dispatchEvent(new Event("visibilitychange"));});
 await page.clock.fastForward(16000);await expect.poll(()=>requests).toBeGreaterThan(hidden);
});

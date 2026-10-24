import {test,expect} from "@playwright/test";
import {signIn,blank} from "./helpers";

test("manages shared lists, persists both orders, and restores local symbols after deletion",async({page})=>{
 await signIn(page);await blank(page,"Shared list management");
 await page.getByRole("button",{name:"WATCHLIST",exact:true}).click();
 const panel=page.getByRole("region",{name:"Watchlist",exact:true});
 await panel.getByRole("textbox",{name:"Add ticker",exact:true}).fill("IBM");
 await panel.getByRole("button",{name:"Add ticker",exact:true}).click();
 await panel.getByText("Shared watchlists",{exact:true}).click();
 const source=panel.getByLabel("Watchlist source",{exact:true});
 await panel.getByLabel("Shared list name",{exact:true}).fill("Management copy");
 await panel.getByRole("button",{name:"Publish current list",exact:true}).click();
 await expect(source).not.toHaveValue("0");const copied=await source.inputValue();
 await expect(panel.getByRole("button",{name:"Select IBM",exact:true})).toBeVisible();
 await panel.getByLabel("Shared list name",{exact:true}).fill("Management empty");
 await panel.getByRole("button",{name:"Create empty list",exact:true}).click();
 await expect(source).not.toHaveValue(copied);const empty=await source.inputValue();
 await expect(panel.getByRole("button",{name:"Select IBM",exact:true})).toHaveCount(0);
 for(const symbol of ["NVDA","MSFT"]){await panel.getByRole("textbox",{name:"Add ticker",exact:true}).fill(symbol);await panel.getByRole("button",{name:"Add ticker",exact:true}).click();await expect(panel.getByRole("button",{name:`Select ${symbol}`,exact:true})).toBeVisible();}
 await panel.getByText("Manage shared lists",{exact:true}).click();
 await panel.getByRole("button",{name:"Move up MSFT",exact:true}).click();
 await expect(panel.getByLabel("Shared symbol order").locator("li").first()).toContainText("MSFT");
 await panel.getByRole("button",{name:"Move up Management empty",exact:true}).click();
 const listOrder=panel.getByLabel("Shared list order");
 await expect.poll(async()=>{const names=await listOrder.locator("li > span").allTextContents();return names.indexOf("Management empty")<names.indexOf("Management copy");}).toBe(true);
 await panel.getByRole("button",{name:"Rename Management empty",exact:true}).click();
 const rename=page.getByRole("dialog",{name:"Rename shared list",exact:true});
 await rename.getByLabel("New list name").fill("Management renamed");await rename.getByRole("button",{name:"Save",exact:true}).click();
 await expect(rename).toHaveCount(0);await expect(source.locator("option:checked")).toHaveText("Management renamed");
 await page.reload();await expect(panel).toBeVisible();
 await panel.locator("summary").filter({hasText:/^Shared watchlists/}).click();
 await panel.getByText("Manage shared lists",{exact:true}).click();
 await expect(source).toHaveValue(empty);await expect(panel.getByLabel("Shared symbol order").locator("li").first()).toContainText("MSFT");
 const savedNames=await listOrder.locator("li > span").allTextContents();expect(savedNames.indexOf("Management renamed")).toBeLessThan(savedNames.indexOf("Management copy"));
 await panel.getByRole("button",{name:"Delete Management renamed",exact:true}).click();
 const deletion=page.getByRole("dialog",{name:"Delete shared list",exact:true});
 await deletion.getByRole("button",{name:"Cancel",exact:true}).click();await expect(source).toHaveValue(empty);
 await panel.getByRole("button",{name:"Delete Management renamed",exact:true}).click();
 await deletion.getByRole("button",{name:"Delete shared list",exact:true}).click();
 await expect(deletion).toHaveCount(0);await expect(source).toHaveValue("0");
 await expect(panel.getByRole("button",{name:"Select IBM",exact:true})).toBeVisible();
 const lists=await(await page.request.get("/api/watchlists")).json();expect(lists.some((row:any)=>String(row.id)===empty)).toBe(false);
});

test("a deletion reviewed before a phone edit is rejected and remote deletion restores local source",async({page})=>{
 await signIn(page);await blank(page,"Shared conflict");await page.getByRole("button",{name:"WATCHLIST",exact:true}).click();
 const panel=page.getByRole("region",{name:"Watchlist",exact:true}),headers={origin:"http://127.0.0.1:3100"};
 await panel.getByText("Shared watchlists",{exact:true}).click();await panel.getByLabel("Shared list name",{exact:true}).fill("Conflict list");
 await panel.getByRole("button",{name:"Create empty list",exact:true}).click();
 const source=panel.getByLabel("Watchlist source",{exact:true});await expect(source).not.toHaveValue("0");const id=await source.inputValue();
 await panel.getByText("Manage shared lists",{exact:true}).click();await panel.getByRole("button",{name:"Delete Conflict list",exact:true}).click();
 const updated=await(await page.request.post(`/api/watchlists/${id}/symbols`,{headers,data:{symbol:"IBM",action:"add"}})).json();
 await page.getByRole("dialog",{name:"Delete shared list",exact:true}).getByRole("button",{name:"Delete shared list",exact:true}).click();
 await expect(panel.getByRole("alert")).toContainText("review it before deleting");await expect(source).toHaveValue(id);
 await expect(panel.getByRole("button",{name:"Select IBM",exact:true})).toBeVisible();
 expect((await page.request.delete(`/api/watchlists/${id}?version=${updated.version}`,{headers})).ok()).toBe(true);
 await page.reload();await expect(panel).toBeVisible();await expect(source).toHaveValue("0");
});

import { test, expect, type Page } from "@playwright/test";
import { signIn, blank } from "./helpers";
const headers = { origin: "http://127.0.0.1:3100" };
const quoteFixture = (symbol: string) => ({ symbol, name: symbol, price: 110, change: 1, changePercent: 1, open: 109, high: 111, low: 108, previousClose: 109, bid: 109.9, ask: 110.1, volume: 100000, avgVolume: null, marketCap: null, pe: null, eps: null, dividendYield: null, week52High: null, week52Low: null, beta: null, sharesOutstanding: null, currency: "USD", exchange: "FIXTURE", source: "fixture", retrievedAt: new Date().toISOString() });
async function refreshSetting(page: Page, value: string) {
  await page.getByRole("button", { name: "UI settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "UI settings", exact: true });
  await settings.getByLabel("Automatic data refresh", { exact: true }).selectOption(value);
  await settings.getByRole("button", { name: "Done", exact: true }).click();
}
async function draftCount(page: Page) { return page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("openterminal-journal-draft-v1:")).length); }

test("Chinese form labels preserve portfolio sides and thesis operator payloads", async ({ page }) => {
  await signIn(page); await blank(page, "Chinese forms");
  const portfolio = await (await page.request.post("/api/portfolios", { headers, data: { name: "Chinese UI test portfolio" } })).json();
  await page.request.post(`/api/portfolios/${portfolio.id}/transactions`, { headers, data: { symbol: "UIFORM", side: "BUY", quantity: 2, price: 100, executed_at: "2026-01-01T00:00:00Z" } });
  const thesis = await (await page.request.post("/api/theses", { headers, data: { symbol: "AAPL", title: "Chinese operator fixture", rationale: "Fixture", metrics: "Price", catalysts: "Review", invalidation: "Review", reviewDate: "2026-01-01", status: "active" } })).json();
  await page.getByRole("button", { name: /^PORTFOLIO ⌥8$/ }).click();
  await page.getByRole("button", { name: "THESIS MONITOR", exact: true }).click();
  await page.getByRole("button", { name: "UI settings", exact: true }).click();
  await page.getByLabel("Language / 语言", { exact: true }).selectOption("zh");
  await page.getByRole("dialog", { name: "界面设置", exact: true }).getByRole("button", { name: "完成", exact: true }).click();
  const holdings = page.getByRole("region", { name: "投资组合", exact: true });
  await holdings.getByLabel("持仓账户", { exact: true }).selectOption(String(portfolio.id));
  await holdings.getByLabel("买卖方向", { exact: true }).selectOption({ label: "卖出" });
  await expect(holdings.getByLabel("买卖方向", { exact: true })).toHaveValue("SELL");
  await holdings.getByPlaceholder("股票代码", { exact: true }).fill("UIFORM");
  await holdings.getByPlaceholder("数量", { exact: true }).fill("1");
  await holdings.getByPlaceholder("价格", { exact: true }).fill("110");
  await holdings.getByLabel("交易日期（UTC）", { exact: true }).fill("2026-01-02");
  const trade = page.waitForResponse(response => response.url().endsWith(`/api/portfolios/${portfolio.id}/transactions`) && response.request().method() === "POST");
  await holdings.getByRole("button", { name: "添加", exact: true }).click();
  const savedTrade = await trade; expect(savedTrade.ok()).toBe(true); expect(savedTrade.request().postDataJSON().side).toBe("SELL");
  const monitor = page.getByRole("region", { name: "观点证据监测", exact: true });
  await monitor.getByLabel("监测投资观点", { exact: true }).selectOption(String(thesis.id));
  await monitor.getByLabel("条件运算符 1", { exact: true }).selectOption({ label: "小于等于" });
  await monitor.getByLabel("启用观点规则", { exact: true }).uncheck();
  const rule = page.waitForResponse(response => response.url().endsWith("/api/thesis-monitor") && response.request().method() === "POST");
  await monitor.getByRole("button", { name: "保存观点规则", exact: true }).click();
  const savedRule = await rule; expect(savedRule.ok()).toBe(true); expect(savedRule.request().postDataJSON().conditions[0].operator).toBe("lte");
});

test("research chart keeps its instance, indicators, period and panned viewport between sections", async ({ page }) => {
  await signIn(page); await page.getByRole("button", { name: "Research AAPL", exact: true }).first().click();
  const research = page.getByRole("dialog", { name: "AAPL research", exact: true });
  await research.getByRole("button", { name: "Chart", exact: true }).click();
  const chart = research.getByLabel("Research chart", { exact: true });
  await chart.getByRole("button", { name: "1Y", exact: true }).click();
  await chart.getByLabel("Chart type", { exact: true }).selectOption("line");
  await chart.locator("summary").filter({ hasText: "Indicators" }).click();
  await chart.getByRole("checkbox", { name: "RSI", exact: true }).check();
  await chart.locator("summary").filter({ hasText: "Indicators" }).click();
  const canvas = chart.locator("canvas").first(); await expect(canvas).toBeVisible();
  const handle = await canvas.elementHandle(), bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width * .4, bounds.y + bounds.height * .5); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .55, bounds.y + bounds.height * .5, { steps: 8 }); await page.mouse.up();
  await page.mouse.move(20, 20);
  const before = await canvas.screenshot();
  await research.getByRole("button", { name: "Financials", exact: true }).click();
  await expect(chart).toBeHidden();
  await research.getByRole("button", { name: "Chart", exact: true }).click();
  await expect(chart.getByRole("button", { name: "1Y", exact: true })).toHaveClass(/active/);
  await expect(chart.getByLabel("Chart type", { exact: true })).toHaveValue("line");
  expect(await handle!.evaluate(element => element.isConnected)).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await canvas.screenshot()).toEqual(before);
  await chart.locator("summary").filter({ hasText: "Indicators" }).click();
  await expect(chart.getByRole("checkbox", { name: "RSI", exact: true })).toBeChecked();
});

test("journal drafts survive reload, stay isolated by symbol, and clear on discard or successful save", async ({ page }) => {
  await signIn(page); await page.getByRole("button", { name: "Research AAPL", exact: true }).first().click();
  let research = page.getByRole("dialog", { name: "AAPL research", exact: true });
  await research.getByRole("button", { name: "Write note", exact: true }).click();
  await research.getByLabel("Entry title", { exact: true }).fill("Local draft recovery evidence");
  await research.getByLabel("Entry notes", { exact: true }).fill("现金流 · retained after reload");
  await expect.poll(() => draftCount(page)).toBe(1);
  await research.getByRole("button", { name: "Close research", exact: true }).click();
  await page.getByRole("region", { name: "Watchlist", exact: true }).getByRole("button", { name: "Research MSFT", exact: true }).click();
  const other = page.getByRole("dialog", { name: "MSFT research", exact: true });
  await other.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(other.getByLabel("Entry title", { exact: true })).toHaveCount(0);
  await other.getByRole("button", { name: "Close research", exact: true }).click();
  await page.getByRole("region", { name: "Watchlist", exact: true }).getByRole("button", { name: "Research AAPL", exact: true }).click();
  await page.reload(); research = page.getByRole("dialog", { name: "AAPL research", exact: true });
  await research.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(research.getByLabel("Entry title", { exact: true })).toHaveValue("Local draft recovery evidence");
  await expect(research.getByLabel("Entry notes", { exact: true })).toHaveValue("现金流 · retained after reload");
  page.once("dialog", dialog => dialog.accept());
  await research.getByRole("button", { name: "Discard draft", exact: true }).click();
  await expect.poll(() => draftCount(page)).toBe(0);
  await page.reload(); await research.getByRole("button", { name: "Notes", exact: true }).click();
  await expect(research.getByLabel("Entry title", { exact: true })).toHaveCount(0);
  await research.getByRole("button", { name: "Write note", exact: true }).click();
  await research.getByLabel("Entry title", { exact: true }).fill("Saved local recovery note");
  await research.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(research.getByRole("button", { name: "AAPL · Saved local recovery note", exact: true })).toBeVisible();
  await expect.poll(() => draftCount(page)).toBe(0);
});

for (const name of ["Quote", "Watchlist", "Macro / Indexes"]) test(`${name} retains data after a failed refresh and recovers manually`, async ({ page }) => {
  let failing = false;
  // Exercise browser recovery independently of the shared API rate-limit window.
  await page.route("**/api/quotes?*", route => route.fulfill(failing ? { status: 502, json: { error: "API unavailable or timed out." } } : { json: new URL(route.request().url()).searchParams.get("symbols")!.split(",").map(quoteFixture) }));
  await page.route("**/api/macro?*", route => route.fulfill(failing ? { status: 502, json: { error: "API unavailable or timed out." } } : { json: { yields: [{ tenor: "2Y", value: 4 }], vix: 20, indexes: [{ symbol: "SPY", label: "S&P 500", price: 110, changePercent: 1 }], policyRate: 5, inflation: 3 } }));
  await test.step("Sign in", () => signIn(page));
  await test.step("Set manual refresh", () => refreshSetting(page, "0"));
  const toasts = page.getByRole("button", { name: /^Dismiss alert event / });
  while (await toasts.count()) await toasts.first().click();
  await test.step(`Refresh ${name} through a failure and recovery`, async () => {
    const panel = page.getByRole("region", { name, exact: true });
    await expect(panel.getByText("Data ready", { exact: true })).toBeVisible();
    const values = panel.locator(name === "Quote" ? ".quote-head" : "table tbody");
    const retained = (await values.textContent())!;
    failing = true;
    await panel.getByRole("button", { name: "Refresh data", exact: true }).click();
    await expect(panel.getByRole("alert")).toContainText("Refresh failed. Showing last available data.");
    await expect(values).toHaveText(retained);
    failing = false; await panel.getByRole("button", { name: "Retry data refresh", exact: true }).click();
    await expect(panel.getByText("Data ready", { exact: true })).toBeVisible();
  });
});

test("refresh cadence persists and stops frequent requests when a panel moves offscreen", async ({ page }) => {
  await signIn(page); await blank(page, "Refresh visibility");
  let requests = 0;
  await page.route("**/api/quotes?symbols=*", route => { requests++; return route.continue(); });
  await page.getByRole("button", { name: "WATCHLIST", exact: true }).click();
  await refreshSetting(page, "1000");
  const initial = requests; await expect.poll(() => requests).toBeGreaterThan(initial + 1);
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /^CHART/ }).click();
  await page.getByRole("region", { name: "Chart", exact: true }).last().scrollIntoViewIfNeeded();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const offscreen = requests; await page.waitForTimeout(2200); expect(requests).toBe(offscreen);
  await refreshSetting(page, "0"); await page.reload();
  await page.getByRole("button", { name: "UI settings", exact: true }).click();
  await expect(page.getByLabel("Automatic data refresh", { exact: true })).toHaveValue("0");
});

test("quote panels fold secondary metrics, preserve zeros and persist the empty-field preference", async ({ page }) => {
  await page.route("**/api/quotes?symbols=*", route => route.fulfill({ json: [{ symbol: "AAPL", price: 110, change: 0, changePercent: 0, open: 0, high: null, low: null, previousClose: 100, bid: null, ask: null, volume: 100, avgVolume: null, marketCap: 1000, pe: null, eps: null, dividendYield: null, week52High: null, week52Low: null, beta: null, sharesOutstanding: null, currency: "USD", exchange: "FIXTURE", source: "fixture", retrievedAt: new Date().toISOString() }] }));
  await signIn(page);
  let quote = page.getByRole("region", { name: "Quote", exact: true });
  const metrics = quote.getByLabel("Key quote metrics", { exact: true });
  await expect(metrics.getByText("0.00", { exact: true })).toBeVisible();
  await expect(metrics.getByText("High", { exact: true })).toHaveCount(0);
  await expect(quote.getByText("Mkt Cap", { exact: true })).toBeHidden();
  await quote.locator("summary").filter({ hasText: "More indicators" }).click();
  await expect(quote.getByText("Mkt Cap", { exact: true })).toBeVisible();
  await quote.getByRole("checkbox", { name: "Hide unavailable fields", exact: true }).uncheck();
  await expect(metrics.getByText("High", { exact: true })).toBeVisible();
  await page.reload(); quote = page.getByRole("region", { name: "Quote", exact: true });
  await expect(quote.getByRole("checkbox", { name: "Hide unavailable fields", exact: true })).not.toBeChecked();
});

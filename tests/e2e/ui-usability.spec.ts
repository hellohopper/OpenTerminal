import { test, expect } from "@playwright/test";
import { signIn, blank } from "./helpers";

test("chart controls and panel actions preserve state and support undo and restore", async ({ page }) => {
  await signIn(page); await blank(page, "UI actions");
  await page.getByRole("button", { name: /^CHART/ }).click();
  let chart = page.getByRole("region", { name: "Chart", exact: true });
  await expect(page.getByRole("status").filter({ hasText: "Added Chart panel" })).toBeVisible();
  await chart.getByRole("button", { name: "1Y", exact: true }).click();
  await chart.getByLabel("Chart type", { exact: true }).selectOption("line");
  await chart.locator("summary").filter({ hasText: "Indicators" }).click();
  await chart.getByRole("checkbox", { name: "RSI", exact: true }).check();
  await chart.locator("summary").filter({ hasText: "Indicators" }).click();
  await chart.getByRole("button", { name: "Maximize Chart panel", exact: true }).click();
  const expanded = page.getByRole("dialog", { name: "Chart", exact: true });
  await expect(expanded).toBeVisible();
  await expect(expanded.getByLabel("Chart type", { exact: true })).toHaveValue("line");
  await expect(expanded.getByRole("button", { name: "1Y", exact: true })).toHaveClass(/active/);
  await page.keyboard.press("Escape");
  chart = page.getByRole("region", { name: "Chart", exact: true });
  await expect(chart.getByLabel("Chart type", { exact: true })).toHaveValue("line");
  await chart.getByLabel("Actions for Chart", { exact: true }).click();
  await chart.getByRole("button", { name: "Hide panel", exact: true }).click();
  await expect(chart).toHaveCount(0);
  await page.getByRole("button", { name: "UI settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "UI settings", exact: true });
  await settings.getByRole("tab", { name: "Panels", exact: true }).click();
  await settings.getByRole("switch", { name: "Show Chart panel 1", exact: true }).check();
  await settings.getByRole("button", { name: "Done", exact: true }).click();
  await chart.getByLabel("Actions for Chart", { exact: true }).click();
  await chart.getByRole("button", { name: "Remove panel", exact: true }).click();
  await expect(chart).toHaveCount(0);
  await page.getByRole("button", { name: "Undo removal", exact: true }).click();
  await expect(chart).toBeVisible();
});

test("watchlist selection is distinct from research and supports the keyboard", async ({ page }) => {
  await signIn(page);
  const list = page.getByRole("region", { name: "Watchlist", exact: true });
  await list.getByRole("button", { name: "Select MSFT", exact: true }).click();
  await expect(list.getByRole("button", { name: "Select MSFT", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog", { name: "MSFT research", exact: true })).toHaveCount(0);
  const symbol = list.getByRole("button", { name: "Select AAPL", exact: true });
  await symbol.focus(); await page.keyboard.press("Enter");
  await expect(symbol).toHaveAttribute("aria-pressed", "true");
  await list.getByRole("button", { name: "Research MSFT", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "MSFT research", exact: true })).toBeVisible();
});

test("sidebar preferences and independent density survive reload with Chinese large text on mobile", async ({ page }, testInfo) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Widget library", exact: true });
  await nav.getByRole("button", { name: "Favorite CHART", exact: true }).click();
  await nav.getByRole("button", { name: /^Research \d+$/ }).click();
  await page.getByRole("button", { name: "UI settings", exact: true }).click();
  let settings = page.getByRole("dialog", { name: "UI settings", exact: true });
  await settings.getByLabel("Interface density", { exact: true }).selectOption("comfortable");
  await settings.getByRole("button", { name: "20px", exact: true }).click();
  await settings.getByLabel("Language / 语言", { exact: true }).selectOption("zh");
  await settings.getByRole("button", { name: "完成", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
  await expect(page.getByRole("navigation", { name: "功能面板库" }).getByRole("button", { name: "取消收藏行情图表", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "功能面板库" }).getByRole("button", { name: /^研究 \d+$/ })).toHaveAttribute("aria-expanded", "false");
  await page.screenshot({ path: testInfo.outputPath("large-text-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("navigation", { name: "移动端导航" }).getByRole("button", { name: "工作区", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "界面设置", exact: true }).click();
  settings = page.getByRole("dialog", { name: "界面设置", exact: true });
  await expect(settings.getByLabel("界面密度", { exact: true })).toHaveValue("comfortable");
  await page.screenshot({ path: testInfo.outputPath("large-text-mobile-settings.png") });
});

test("news defaults to reporting, deduplicates and exposes full results on request", async ({ page }) => {
  await signIn(page);
  await page.route('**/api/news?*', route => route.fulfill({ json: [
    { title: 'IWM261231P00287000 Interactive Stock Chart - Yahoo Finance', link: 'https://example.com/quote', publisher: 'Fixture', publishedAt: null },
    { title: 'Market outlook improves - Yahoo Finance', link: 'https://example.com/one', publisher: 'Fixture', publishedAt: '2026-01-01T12:00:00Z' },
    { title: 'Market outlook improves - Yahoo Finance UK', link: 'https://example.com/two', publisher: 'Fixture', publishedAt: null },
  ] }));
  await blank(page, "News filters");
  await page.getByRole("button", { name: /^NEWS/ }).click();
  const news = page.getByRole("region", { name: "News", exact: true });
  await expect(news.locator("a.news-item")).toHaveCount(1);
  await news.getByLabel("News content", { exact: true }).selectOption("all");
  await expect(news.locator("a.news-item")).toHaveCount(2);
  await news.getByLabel("Filter news", { exact: true }).fill("no matching headline");
  await expect(news.getByText("No news matches these filters. Try All results or Global.", { exact: true })).toBeVisible();
});

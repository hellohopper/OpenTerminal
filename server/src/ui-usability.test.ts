import { afterEach, describe, expect, it, vi } from "vitest";
import { money, quote } from "./providers/nasdaq.js";
import { selectNews, type NewsItem } from "../../web/lib/news";
import { createTerminalStore } from "../../web/store/terminal";
import { createDisplayStore } from "../../web/store/display";
const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
afterEach(() => { vi.unstubAllGlobals(); });

describe("quote provenance and missing values", () => {
  it("preserves actual zero but rejects blank, absent and placeholder numbers", () => {
    for (const value of ["", "   ", "--", "N/A", "$", null, undefined]) expect(money(value)).toBeNull();
    expect(money("0.00")).toBe(0); expect(money("$1,234.50")).toBe(1234.5); expect(money("-0.10")).toBe(-.1);
  });
  it("does not turn absent Nasdaq ranges or percentages into zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => ({ data: url.includes('/info?') ? { primaryData: { lastSalePrice: "$276.48", percentageChange: "" }, keyStats: {} } : { summaryData: {} } }) })));
    expect(await quote("IWM")).toMatchObject({ price: 276.48, low: null, high: null, week52Low: null, week52High: null, volume: null, changePercent: null });
  });
});

describe("news filtering", () => {
  const item = (title: string, link = "https://example.com/news"): NewsItem => ({ title, link, publisher: "Fixture", publishedAt: null });
  it("removes quote pages and syndicated duplicates while retaining reporting about options", () => {
    const rows = [item("IWM261231P00287000 Interactive Stock Chart - Yahoo Finance"), item("Russell outlook improves - Yahoo Finance"), item("Russell outlook improves - Yahoo Finance UK"), item("Investors buy puts as volatility rises"), item("IWM stock historical prices and data - Yahoo Finance"), item("IWM 261021 284.00C (IWM261021C284000) Stock Options Chain | Quotes & News - Moomoo")];
    expect(selectNews(rows, true).map(n => n.title)).toEqual([rows[1].title, rows[3].title]);
    expect(selectNews(rows, false)).toHaveLength(5);
    expect(selectNews(rows, true, "volatility")).toEqual([rows[3]]);
  });
});

describe("workspace recovery and local preferences", () => {
  it("undoes a removal in its original workspace without disturbing another workspace", () => {
    const store = createTerminalStore(memory()), before = store.getState();
    const widget = before.widgets[1], layout = before.layout.find(l => l.i === widget.id);
    store.getState().removeWidget(widget.id);
    store.getState().createWorkspace("Other", "blank");
    store.getState().undoRemoveWidget();
    expect(store.getState().widgets).toHaveLength(0);
    const restored = store.getState().workspaces.find(w => w.id === before.activeWorkspaceId)!;
    expect(restored.widgets[1]).toEqual(widget); expect(restored.layout).toContainEqual(layout);
    expect(store.getState().lastRemovedPanel).toBeNull();
  });
  it("persists density, favorites, recent order and collapsed groups and keeps them on visibility reset", async () => {
    const storage = memory(), store = createDisplayStore(storage);
    store.getState().setDensity("comfortable"); store.getState().toggleFavorite("chart");
    store.getState().recordFeatureUsed("chart"); store.getState().recordFeatureUsed("news"); store.getState().recordFeatureUsed("chart"); store.getState().toggleGroup("Research");
    const restored = createDisplayStore(storage); await restored.persist.rehydrate();
    expect(restored.getState()).toMatchObject({ density: "comfortable", favoriteFeatures: ["chart"], recentFeatures: ["chart", "news"], collapsedGroups: ["Research"] });
    restored.getState().resetVisibility(); expect(restored.getState()).toMatchObject({ density: "comfortable", favoriteFeatures: ["chart"], recentFeatures: ["chart", "news"], collapsedGroups: [] });
  });
});

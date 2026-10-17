import { normalizeSymbol } from "./symbol";

export const WIDGET_TYPES = ["quote", "chart", "watchlist", "news", "heatmap", "screener", "crypto", "macro", "options", "portfolio", "ai", "calendar", "insider", "tv", "recap", "comparison", "fundamentals", "journal", "performance", "strategy", "briefing", "alerts", "quality"] as const;
export type WidgetType = typeof WIDGET_TYPES[number];
export type WidgetInstance = { id: string; type: WidgetType; symbol?: string; linked: boolean };
export type LayoutItem = { i: string; x: number; y: number; w: number; h: number };
export type WorkspaceData = { activeSymbol: string; widgets: WidgetInstance[]; layout: LayoutItem[]; watchlist: string[] };
export type SavedWorkspace = WorkspaceData & { id: string; name: string };
export const MAX_WORKSPACES = 20;
export const PRESETS = { daily: "Daily market", research: "Company research", options: "Options analysis", blank: "Blank" };
export type Preset = keyof typeof PRESETS;
export const SIZE_BY_TYPE: Record<WidgetType, { w: number; h: number }> = {
  quality: { w: 12, h: 16 }, quote: { w: 5, h: 6 }, chart: { w: 7, h: 12 }, watchlist: { w: 4, h: 7 }, news: { w: 5, h: 8 },
  heatmap: { w: 7, h: 10 }, screener: { w: 12, h: 9 }, crypto: { w: 6, h: 9 }, macro: { w: 5, h: 7 },
  options: { w: 12, h: 9 }, portfolio: { w: 7, h: 8 }, ai: { w: 5, h: 10 }, calendar: { w: 12, h: 11 },
  insider: { w: 7, h: 9 }, tv: { w: 6, h: 11 }, recap: { w: 5, h: 12 }, comparison: { w: 8, h: 13 }, fundamentals: { w: 9, h: 15 }, journal: { w: 7, h: 15 }, performance: { w: 10, h: 19 }, strategy: { w: 10, h: 18 }, briefing: { w: 8, h: 19 }, alerts: { w: 10, h: 17 },
};
export const newId = () => crypto.randomUUID();
export function workspaceName(name: string): string {
  const value = name.trim();
  if (!value || value.length > 64) throw new Error("Use a workspace name between 1 and 64 characters.");
  return value;
}
export function makeWorkspace(name: string, preset: Preset = "daily"): SavedWorkspace {
  const types: WidgetType[] = preset === "research" ? ["chart", "quote", "news", "insider", "calendar"]
    : preset === "options" ? ["chart", "quote", "options"]
    : preset === "blank" ? [] : ["chart", "quote", "watchlist", "news", "macro"];
  const widgets = types.map((type) => ({ id: newId(), type, linked: !["watchlist", "macro", "calendar"].includes(type) }));
  const layout = widgets.map((w, i) => ({ i: w.id, x: i % 2 === 0 ? 0 : 7, y: Math.floor(i / 2) * 12, w: i % 2 === 0 ? 7 : 5, h: i < 2 ? 12 : 9 }));
  if (preset === "options" && layout[2]) layout[2].w = 12;
  return { id: newId(), name: workspaceName(name), activeSymbol: "AAPL", widgets, layout, watchlist: ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY"] };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace file.");
  return value as Record<string, unknown>;
}
export function readWorkspace(value: unknown): SavedWorkspace {
  const raw = object(value);
  const name = workspaceName(typeof raw.name === "string" ? raw.name : "Imported workspace");
  const symbol = typeof raw.activeSymbol === "string" ? normalizeSymbol(raw.activeSymbol) : null;
  if (!symbol || !Array.isArray(raw.widgets) || raw.widgets.length > 50 || !Array.isArray(raw.layout) || !Array.isArray(raw.watchlist) || raw.watchlist.length > 200) throw new Error("Invalid workspace contents or size.");
  const ids = new Set<string>();
  const widgets = raw.widgets.map((value): WidgetInstance => {
    const w = object(value);
    if (typeof w.id !== "string" || !w.id || w.id.length > 100 || ids.has(w.id) || !WIDGET_TYPES.includes(w.type as WidgetType) || typeof w.linked !== "boolean") throw new Error("Invalid or duplicate widget.");
    const ownSymbol = w.symbol === undefined ? undefined : typeof w.symbol === "string" ? normalizeSymbol(w.symbol) : null;
    if (ownSymbol === null) throw new Error("Invalid widget symbol.");
    ids.add(w.id);
    return { id: w.id, type: w.type as WidgetType, linked: w.linked, ...(ownSymbol ? { symbol: ownSymbol } : {}) };
  });
  const placed = new Set<string>();
  const layout = raw.layout.map((value): LayoutItem => {
    const l = object(value);
    const { i, x, y, w, h } = l;
    if (typeof i !== "string" || !ids.has(i) || placed.has(i) || ![x, y, w, h].every(Number.isInteger)
      || Number(x) < 0 || Number(y) < 0 || Number(y) > 10000 || Number(w) < 1 || Number(h) < 1 || Number(h) > 100 || Number(x) + Number(w) > 12) throw new Error("Invalid widget layout.");
    placed.add(i);
    return { i, x: Number(x), y: Number(y), w: Number(w), h: Number(h) };
  });
  if (placed.size !== ids.size) throw new Error("Every widget needs a layout position.");
  const watchlist = raw.watchlist.map((s) => typeof s === "string" ? normalizeSymbol(s) : null);
  if (watchlist.some((s) => !s)) throw new Error("Invalid watchlist symbol.");
  return { id: newId(), name, activeSymbol: symbol, widgets, layout, watchlist: [...new Set(watchlist as string[])] };
}
export function exportWorkspace(workspace: SavedWorkspace): string {
  return JSON.stringify({ format: "openterminal-workspace", version: 1, workspace }, null, 2);
}
export function importWorkspace(text: string): SavedWorkspace {
  if (text.length > 262144) throw new Error("Workspace files must be smaller than 256 KB.");
  const data = object(JSON.parse(text));
  if (data.format !== "openterminal-workspace" || data.version !== 1) throw new Error("Unsupported workspace file.");
  return readWorkspace(data.workspace);
}
export function restoreWorkspaces(value: unknown): { workspaces: SavedWorkspace[]; activeWorkspaceId: string } {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const workspaces: SavedWorkspace[] = [];
  let activeWorkspaceId = "";
  if (Array.isArray(raw.workspaces)) {
    for (const candidate of raw.workspaces.slice(0, MAX_WORKSPACES)) {
      try {
        const restored = readWorkspace(candidate);
        if (object(candidate).id === raw.activeWorkspaceId) activeWorkspaceId = restored.id;
        workspaces.push(restored);
      } catch { /* Keep other valid workspaces if one saved entry is corrupt. */ }
    }
  } else if (Array.isArray(raw.widgets)) {
    try { workspaces.push(readWorkspace({ ...raw, name: "My workspace" })); } catch { /* Use defaults for invalid legacy data. */ }
  }
  if (!workspaces.length) workspaces.push(makeWorkspace("My workspace"));
  return { workspaces, activeWorkspaceId: activeWorkspaceId || workspaces[0].id };
}

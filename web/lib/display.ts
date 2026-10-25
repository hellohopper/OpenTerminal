import { WIDGET_TYPES, type WidgetType, type LayoutItem } from "./workspaces";
import { WIDGET_GROUPS } from "./widget-catalog";

export const DEFAULT_FONT_SIZE = 12;
export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 20;
export const REFRESH_INTERVALS = [0, 1000, 5000, 15000, 30000] as const;
export function normalizeRefreshInterval(value: unknown) {
  return REFRESH_INTERVALS.includes(value as typeof REFRESH_INTERVALS[number]) ? value as typeof REFRESH_INTERVALS[number] : 5000;
}
export function pollingInterval(interval: number, visible: boolean, active = true, minimum = 0): number | false {
  if (!active || interval === 0) return false;
  return Math.max(interval, minimum, visible ? 0 : 60_000);
}
export function managedPollingInterval(configured: number, requested: number | false | undefined, active: boolean, failures = 0): number | false {
  if (!active || configured === 0 || !requested) return false;
  const minimum = Math.max(configured, requested);
  return Math.max(minimum, Math.min(60_000, minimum * 2 ** Math.min(4, Math.max(0, failures))));
}

export type DisplayPreferences = {
  language: "en" | "zh";
  fontSize: number;
  density: "compact" | "standard" | "comfortable";
  refreshInterval: number;
  hideEmptyQuoteFields: boolean;
  favoriteFeatures: WidgetType[];
  recentFeatures: WidgetType[];
  collapsedGroups: string[];
  sidebarVisible: boolean;
  workspaceBarVisible: boolean;
  hiddenSidebarFeatures: WidgetType[];
  hiddenPanels: Record<string, string[]>;
};

export const defaultDisplayPreferences = (): DisplayPreferences => ({
  language: "en",
  fontSize: DEFAULT_FONT_SIZE,
  density: "standard",
  refreshInterval: 5000,
  hideEmptyQuoteFields: true,
  favoriteFeatures: [],
  recentFeatures: [],
  collapsedGroups: [],
  sidebarVisible: true,
  workspaceBarVisible: true,
  hiddenSidebarFeatures: [],
  hiddenPanels: {},
});

export function normalizeFontSize(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)))
    : DEFAULT_FONT_SIZE;
}

export function readDisplayPreferences(value: unknown): DisplayPreferences {
  const defaults = defaultDisplayPreferences();
  if (!value || typeof value !== "object") return defaults;
  const saved = value as Record<string, unknown>;
  const hiddenSidebarFeatures = saved.hiddenSidebarFeatures;
  const hiddenPanels = saved.hiddenPanels && typeof saved.hiddenPanels === "object"
    ? Object.fromEntries(Object.entries(saved.hiddenPanels).filter(([id, ids]) =>
      id.length > 0 && id.length <= 100 && Array.isArray(ids),
    ).map(([id, ids]) => [id, [...new Set((ids as unknown[]).filter((item): item is string =>
      typeof item === "string" && item.length > 0 && item.length <= 100,
    ))].slice(0, 50)])) : {};
  return {
    language: saved.language === "zh" ? "zh" : "en",
    fontSize: normalizeFontSize(saved.fontSize),
    density: saved.density === "compact" || saved.density === "comfortable" ? saved.density : "standard",
    refreshInterval: normalizeRefreshInterval(saved.refreshInterval),
    hideEmptyQuoteFields: typeof saved.hideEmptyQuoteFields === "boolean" ? saved.hideEmptyQuoteFields : true,
    favoriteFeatures: WIDGET_TYPES.filter(type => Array.isArray(saved.favoriteFeatures) && saved.favoriteFeatures.includes(type)),
    recentFeatures: Array.isArray(saved.recentFeatures) ? [...new Set(saved.recentFeatures.filter((type): type is WidgetType => WIDGET_TYPES.includes(type)))].slice(0, 5) : [],
    collapsedGroups: WIDGET_GROUPS.filter(group => Array.isArray(saved.collapsedGroups) && saved.collapsedGroups.includes(group)),
    sidebarVisible: typeof saved.sidebarVisible === "boolean" ? saved.sidebarVisible : true,
    workspaceBarVisible: typeof saved.workspaceBarVisible === "boolean" ? saved.workspaceBarVisible : true,
    hiddenSidebarFeatures: Array.isArray(hiddenSidebarFeatures)
      ? WIDGET_TYPES.filter((type) => hiddenSidebarFeatures.includes(type))
      : [],
    hiddenPanels,
  };
}

/** Keep hidden panels' saved positions when the visible panels are rearranged. */
export function mergeVisibleLayout(saved: LayoutItem[], visible: LayoutItem[]): LayoutItem[] {
  const updates = new Map(visible.map(({ i, x, y, w, h }) => [i, { i, x, y, w, h }]));
  return saved.map((item) => updates.get(item.i) ?? item);
}

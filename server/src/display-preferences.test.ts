import { describe, expect, it } from "vitest";
import { createDisplayStore } from "../../web/store/display";
import { createTerminalStore } from "../../web/store/terminal";
import { mergeVisibleLayout, readDisplayPreferences } from "../../web/lib/display";

function memoryStorage(initial?: string) {
  const values = new Map(initial ? [["openterminal-display", initial]] : []);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("UI display preferences", () => {
  it("loads existing font preferences with every visibility option enabled", async () => {
    const store = createDisplayStore(memoryStorage(JSON.stringify({ state: { fontSize: 16 }, version: 0 })));
    await store.persist.rehydrate();
    expect(store.getState()).toMatchObject({ fontSize: 16, sidebarVisible: true, workspaceBarVisible: true, hiddenPanels: {}, hiddenSidebarFeatures: [] });
  });

  it("persists sidebar and per-workspace panel choices without removing panel data", async () => {
    const storage = memoryStorage();
    const display = createDisplayStore(storage);
    const terminal = createTerminalStore(memoryStorage());
    const first = terminal.getState().activeWorkspaceId;
    const firstWidget = terminal.getState().widgets[0];
    const firstLayout = terminal.getState().layout;
    display.getState().setFontSize(18);
    display.getState().setSidebarVisible(false);
    display.getState().setWorkspaceBarVisible(false);
    display.getState().setSidebarFeaturesVisible(["news", "ai"], false);
    display.getState().setPanelsVisible(first, [firstWidget.id], false);
    terminal.getState().duplicateWorkspace();
    const second = terminal.getState().activeWorkspaceId;
    // A duplicated workspace can reuse widget IDs; visibility still belongs to its workspace.
    expect(display.getState().hiddenPanels[second]).toBeUndefined();
    display.getState().setPanelsVisible(second, [firstWidget.id], false);
    display.getState().setPanelsVisible(second, [firstWidget.id], true);
    expect(display.getState().hiddenPanels[first]).toEqual([firstWidget.id]);
    terminal.getState().switchWorkspace(first);
    expect(terminal.getState().widgets).toContainEqual(firstWidget);
    expect(terminal.getState().layout).toEqual(firstLayout);

    const reloaded = createDisplayStore(storage);
    await reloaded.persist.rehydrate();
    expect(reloaded.getState()).toMatchObject({ fontSize: 18, sidebarVisible: false, workspaceBarVisible: false, hiddenSidebarFeatures: ["news", "ai"] });
    expect(reloaded.getState().hiddenPanels[first]).toEqual([firstWidget.id]);
    reloaded.getState().resetVisibility();
    expect(reloaded.getState()).toMatchObject({ fontSize: 18, sidebarVisible: true, workspaceBarVisible: true, hiddenPanels: {}, hiddenSidebarFeatures: [] });
  });

  it("ignores invalid saved visibility values and unknown feature types", () => {
    expect(readDisplayPreferences({ fontSize: Infinity, sidebarVisible: "false", workspaceBarVisible: false, hiddenSidebarFeatures: ["news", "news", "unknown"], hiddenPanels: { first: ["chart", "chart", null, ""], bad: false } })).toEqual({ fontSize: 12, sidebarVisible: true, workspaceBarVisible: false, hiddenSidebarFeatures: ["news"], hiddenPanels: { first: ["chart"] } });
  });

  it("merges visible panel moves while preserving hidden positions and source data", () => {
    const saved = [{ i: "chart", x: 0, y: 0, w: 7, h: 12 }, { i: "quote", x: 7, y: 0, w: 5, h: 12 }];
    const visible = [{ i: "quote", x: 0, y: 2, w: 6, h: 14 }];
    const merged = mergeVisibleLayout(saved, visible);
    expect(merged).toEqual([saved[0], visible[0]]);
    expect(saved[1]).toMatchObject({ x: 7, y: 0, w: 5, h: 12 });
  });
});

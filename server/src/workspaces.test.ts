import { describe, expect, it } from "vitest";
import { createTerminalStore } from "../../web/store/terminal";
import { exportWorkspace, importWorkspace, makeWorkspace, restoreWorkspaces } from "../../web/lib/workspaces";

function memoryStorage(initial?: string) {
  const values = new Map(initial ? [["openterminal-workspace", initial]] : []);
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe("workspaces", () => {
  it("keeps symbols, layouts and watchlists separate when switching", () => {
    const store = createTerminalStore(memoryStorage());
    const first = store.getState().activeWorkspaceId;
    store.getState().setActiveSymbol("MSFT");
    store.getState().createWorkspace("Options", "options");
    const second = store.getState().activeWorkspaceId;
    store.getState().setActiveSymbol("NVDA");
    store.getState().addToWatchlist("IBM");
    store.getState().removeWidget(store.getState().widgets[0].id);
    store.getState().switchWorkspace(first);
    expect(store.getState().activeSymbol).toBe("MSFT");
    expect(store.getState().watchlist).not.toContain("IBM");
    expect(store.getState().widgets).toHaveLength(5);
    store.getState().switchWorkspace(second);
    expect(store.getState().activeSymbol).toBe("NVDA");
    expect(store.getState().widgets).toHaveLength(2);
  });
  it("persists edits and selected workspace across reloads", () => {
    const storage = memoryStorage();
    const store = createTerminalStore(storage);
    store.getState().createWorkspace("Research", "research");
    store.getState().setActiveSymbol("IBM");
    const reloaded = createTerminalStore(storage);
    expect(reloaded.getState().activeSymbol).toBe("IBM");
    expect(reloaded.getState().workspaces.find((w) => w.id === reloaded.getState().activeWorkspaceId)?.name).toBe("Research");
    expect(reloaded.getState().workspaces).toHaveLength(2);
  });
  it("migrates legacy layouts without losing positions or symbols", () => {
    const legacy = { ...makeWorkspace("Legacy"), activeSymbol: "TSLA" };
    const storage = memoryStorage(JSON.stringify({ version: 0, state: legacy }));
    const store = createTerminalStore(storage);
    expect(store.getState().activeSymbol).toBe("TSLA");
    expect(store.getState().layout).toEqual(legacy.layout);
    expect(store.getState().widgets).toEqual(legacy.widgets);
  });
  it("duplicates independently and prevents deleting the final workspace", () => {
    const store = createTerminalStore(memoryStorage());
    store.getState().duplicateWorkspace();
    store.getState().removeWidget(store.getState().widgets[0].id);
    expect(store.getState().workspaces[0].widgets).toHaveLength(5);
    store.getState().deleteWorkspace();
    expect(() => store.getState().deleteWorkspace()).toThrow("at least one");
  });
  it("round-trips exports and rejects unsupported widgets, duplicate ids and invalid geometry", () => {
    const workspace = makeWorkspace("Research", "research");
    const imported = importWorkspace(exportWorkspace(workspace));
    expect(imported.layout).toEqual(workspace.layout);
    expect(imported.id).not.toBe(workspace.id);
    for (const bad of [
      { ...workspace, widgets: [{ ...workspace.widgets[0], type: "script" }] },
      { ...workspace, widgets: [workspace.widgets[0], workspace.widgets[0]] },
      { ...workspace, layout: [{ ...workspace.layout[0], x: -1 }] },
    ]) expect(() => importWorkspace(JSON.stringify({ format: "openterminal-workspace", version: 1, workspace: bad }))).toThrow();
    expect(() => importWorkspace('{"format":"other","version":1}')).toThrow();
    expect(restoreWorkspaces({ workspaces: [null] }).workspaces).toHaveLength(1);
  });
});

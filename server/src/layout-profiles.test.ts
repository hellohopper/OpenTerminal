import { describe, it, expect } from "vitest";
import { createTerminalStore } from "../../web/store/terminal";
import { createDisplayStore } from "../../web/store/display";
import { exportWorkspace, importWorkspace } from "../../web/lib/workspaces";
import { readDeviceSnapshot, describeSyncChanges } from "../../web/lib/device-sync";

const memory = () => { const values = new Map<string, string>(); return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } }; };
describe("named layout profiles", () => {
  it("restores sidebar and panel visibility while keeping device appearance local by default", () => {
    const display = createDisplayStore(memory()), terminal = createTerminalStore(memory(), display);
    const original = terminal.getState().activeWorkspaceId, panel = terminal.getState().widgets[0].id;
    display.getState().setPanelsVisible(original, [panel], false);
    display.getState().setSidebarVisible(false);
    terminal.getState().saveWorkspaceAs("Quiet", false);
    expect(display.getState().hiddenPanels[terminal.getState().activeWorkspaceId]).toEqual([panel]);
    display.getState().setSidebarVisible(true);
    display.getState().setFontSize(18);
    terminal.getState().switchWorkspace(original);
    expect(display.getState().sidebarVisible).toBe(false);
    expect(display.getState().fontSize).toBe(18);
    expect(display.getState().hiddenPanels[original]).toEqual([panel]);
  });
  it("round trips optional appearance through exports, reload and device sync and locks each selected layout", () => {
    const display = createDisplayStore(memory()), storage = memory(), terminal = createTerminalStore(storage, display);
    display.getState().setFontSize(20); display.getState().setLanguage("zh");
    terminal.getState().saveWorkspaceAs("Reading", true);
    const current = terminal.getState().workspaces.at(-1)!;
    const imported = importWorkspace(exportWorkspace(current));
    expect(imported.presentation?.appearance).toEqual({ fontSize: 20, language: "zh", density: "standard" });
    const snap = readDeviceSnapshot({ format: "openterminal-device", version: 1, workspace: { workspaces: [current], activeWorkspaceId: current.id }, preferences: { groups: [], screeners: [] }, drawings: {} });
    expect(snap.workspace.workspaces[0].presentation).toEqual(current.presentation);
    const changed = { ...snap, workspace: { ...snap.workspace, workspaces: [{ ...current, presentation: { ...current.presentation!, sidebarVisible: false } }] } };
    expect(describeSyncChanges(snap, changed)[0].status).toBe("Changed");
    const reloaded = createTerminalStore(storage, display);
    display.getState().setFontSize(12); reloaded.getState().restorePresentation();
    expect(display.getState().fontSize).toBe(20);
    terminal.getState().setLayoutEditing(true); terminal.getState().switchWorkspace(terminal.getState().workspaces[0].id);
    expect(terminal.getState().layoutEditing).toBe(false);
  });
  it("bounds imported profile values and drops references to missing panels", () => {
    const terminal = createTerminalStore(memory());
    const current = terminal.getState().workspaces[0];
    const imported = importWorkspace(JSON.stringify({ format: "openterminal-workspace", version: 1, workspace: { ...current, presentation: { hiddenPanelIds: ["missing", current.widgets[0].id], hiddenSidebarFeatures: ["fake", "chart"], appearance: { fontSize: 500 } } } }));
    expect(imported.presentation?.hiddenPanelIds).toEqual([current.widgets[0].id]);
    expect(imported.presentation?.hiddenSidebarFeatures).toEqual(["chart"]);
    expect(imported.presentation?.appearance?.fontSize).toBe(20);
  });
});

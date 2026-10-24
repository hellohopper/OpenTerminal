import { readDisplayPreferences, type DisplayPreferences } from "./display";
import {
  readWorkspace,
  MAX_WORKSPACES,
  type SavedWorkspace,
} from "./workspaces";
import { readPreferences, type Preferences } from "./preferences";
import { parseDrawings } from "./chart-tools";
export type DeviceSnapshot = {
  format: "openterminal-device";
  version: 1;
  workspace: { workspaces: SavedWorkspace[]; activeWorkspaceId: string };
  preferences: Preferences;
  drawings: Record<string, string>;
  display?: DisplayPreferences;
};
export const SYNC_VERSION_KEY = "openterminal-sync-version";
export function readDeviceSnapshot(raw: unknown): DeviceSnapshot {
  const v = raw as DeviceSnapshot;
  if (
    !v ||
    v.format !== "openterminal-device" ||
    v.version !== 1 ||
    !v.workspace ||
    !Array.isArray(v.workspace.workspaces) ||
    !v.workspace.workspaces.length ||
    v.workspace.workspaces.length > MAX_WORKSPACES
  )
    throw new Error("Invalid device snapshot.");
  const ids = new Set<string>();
  const workspaces = v.workspace.workspaces.map((w) => {
    if (typeof w.id !== "string" || !w.id || w.id.length > 100 || ids.has(w.id))
      throw new Error("Invalid workspace ID.");
    ids.add(w.id);
    return { ...readWorkspace(w), id: w.id };
  });
  if (!ids.has(v.workspace.activeWorkspaceId))
    throw new Error("Active workspace is missing.");
  if (
    !v.drawings ||
    typeof v.drawings !== "object" ||
    Array.isArray(v.drawings) ||
    Object.keys(v.drawings).length > 500
  )
    throw new Error("Invalid chart drawings.");
  const drawings: Record<string, string> = {};
  for (const [key, value] of Object.entries(v.drawings)) {
    if (
      !key.startsWith("openterminal-drawings-v1:") ||
      key.length > 240 ||
      typeof value !== "string" ||
      value.length > 65536
    )
      throw new Error("Invalid chart drawings.");
    const array = JSON.parse(value);
    if (!Array.isArray(array) || parseDrawings(value).length !== array.length)
      throw new Error("Invalid chart drawing data.");
    drawings[key] = JSON.stringify(parseDrawings(value));
  }
  return {
    format: v.format,
    version: 1,
    workspace: { workspaces, activeWorkspaceId: v.workspace.activeWorkspaceId },
    preferences: readPreferences(v.preferences),
    ...(v.display ? { display: readDisplayPreferences(v.display) } : {}),
    drawings,
  };
}
export function applyDeviceSnapshot(
  snapshot: DeviceSnapshot,
  version: string,
  storage: Storage,
) {
  const valid = readDeviceSnapshot(snapshot);
  const keys = [
    "openterminal-workspace",
    "openterminal-preferences",
    SYNC_VERSION_KEY,
    ...(valid.display ? ["openterminal-display"] : []),
    ...Object.keys(storage).filter((k) =>
      k.startsWith("openterminal-drawings-v1:"),
    ),
    ...Object.keys(valid.drawings),
  ];
  const old = new Map([...new Set(keys)].map((k) => [k, storage.getItem(k)]));
  try {
    for (const key of old.keys())
      if (key.startsWith("openterminal-drawings-v1:")) storage.removeItem(key);
    storage.setItem(
      "openterminal-workspace",
      JSON.stringify({ version: 1, state: valid.workspace }),
    );
    storage.setItem(
      "openterminal-preferences",
      JSON.stringify({ version: 1, state: { data: valid.preferences } }),
    );
    if (valid.display) storage.setItem("openterminal-display", JSON.stringify({ state: valid.display, version: 0 }));
    for (const [key, value] of Object.entries(valid.drawings))
      storage.setItem(key, value);
    storage.setItem(SYNC_VERSION_KEY, version);
  } catch (error) {
    // Free all partially written values before restoring the old snapshot.
    // Restoring large old entries first can otherwise exceed the same quota.
    for (const key of old.keys()) storage.removeItem(key);
    for (const [key, value] of old) if (value !== null) storage.setItem(key, value);
    throw error;
  }
}

export type SyncScope = { workspaceIds: string[] | null; includePreferences: boolean; includeDisplay?: boolean };
/** Selective sync upserts only chosen IDs; it never removes unselected workspaces. */
export function mergeDeviceSnapshots(source: DeviceSnapshot, target: DeviceSnapshot, scope: SyncScope): DeviceSnapshot {
  const from = readDeviceSnapshot(source), to = readDeviceSnapshot(target);
  if (scope.workspaceIds === null) return { ...from, display: scope.includeDisplay ? from.display ?? to.display : to.display };
  const ids = new Set(scope.workspaceIds);
  if (!ids.size || [...ids].some(id => !from.workspace.workspaces.some(w => w.id === id)))
    throw new Error("Select at least one existing source workspace.");
  const selected = from.workspace.workspaces.filter(w => ids.has(w.id));
  const byId = new Map(selected.map(w => [w.id, w]));
  const workspaces = [...to.workspace.workspaces.map(w => byId.get(w.id) ?? w), ...selected.filter(w => !to.workspace.workspaces.some(old => old.id === w.id))];
  if (workspaces.length > MAX_WORKSPACES) throw new Error(`The result exceeds ${MAX_WORKSPACES} workspaces.`);
  // Drawings belong to widget IDs. Remove only drawings belonging to replaced panels.
  const widgetIds = new Set([...selected, ...to.workspace.workspaces.filter(w => ids.has(w.id))].flatMap(w => w.widgets.map(p => p.id)));
  // Duplicated/imported workspaces may share widget IDs (and therefore drawing keys).
  // Preserve drawings referenced by an unselected destination workspace.
  const protectedIds = new Set(to.workspace.workspaces.filter(w => !ids.has(w.id)).flatMap(w => w.widgets.map(p => p.id)));
  const belongs = (key: string) => [...widgetIds].filter(id => !protectedIds.has(id)).some(id => key.startsWith(`openterminal-drawings-v1:${id}:`));
  const drawings = Object.fromEntries([
    ...Object.entries(to.drawings).filter(([key]) => !belongs(key)),
    ...Object.entries(from.drawings).filter(([key]) => belongs(key)),
  ]);
  return readDeviceSnapshot({ ...to, workspace: { workspaces, activeWorkspaceId: to.workspace.activeWorkspaceId }, preferences: scope.includePreferences ? from.preferences : to.preferences, display: scope.includeDisplay && from.display ? { ...from.display, hiddenPanels: { ...to.display?.hiddenPanels, ...Object.fromEntries(selected.map(w => [w.id, from.display!.hiddenPanels[w.id] ?? []])) } } : to.display, drawings });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const sameSnapshot = (a: DeviceSnapshot, b: DeviceSnapshot) => canonical(a) === canonical(b);
export function describeSyncChanges(before: DeviceSnapshot | null, after: DeviceSnapshot) {
  const changes: { name: string; status: "Added" | "Removed" | "Changed" | "Unchanged"; detail: string }[] = [];
  const old = before?.workspace.workspaces ?? [], next = after.workspace.workspaces;
  for (const id of new Set([...old, ...next].map(w => w.id))) {
    const a = old.find(w => w.id === id), b = next.find(w => w.id === id);
    const fields = a && b ? (["name", "activeSymbol", "watchlist", "widgets", "layout", "presentation", "simpleCards"] as const).filter(k => canonical(a[k]) !== canonical(b[k])) : [];
    changes.push({ name: b?.name ?? a!.name, status: !a ? "Added" : !b ? "Removed" : fields.length ? "Changed" : "Unchanged", detail: fields.length ? fields.map(k => k === "watchlist" ? `watchlist: ${a!.watchlist.join(", ") || "empty"} → ${b!.watchlist.join(", ") || "empty"}` : k === "name" ? `name: ${a!.name} → ${b!.name}` : k === "widgets" ? `panels: ${a!.widgets.map(p => p.type).join(", ")} → ${b!.widgets.map(p => p.type).join(", ")}` : k === "activeSymbol" ? `symbol: ${a!.activeSymbol} → ${b!.activeSymbol}` : "panel layout").join(" · ") : `${(b ?? a)!.widgets.length} panels · watchlist: ${(b ?? a)!.watchlist.join(", ") || "empty"}` });
  }
  if (before && canonical(old.map(w => w.id)) !== canonical(next.map(w => w.id)))
    changes.push({ name: "Workspace order", status: "Changed", detail: next.map(w => w.name).join(" → ") });
  if (before?.workspace.activeWorkspaceId !== after.workspace.activeWorkspaceId)
    changes.push({ name: "Active workspace", status: "Changed", detail: next.find(w => w.id === after.workspace.activeWorkspaceId)!.name });
  for (const kind of ["groups", "screeners"] as const) {
    const a = before?.preferences[kind] ?? [], b = after.preferences[kind];
    changes.push({ name: kind === "groups" ? "Watchlist groups" : "Screener presets", status: canonical(a) === canonical(b) ? "Unchanged" : "Changed", detail: `${a.length} → ${b.length}: ${b.map(v => v.name).join(", ") || "none"}` });
  }
  if (canonical(before?.display) !== canonical(after.display)) changes.push({ name: "UI preferences", status: "Changed", detail: `Language ${before?.display?.language ?? "device default"} → ${after.display?.language ?? "device default"}; font ${before?.display?.fontSize ?? "device default"} → ${after.display?.fontSize ?? "device default"}; density ${after.display?.density ?? "device default"}; favorites ${after.display?.favoriteFeatures.join(", ") || "none"}; panel visibility included` });
  const keys = new Set([...Object.keys(before?.drawings ?? {}), ...Object.keys(after.drawings)]);
  const changed = [...keys].filter(key => before?.drawings[key] !== after.drawings[key]);
  changes.push({ name: "Chart drawings", status: changed.length ? "Changed" : "Unchanged", detail: `${changed.length} chart(s) changed · ${Object.keys(before?.drawings ?? {}).length} → ${Object.keys(after.drawings).length} saved charts` });
  return changes;
}

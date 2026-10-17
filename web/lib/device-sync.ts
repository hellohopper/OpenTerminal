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
    for (const [key, value] of Object.entries(valid.drawings))
      storage.setItem(key, value);
    storage.setItem(SYNC_VERSION_KEY, version);
  } catch (error) {
    for (const [key, value] of old) {
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    throw error;
  }
}

"use client";
import {useTerminal} from "../store/terminal";
import {usePreferences} from "../store/preferences";
import {useDisplay} from "../store/display";
import {readDeviceSnapshot,type DeviceSnapshot} from "./device-sync";
export function captureDevice(): DeviceSnapshot {
  const s = useTerminal.getState(), drawings: Record<string, string> = {};
  for (const key of Object.keys(localStorage)) if (key.startsWith("openterminal-drawings-v1:")) drawings[key] = localStorage.getItem(key)!;
  return readDeviceSnapshot({ format: "openterminal-device", version: 1, workspace: { workspaces: s.workspaces, activeWorkspaceId: s.activeWorkspaceId }, preferences: usePreferences.getState().data, display: useDisplay.getState(), drawings });
}

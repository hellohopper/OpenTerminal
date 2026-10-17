"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import { usePreferences } from "../../store/preferences";
import {
  readDeviceSnapshot,
  applyDeviceSnapshot,
  SYNC_VERSION_KEY,
  type DeviceSnapshot,
} from "../../lib/device-sync";
type Snapshot = { payload: DeviceSnapshot; version: string; updatedAt: string };
export default function SyncWidget() {
  const [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { data: remote, isLoading } = useQuery({
    queryKey: ["device-sync"],
    queryFn: () => apiGet<Snapshot | null>("/api/sync"),
  });
  const action = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-2 space-y-3">
      <p>
        Sync workspaces, watchlists, saved screeners and chart drawings between
        browsers signed in to this same server.
      </p>
      <p className="dim">
        Manual owner-wide snapshot. Upload replaces the server snapshot;
        download replaces this device’s layouts and preferences. Server
        portfolios and journal already share the database. Session cookies and
        notification permissions remain device-specific.
      </p>
      <p>
        Server snapshot:{" "}
        {isLoading ? "Loading…" : remote ? remote.updatedAt : "None"}
      </p>
      <button
        className="term-btn"
        disabled={busy || isLoading}
        onClick={() =>
          action(async () => {
            const s = useTerminal.getState();
            const drawings: Record<string, string> = {};
            for (const key of Object.keys(localStorage))
              if (key.startsWith("openterminal-drawings-v1:"))
                drawings[key] = localStorage.getItem(key)!;
            const payload = readDeviceSnapshot({
              format: "openterminal-device",
              version: 1,
              workspace: {
                workspaces: s.workspaces,
                activeWorkspaceId: s.activeWorkspaceId,
              },
              preferences: usePreferences.getState().data,
              drawings,
            });
            const result = await apiPost<{ version: string }>("/api/sync", {
              payload,
              baseVersion: localStorage.getItem(SYNC_VERSION_KEY),
            });
            localStorage.setItem(SYNC_VERSION_KEY, result.version);
            setMessage("Device snapshot uploaded.");
            await qc.invalidateQueries({ queryKey: ["device-sync"] });
          })
        }
      >
        Upload this device
      </button>
      <label className="block">
        <input
          type="checkbox"
          checked={confirm}
          onChange={(e) => setConfirm(e.target.checked)}
        />{" "}
        Replace this device with the server snapshot
      </label>
      <button
        className="term-btn"
        disabled={!confirm || busy || !remote}
        onClick={() =>
          action(async () => {
            const latest = await apiGet<Snapshot | null>("/api/sync");
            if (!latest) throw new Error("No snapshot on server.");
            applyDeviceSnapshot(latest.payload, latest.version, localStorage);
            window.location.reload();
          })
        }
      >
        Download to this device
      </button>
      {message && (
        <p role="status" className="amber">
          {message}
        </p>
      )}
    </div>
  );
}

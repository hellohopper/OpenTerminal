"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import { usePreferences } from "../../store/preferences";
import { readDeviceSnapshot, applyDeviceSnapshot, mergeDeviceSnapshots, describeSyncChanges, sameSnapshot, SYNC_VERSION_KEY, type DeviceSnapshot } from "../../lib/device-sync";
type Snapshot = { payload: DeviceSnapshot; version: string; updatedAt: string };
type Preview = { entire: boolean; direction: "upload" | "download" | "restore"; local: DeviceSnapshot; before: DeviceSnapshot | null; after: DeviceSnapshot; baseVersion: string | null; restoreVersion?: string };
function capture(): DeviceSnapshot {
  const s = useTerminal.getState(), drawings: Record<string, string> = {};
  for (const key of Object.keys(localStorage)) if (key.startsWith("openterminal-drawings-v1:")) drawings[key] = localStorage.getItem(key)!;
  return readDeviceSnapshot({ format: "openterminal-device", version: 1, workspace: { workspaces: s.workspaces, activeWorkspaceId: s.activeWorkspaceId }, preferences: usePreferences.getState().data, drawings });
}
export default function SyncWidget() {
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [confirmed, setConfirmed] = useState(false);
  const [scope, setScope] = useState<"all" | "selected">("all"), [selected, setSelected] = useState<string[]>([]), [preferences, setPreferences] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null), [savedVersion, setSavedVersion] = useState("");
  const workspaces = useTerminal(s => s.workspaces);
  const qc = useQueryClient();
  const remote = useQuery({ queryKey: ["device-sync"], queryFn: () => apiGet<Snapshot | null>("/api/sync") });
  const history = useQuery({ queryKey: ["device-sync-history"], queryFn: () => apiGet<Omit<Snapshot, "payload">[]>("/api/sync/history") });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage("");
    try { await fn(); } catch (e) { setMessage((e as Error).message); setPreview(null); setConfirmed(false); }
    finally { setBusy(false); }
  };
  const review = (direction: Preview["direction"]) => run(async () => {
    const latest = await apiGet<Snapshot | null>("/api/sync"), local = capture();
    qc.setQueryData(["device-sync"], latest);
    let before: DeviceSnapshot | null, after: DeviceSnapshot;
    if (direction === "restore") {
      if (!savedVersion) throw new Error("Select a historical version.");
      const saved = await apiGet<Snapshot>(`/api/sync/history/${encodeURIComponent(savedVersion)}`);
      before = latest ? readDeviceSnapshot(latest.payload) : null; after = readDeviceSnapshot(saved.payload);
    } else {
      const source = direction === "upload" ? local : latest ? readDeviceSnapshot(latest.payload) : null;
      if (!source) throw new Error("No snapshot on server.");
      before = direction === "upload" ? latest ? readDeviceSnapshot(latest.payload) : null : local;
      if (!before && scope === "selected") throw new Error("Upload an entire snapshot before using selective sync.");
      after = scope === "all" ? source : mergeDeviceSnapshots(source, before!, { workspaceIds: selected, includePreferences: preferences });
    }
    if (new TextEncoder().encode(JSON.stringify(after)).length > 2 * 1024 * 1024) throw new Error("Device snapshot exceeds 2 MB.");
    setPreview({ entire: scope === "all", direction, local, before, after, baseVersion: latest?.version ?? null, restoreVersion: direction === "restore" ? savedVersion : undefined });
    setConfirmed(false);
  });
  const apply = () => run(async () => {
    if (!preview || !confirmed) return;
    if (!sameSnapshot(capture(), preview.local)) throw new Error("Local data changed since preview. Review the changes again.");
    if (preview.direction === "download") {
      const latest = await apiGet<Snapshot | null>("/api/sync");
      if (latest?.version !== preview.baseVersion) throw new Error("Sync conflict: server changed since preview. Review again.");
      // Partial downloads do not acknowledge the entire remote snapshot.
      const version = preview.entire ? preview.baseVersion! : localStorage.getItem(SYNC_VERSION_KEY) ?? "";
      applyDeviceSnapshot(preview.after, version, localStorage);
      window.location.reload(); return;
    }
    const result = await apiPost<{ version: string }>(preview.direction === "restore" ? "/api/sync/restore" : "/api/sync", preview.direction === "restore" ? { version: preview.restoreVersion, baseVersion: preview.baseVersion } : { payload: preview.after, baseVersion: preview.baseVersion });
    if (preview.direction === "upload") localStorage.setItem(SYNC_VERSION_KEY, result.version);
    setMessage(preview.direction === "restore" ? "Server version restored. Preview a download to apply it to this device." : "Device snapshot uploaded.");
    setPreview(null); setConfirmed(false);
    await Promise.all([qc.invalidateQueries({ queryKey: ["device-sync"] }), qc.invalidateQueries({ queryKey: ["device-sync-history"] })]);
  });
  const resetReview = () => { setPreview(null); setConfirmed(false); };
  const choices = new Map([...workspaces, ...(remote.data?.payload.workspace.workspaces ?? [])].map(w => [w.id, w]));
  return <div className="p-2 space-y-3">
    <p>Review changes before syncing. Selective sync replaces matching workspace IDs and keeps other workspaces. An entire snapshot replaces all layouts, preferences and drawings at the destination.</p>
    <p className="dim">Portfolios and journals already share the server database. Sessions and notification permissions are excluded. The last 10 server versions are retained.</p>
    {(remote.error || history.error) && <p role="alert" className="down">{(remote.error || history.error)?.message}</p>}
    <p>Server snapshot: {remote.isLoading ? "Loading…" : remote.data?.updatedAt ?? "None"}</p>
    <label>Sync scope <select aria-label="Sync scope" disabled={busy} value={scope} onChange={e => { setScope(e.target.value as typeof scope); resetReview(); }}><option value="all">Entire snapshot</option><option value="selected">Selected workspaces</option></select></label>
    {scope === "selected" && <fieldset className="space-y-1 border border-[var(--border)] p-2"><legend>Choose source workspaces</legend>
      {[...choices.values()].map(w => <label className="block" key={w.id}><input type="checkbox" disabled={busy} checked={selected.includes(w.id)} onChange={e => { setSelected(e.target.checked ? [...selected, w.id] : selected.filter(id => id !== w.id)); resetReview(); }} /> {w.name} <span className="dim">{w.id.slice(0,8)}</span></label>)}
      <label className="block"><input type="checkbox" disabled={busy} checked={preferences} onChange={e => { setPreferences(e.target.checked); resetReview(); }} /> Also replace shared watchlist groups and screener presets</label>
      <p className="dim">Only drawings for selected panels are included; drawings shared with an unselected destination workspace are kept. The destination’s active workspace is kept. Choose workspaces present on the source device/server.</p>
    </fieldset>}
    <div className="flex flex-wrap gap-2"><button className="term-btn" disabled={busy || remote.isLoading || !!remote.error} onClick={() => review("upload")}>Upload this device</button><button className="term-btn" disabled={busy || !remote.data} onClick={() => review("download")}>Download to this device</button></div>
    <details><summary className="amber cursor-pointer">Server version history</summary><p className="dim">Restoring creates a new server revision. Local layouts change only after a download.</p>
      <label>Saved version <select aria-label="Saved sync version" disabled={busy} value={savedVersion} onChange={e => { setSavedVersion(e.target.value); resetReview(); }}><option value="">Select version…</option>{history.data?.map(v => <option key={v.version} value={v.version}>{v.updatedAt} · {v.version.slice(0,8)}{v.version === remote.data?.version ? " (current)" : ""}</option>)}</select></label>
      <button className="term-btn" disabled={busy || !savedVersion} onClick={() => review("restore")}>Preview server restore</button>
    </details>
    {preview && <section aria-label="Sync change preview" className="border border-[var(--amber-dim)] p-2 space-y-2">
      <h3 className="amber">{preview.direction === "download" ? "Changes on this device" : "Changes on the server"}</h3>
      <p className="dim">Compared with server revision {preview.baseVersion?.slice(0,8) ?? "none"}. Changed fields and destination watchlists are listed below.</p>
      <table className="data-table"><thead><tr><th>Item</th><th>Change</th><th>Details</th></tr></thead><tbody>{describeSyncChanges(preview.before, preview.after).map((c,i) => <tr key={i}><td>{c.name}</td><td className={c.status === "Removed" ? "down" : c.status !== "Unchanged" ? "amber" : "dim"}>{c.status}</td><td className="!whitespace-normal">{c.detail}</td></tr>)}</tbody></table>
      <label className="block"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I reviewed these changes</label>
      <button className="term-btn" disabled={busy || !confirmed} onClick={apply}>{preview.direction === "upload" ? "Confirm upload" : preview.direction === "download" ? "Confirm download" : "Confirm server restore"}</button>
      <button className="term-btn" disabled={busy} onClick={resetReview}>Cancel preview</button>
    </section>}
    {message && <p role="status" className="amber">{message}</p>}
  </div>;
}

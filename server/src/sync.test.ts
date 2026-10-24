import { it, expect } from "vitest";
import { AppDatabase } from "./storage/database.js";
import { writeSync, readSync } from "./sync.js";
import { makeWorkspace } from "../../web/lib/workspaces.js";
import { readDeviceSnapshot,applyDeviceSnapshot } from "../../web/lib/device-sync.js";
import { createBackup, restoreBackup } from "./storage/backup.js";
it("rejects competing uploads and invalid snapshots; restore invalidates old versions", async () => {
  const db = await AppDatabase.open();
  try {
    const w = makeWorkspace("Device", "blank"),
      payload = readDeviceSnapshot({
        format: "openterminal-device",
        version: 1,
        workspace: { workspaces: [w], activeWorkspaceId: w.id },
        preferences: { groups: [], screeners: [] },
        drawings: {},
      });
    const first = await writeSync(db, payload, null);
    await expect(writeSync(db, payload, null)).rejects.toMatchObject({
      status: 409,
    });
    const second = await writeSync(db, payload, first.version);
    await expect(writeSync(db, payload, first.version)).rejects.toThrow(
      "conflict",
    );
    await expect(
      writeSync(db, { ...payload, version: 2 }, second.version),
    ).rejects.toThrow();
    const backup = await createBackup(db);
    await restoreBackup(db, backup);
    expect((await readSync(db))!.version).not.toBe(second.version);
    await expect(writeSync(db, payload, second.version)).rejects.toThrow(
      "conflict",
    );
    expect(() =>
      readDeviceSnapshot({
        ...payload,
        workspace: { ...payload.workspace, activeWorkspaceId: "missing" },
      }),
    ).toThrow();
  } finally {
    await db.close();
  }
});

it("rolls back all device keys after quota exhaustion without overwriting unrelated storage",()=>{
 const w=makeWorkspace("Incoming","blank"),drawing=JSON.stringify(Array.from({length:20},(_,i)=>({id:"x".repeat(50)+i,kind:"horizontal",price:100})));
 const payload=readDeviceSnapshot({format:"openterminal-device",version:1,workspace:{workspaces:[w],activeWorkspaceId:w.id},preferences:{groups:[],screeners:[]},drawings:{"openterminal-drawings-v1:a":drawing,"openterminal-drawings-v1:b":drawing}});
 const capacity=JSON.stringify({version:1,state:payload.workspace}).length+JSON.stringify({version:1,state:{data:payload.preferences}}).length+drawing.length+10;
 const values=new Map([["openterminal-workspace","x".repeat(capacity-5)],["unrelated","keep"]]),before=[...values];
 const storage={getItem:(key:string)=>values.get(key)??null,removeItem:(key:string)=>{values.delete(key);},setItem:(key:string,value:string)=>{const next=new Map(values);next.set(key,value);if([...next.values()].reduce((n,v)=>n+v.length,0)>capacity)throw new Error("quota");values.set(key,value);}} as Storage;
 expect(()=>applyDeviceSnapshot(payload,"new-version",storage)).toThrow("quota");
 expect([...values].sort()).toEqual(before.sort());
});

it("keeps ten server revisions, restores as a new revision and rejects racing restores", async () => {
  const { listSyncHistory, readSyncVersion, restoreSyncVersion } = await import("./sync.js");
  const db = await AppDatabase.open();
  try {
    const w = makeWorkspace("Original", "blank");
    const payload = readDeviceSnapshot({ format: "openterminal-device", version: 1, workspace: { workspaces: [w], activeWorkspaceId: w.id }, preferences: { groups: [], screeners: [] }, drawings: {} });
    let current = await writeSync(db, payload, null);
    const pruned = current.version;
    for (let i = 0; i < 11; i++) current = await writeSync(db, { ...payload, workspace: { ...payload.workspace, workspaces: [{ ...w, name: `Revision ${i}` }] } }, current.version);
    const history = await listSyncHistory(db);
    expect(history).toHaveLength(10);
    expect(await readSyncVersion(db, pruned)).toBeNull();
    const oldest = history.at(-1)!;
    const outcomes = await Promise.allSettled([restoreSyncVersion(db, oldest.version, current.version), restoreSyncVersion(db, oldest.version, current.version)]);
    expect(outcomes.filter(o => o.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(o => o.status === "rejected")).toHaveLength(1);
    const restored = (await readSync(db))!;
    expect(restored.version).not.toBe(oldest.version);
    expect(restored.payload.workspace.workspaces[0].name).toBe("Revision 1");
    const backup = await createBackup(db);
    await restoreBackup(db, backup);
    expect(await listSyncHistory(db)).toHaveLength(10);
    await expect(restoreSyncVersion(db, history[0].version, restored.version)).rejects.toMatchObject({ status: 409 });
    await expect(restoreSyncVersion(db, pruned, (await readSync(db))!.version)).rejects.toMatchObject({ status: 404 });
  } finally { await db.close(); }
});

it("selectively merges workspaces and their drawings without deleting local data", async () => {
  const { mergeDeviceSnapshots, describeSyncChanges } = await import("../../web/lib/device-sync.js");
  const a = makeWorkspace("Keep", "daily"), b = makeWorkspace("Replace", "daily"), c = makeWorkspace("Add", "blank");
  const keyA = `openterminal-drawings-v1:${a.widgets[0].id}:AAPL:1D`, keyB = `openterminal-drawings-v1:${b.widgets[0].id}:AAPL:1D`;
  const line = JSON.stringify([{ id: "line", kind: "horizontal", price: 100 }]);
  const snap = (workspaces: typeof a[], drawings: Record<string,string>) => readDeviceSnapshot({ format: "openterminal-device", version: 1, workspace: { workspaces, activeWorkspaceId: workspaces[0].id }, preferences: { groups: [], screeners: [] }, drawings });
  const local = snap([a,b], { [keyA]: line, [keyB]: line });
  const remote = snap([{ ...b, name: "Updated", watchlist: ["NVDA"] }, c], {});
  const merged = mergeDeviceSnapshots(remote, local, { workspaceIds: [b.id,c.id], includePreferences: false });
  expect(merged.workspace.workspaces.map(w => w.name)).toEqual(["Keep", "Updated", "Add"]);
  expect(merged.workspace.activeWorkspaceId).toBe(a.id);
  expect(merged.drawings[keyA]).toBe(line);
  expect(merged.drawings[keyB]).toBeUndefined();
  expect(describeSyncChanges(local, merged)).toContainEqual(expect.objectContaining({ name: "Updated", status: "Changed", detail: expect.stringContaining("NVDA") }));
  expect(() => mergeDeviceSnapshots(remote, local, { workspaceIds: ["missing"], includePreferences: false })).toThrow("source workspace");
  expect(() => mergeDeviceSnapshots(remote, local, { workspaceIds: [], includePreferences: false })).toThrow();
});

it("keeps drawings shared with unselected workspaces and rejects selective overflow", async () => {
  const { mergeDeviceSnapshots } = await import("../../web/lib/device-sync.js");
  const a = makeWorkspace("Keep shared", "daily"), b = { ...a, id: "other", name: "Selected" };
  const key = `openterminal-drawings-v1:${a.widgets[0].id}:AAPL:1D`;
  const line = JSON.stringify([{ id: "line", kind: "horizontal", price: 100 }]);
  const snap = (workspaces: typeof a[], drawings: Record<string,string>) => readDeviceSnapshot({ format: "openterminal-device", version: 1, workspace: { workspaces, activeWorkspaceId: workspaces[0].id }, preferences: { groups: [], screeners: [] }, drawings });
  const local = snap([a,b], { [key]: line }), source = snap([b], {});
  expect(mergeDeviceSnapshots(source, local, { workspaceIds: [b.id], includePreferences: false }).drawings[key]).toBe(line);
  const full = snap(Array.from({ length: 20 }, (_,i) => ({ ...a, id: `workspace-${i}` })), {});
  expect(() => mergeDeviceSnapshots(source, full, { workspaceIds: [b.id], includePreferences: false })).toThrow("exceeds 20");
});

it("upgrades a pre-history database once without changing the existing snapshot", async () => {
  const { default: SQLite } = await import("better-sqlite3");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { MIGRATIONS } = await import("./storage/migrations.js");
  const { listSyncHistory } = await import("./sync.js");
  const dir = mkdtempSync(join(tmpdir(), "sync-migration-")), filename = join(dir, "old.sqlite");
  const raw = new SQLite(filename);
  raw.exec("CREATE TABLE app_schema_migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const migration of MIGRATIONS.filter(m => m.id <= 4)) {
    raw.exec(migration.sqlite);
    raw.prepare("INSERT INTO app_schema_migrations VALUES (?,?)").run(migration.id, "2026-01-01");
  }
  raw.prepare("INSERT INTO workspace_sync (id,payload,version,updated_at) VALUES (1,?,?,?)").run('{"legacy":true}', "legacy-version", "2026-01-01");
  raw.close();
  try {
    for (let i = 0; i < 2; i++) {
      const db = await AppDatabase.open({ filename });
      try {
        expect((await readSync(db))!.version).toBe("legacy-version");
        expect(await listSyncHistory(db)).toEqual([{ version: "legacy-version", updatedAt: "2026-01-01" }]);
      } finally { await db.close(); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('preserves panel settings through server sync and optionally merges scoped display choices',async()=>{
 const {defaultDisplayPreferences}=await import('../../web/lib/display.js');const {mergeDeviceSnapshots}=await import('../../web/lib/device-sync.js');
 const db=await AppDatabase.open();try{
  const w=makeWorkspace('Settings','blank');w.widgets=[{id:'chart',type:'chart',linked:true,settings:{chartRange:'5Y'}}];w.layout=[{i:'chart',x:0,y:0,w:12,h:8}];
  const display={...defaultDisplayPreferences(),language:'zh' as const,fontSize:18,hiddenPanels:{[w.id]:['chart']}};
  const source=readDeviceSnapshot({format:'openterminal-device',version:1,workspace:{workspaces:[w],activeWorkspaceId:w.id},preferences:{groups:[],screeners:[]},drawings:{},display});
  await writeSync(db,source,null);const saved=(await readSync(db))!.payload;expect(saved.workspace.workspaces[0].widgets[0].settings.chartRange).toBe('5Y');expect(saved.display.fontSize).toBe(18);
  const target={...source,display:{...defaultDisplayPreferences(),hiddenPanels:{other:['keep']}}};
  expect(mergeDeviceSnapshots(source,target,{workspaceIds:null,includePreferences:true}).display?.fontSize).toBe(12);
  const merged=mergeDeviceSnapshots(source,target,{workspaceIds:[w.id],includePreferences:false,includeDisplay:true});expect(merged.display?.fontSize).toBe(18);expect(merged.display?.hiddenPanels).toEqual({other:['keep'],[w.id]:['chart']});
 }finally{await db.close();}
});

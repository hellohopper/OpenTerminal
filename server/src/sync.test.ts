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

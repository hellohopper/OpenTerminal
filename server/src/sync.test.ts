import { it, expect } from "vitest";
import { AppDatabase } from "./storage/database.js";
import { writeSync, readSync } from "./sync.js";
import { makeWorkspace } from "../../web/lib/workspaces.js";
import { readDeviceSnapshot } from "../../web/lib/device-sync.js";
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

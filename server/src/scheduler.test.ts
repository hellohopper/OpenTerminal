import { it, expect, vi } from "vitest";
import { AppDatabase } from "./storage/database.js";
import { createBriefingScheduler, dueKey } from "./scheduler.js";
import { createBackup, restoreBackup } from "./storage/backup.js";
async function fixture() {
  const db = await AppDatabase.open();
  await db
    .prepare(
      "INSERT INTO briefing_schedules (symbols,mode,local_time,timezone,weekdays,generation) VALUES (?,?,?,?,?,?)",
    )
    .run(
      '["AAPL"]',
      "pre-market",
      "08:30",
      "America/New_York",
      "1,2,3,4,5",
      "test",
    );
  return db;
}
it("uses local calendar dates across DST and selected weekdays", () => {
  const s = {
    local_time: "08:30",
    timezone: "America/New_York",
    weekdays: "1,2,3,4,5",
  };
  expect(dueKey(s, new Date("2026-03-06T13:29Z"))).toBeNull();
  expect(dueKey(s, new Date("2026-03-06T13:30Z"))).toBe("2026-03-06");
  expect(dueKey(s, new Date("2026-03-09T12:30Z"))).toBe("2026-03-09");
  expect(dueKey(s, new Date("2026-03-08T15:00Z"))).toBeNull();
});
it("claims only one report across competing workers and runs again next local day", async () => {
  const db = await fixture();
  let now = new Date("2026-03-09T13:00Z");
  const gen = vi.fn(async () => ({ summary: "Report" })),
    a = createBriefingScheduler(db, gen, () => now),
    b = createBriefingScheduler(db, gen, () => now);
  try {
    expect(
      (await Promise.all([a.check(), b.check()])).reduce((x, y) => x + y, 0),
    ).toBe(1);
    expect(gen).toHaveBeenCalledTimes(1);
    expect(await a.check()).toBe(0);
    now = new Date("2026-03-10T13:00Z");
    expect(await a.check()).toBe(1);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM briefings").get())!.n,
    ).toBe(2);
  } finally {
    await a.stop();
    await b.stop();
    await db.close();
  }
});
it("bounds retries and rejects old in-flight work after restore", async () => {
  const db = await fixture();
  let now = new Date("2026-03-09T13:00Z");
  const gen = vi.fn(async () => {
      throw new Error("offline");
    }),
    worker = createBriefingScheduler(db, gen, () => now);
  try {
    for (let i = 0; i < 4; i++) {
      await worker.check();
      now = new Date(now.getTime() + 60001);
    }
    expect(gen).toHaveBeenCalledTimes(3);
    expect(
      (await db.prepare("SELECT last_error FROM briefing_schedules").get())!
        .last_error,
    ).toContain("failed");
    await db.prepare("DELETE FROM briefing_runs").run();
    let finish!: (v: unknown) => void;
    let started!: () => void;
    const ready = new Promise<void>((r) => (started = r));
    const delayed = createBriefingScheduler(
      db,
      async () => {
        started();
        return new Promise((r) => (finish = r));
      },
      () => now,
    );
    const pending = delayed.check();
    await ready;
    const backup = await createBackup(db);
    await restoreBackup(db, backup);
    finish({ summary: "old" });
    expect(await pending).toBe(0);
    expect(
      (await db.prepare("SELECT COUNT(*) AS n FROM briefings").get())!.n,
    ).toBe(0);
    await delayed.stop();
  } finally {
    await worker.stop();
    await db.close();
  }
});

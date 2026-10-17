import { randomUUID } from "node:crypto";
import type { AppDatabase } from "./storage/database.js";
import type { BriefingMode } from "./briefing.js";
export type Schedule = {
  id: number;
  symbols: string;
  mode: BriefingMode;
  local_time: string;
  timezone: string;
  weekdays: string;
  enabled: number;
  generation: string;
};
export function dueKey(
  schedule: Pick<Schedule, "local_time" | "timezone" | "weekdays">,
  now: Date,
): string | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: schedule.timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);
  const p = Object.fromEntries(parts.map((v) => [v.type, v.value]));
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    p.weekday,
  );
  return schedule.weekdays.split(",").includes(String(day)) &&
    `${p.hour}:${p.minute}` >= schedule.local_time
    ? `${p.year}-${p.month}-${p.day}`
    : null;
}
export function createBriefingScheduler(
  db: AppDatabase,
  generate: (symbols: string[], mode: BriefingMode) => Promise<unknown>,
  clock = () => new Date(),
) {
  let inFlight: Promise<number> | undefined,
    timer: ReturnType<typeof setInterval> | undefined,
    stopped = false;
  const check = () => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let generated = 0;
      const schedules = (await db
        .prepare("SELECT * FROM briefing_schedules WHERE enabled=1 ORDER BY id")
        .all()) as Schedule[];
      for (const schedule of schedules) {
        if (stopped) break;
        const now = clock(),
          key = dueKey(schedule, now);
        if (!key) continue;
        const token = randomUUID();
        const claimed = await db.transaction(async () => {
          const current = await db
            .prepare(
              "SELECT * FROM briefing_schedules WHERE id=? AND enabled=1 AND generation=?",
            )
            .get(schedule.id, schedule.generation);
          if (!current) return false;
          const run = await db
            .prepare(
              "SELECT * FROM briefing_runs WHERE schedule_id=? AND run_key=?",
            )
            .get(schedule.id, key);
          if (
            run &&
            (run.status === "done" ||
              run.attempts >= 3 ||
              now.getTime() - Date.parse(run.claimed_at) <
                (run.status === "running" ? 300000 : 60000))
          )
            return false;
          if (run)
            await db
              .prepare(
                "UPDATE briefing_runs SET status=?,attempts=attempts+1,claimed_at=?,token=? WHERE id=?",
              )
              .run("running", now.toISOString(), token, run.id);
          else
            await db
              .prepare(
                "INSERT INTO briefing_runs (schedule_id,run_key,status,attempts,claimed_at,token) VALUES (?,?,?,?,?,?)",
              )
              .run(schedule.id, key, "running", 1, now.toISOString(), token);
          return true;
        })();
        if (!claimed) continue;
        try {
          const report = await generate(
            JSON.parse(schedule.symbols),
            schedule.mode,
          );
          if (stopped) continue;
          await db.transaction(async () => {
            const current = await db
              .prepare(
                "SELECT id FROM briefing_schedules WHERE id=? AND enabled=1 AND generation=?",
              )
              .get(schedule.id, schedule.generation);
            const run = await db
              .prepare(
                "SELECT id FROM briefing_runs WHERE schedule_id=? AND run_key=? AND token=? AND status=?",
              )
              .get(schedule.id, key, token, "running");
            if (!current || !run) return;
            await db
              .prepare(
                "INSERT INTO briefings (generated_at,content) VALUES (?,?)",
              )
              .run(clock().toISOString(), JSON.stringify(report));
            await db
              .prepare("UPDATE briefing_runs SET status=? WHERE id=?")
              .run("done", run.id);
            await db
              .prepare(
                "UPDATE briefing_schedules SET last_error=NULL,last_generated_at=? WHERE id=?",
              )
              .run(clock().toISOString(), schedule.id);
            generated++;
          })();
        } catch {
          await db.transaction(async () => {
            const current = await db
              .prepare(
                "SELECT id FROM briefing_schedules WHERE id=? AND generation=?",
              )
              .get(schedule.id, schedule.generation);
            const run = await db
              .prepare(
                "SELECT id FROM briefing_runs WHERE schedule_id=? AND run_key=? AND token=?",
              )
              .get(schedule.id, key, token);
            if (!current || !run) return;
            await db
              .prepare("UPDATE briefing_runs SET status=? WHERE id=?")
              .run("failed", run.id);
            await db
              .prepare("UPDATE briefing_schedules SET last_error=? WHERE id=?")
              .run(
                "Generation failed; retrying up to three times today.",
                schedule.id,
              );
          })();
        }
      }
      return generated;
    })().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };
  return {
    check,
    start: () => {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => void check().catch(() => {}), 60000);
      timer.unref();
      void check().catch(() => {});
    },
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      timer = undefined;
      await inFlight;
    },
  };
}

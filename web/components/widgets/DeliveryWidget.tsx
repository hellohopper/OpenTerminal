"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
type Schedule = {
  id: number;
  symbols: string;
  mode: string;
  local_time: string;
  timezone: string;
  weekdays: string;
  enabled: number;
  last_error: string | null;
  last_generated_at: string | null;
};
export default function DeliveryWidget() {
  const watchlist = useTerminal((s) => s.watchlist),
    [symbols, setSymbols] = useState(watchlist.slice(0, 12).join(",")),
    [time, setTime] = useState("08:30"),
    [zone, setZone] = useState("America/New_York"),
    [mode, setMode] = useState("pre-market"),
    [days, setDays] = useState([1, 2, 3, 4, 5]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const { data = [], error } = useQuery({
    queryKey: ["delivery-schedules"],
    queryFn: () => apiGet<Schedule[]>("/api/delivery"),
    refetchInterval: 10000,
  });
  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      setMessage(success);
      await qc.invalidateQueries();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-2 space-y-2">
      <p>
        Scheduled briefings run while the API server is online, once per
        selected local calendar day after the configured time. Missed times
        catch up later that same day. Reports appear in MY BRIEFING history.
        Weekdays are calendar days; exchange holidays are included.
      </p>
      <p className="dim">
        Uses the existing market/news sources, without paid AI generation or
        external messages. For repeating price/day-change/volume notifications,
        configure ALERTS and its cooldown.
      </p>
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(
            () =>
              apiPost("/api/delivery", {
                symbols: symbols
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                mode,
                local_time: time,
                timezone: zone,
                weekdays: days,
              }),
            "Briefing schedule saved.",
          );
        }}
      >
        <input
          aria-label="Briefing schedule symbols"
          value={symbols}
          onChange={(e) => setSymbols(e.target.value)}
          placeholder="AAPL,MSFT"
        />
        <select
          aria-label="Schedule mode"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="pre-market">Pre-market</option>
          <option value="after-close">After-close</option>
        </select>
        <input
          aria-label="Schedule local time"
          type="time"
          required
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
        <input
          aria-label="Schedule timezone"
          required
          value={zone}
          onChange={(e) => setZone(e.target.value)}
        />
        <div>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <label key={day} className="mr-2">
              <input
                aria-label={`Schedule ${day}`}
                type="checkbox"
                checked={days.includes(i)}
                onChange={(e) =>
                  setDays(
                    e.target.checked
                      ? [...days, i]
                      : days.filter((d) => d !== i),
                  )
                }
              />
              {day}
            </label>
          ))}
        </div>
        <button className="term-btn" disabled={busy}>
          Save briefing schedule
        </button>
      </form>
      <button
        className="term-btn"
        disabled={busy}
        onClick={() =>
          act(async () => {
            const r = await apiPost<{ generated: number }>(
              "/api/delivery/check",
              {},
            );
            setMessage(
              `Due schedules checked: ${r.generated} reports generated.`,
            );
          }, "Due schedules checked. Reports are in MY BRIEFING.")
        }
      >
        Check due schedules
      </button>
      {(message || error) && (
        <p role="status" className="amber">
          {message || error?.message}
        </p>
      )}
      <table className="data-table">
        <thead>
          <tr>
            <th>Symbols</th>
            <th>Schedule</th>
            <th>Last report / error</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <tr key={s.id}>
              <td>{JSON.parse(s.symbols).join(", ")}</td>
              <td>
                {s.local_time} {s.timezone}
                <div>
                  {s.weekdays
                    .split(",")
                    .map(
                      (d) =>
                        ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][
                          Number(d)
                        ],
                    )
                    .join(", ")}{" "}
                  · {s.mode}
                </div>
              </td>
              <td>
                {s.last_generated_at ?? "Not yet"}
                <div className="amber">{s.last_error}</div>
              </td>
              <td>
                <button
                  className="term-btn"
                  onClick={() =>
                    act(
                      () =>
                        apiPut(`/api/delivery/${s.id}`, {
                          enabled: !s.enabled,
                        }),
                      "Schedule updated.",
                    )
                  }
                >
                  {s.enabled ? "Pause schedule" : "Resume schedule"}
                </button>
                <button
                  className="term-btn"
                  onClick={() =>
                    act(
                      () => apiDelete(`/api/delivery/${s.id}`),
                      "Schedule deleted.",
                    )
                  }
                >
                  Delete schedule
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { it, expect } from "vitest";
import { assembleHoldingEvents } from "./holding-events.js";
import { exportEventCalendar } from "../../web/lib/event-calendar.js";
const now = new Date("2026-10-15T14:00Z"),
  date = Date.parse("2026-10-16") / 1000;
const earning = {
  symbol: "AAPL",
  nextEarningsDate: date,
  lastEarningsDate: null,
  epsForecast: 1,
};
const macro = {
  title: "CPI, headline;\n中国".repeat(15),
  country: "USD",
  date: "2026-10-16T12:30:00Z",
  impact: "High" as const,
  forecast: null,
  actual: null,
  previous: null,
};
it("deduplicates events and attaches only related holdings, without inventing missing valuations", () => {
  const result = assembleHoldingEvents(
    ["AAPL"],
    [
      { symbol: "AAPL", quantity: 2 },
      { symbol: "MSFT", quantity: 1 },
    ],
    [earning, earning, { ...earning, symbol: "OTHER" }],
    [macro, macro],
    [],
    7,
    now,
  );
  expect(result.events).toHaveLength(2);
  expect(result.events[0].exposure.map((h) => h.symbol)).toEqual(["AAPL"]);
  expect(result.events[1].exposure).toHaveLength(2);
  expect(result.valuationComplete).toBe(false);
  expect(
    result.exposure.every((h) => h.weight === null && h.marketValue === null),
  ).toBe(true);
  expect(
    assembleHoldingEvents(
      ["AAPL"],
      [],
      [{ ...earning, nextEarningsDate: null }],
      [],
      [],
      7,
      now,
    ).missingEarnings,
  ).toEqual(["AAPL"]);
});
it("values fresh USD holdings, omits past events and exports safe folded calendar data", () => {
  const q = {
    symbol: "AAPL",
    price: 100,
    currency: "USD",
    retrievedAt: now.toISOString(),
    stale: false,
  } as any;
  const result = assembleHoldingEvents(
    ["AAPL"],
    [{ symbol: "AAPL", quantity: 2 }],
    [earning],
    [macro, { ...macro, date: "2026-10-14T12:00Z" }],
    [q],
    7,
    now,
  );
  expect(result.holdingsValue).toBe(200);
  expect(result.exposure[0].weight).toBe(100);
  const ics = exportEventCalendar(result.events, true, now);
  expect(ics).toContain("DTSTART;VALUE=DATE:20261016");
  expect(ics).toContain("DTEND;VALUE=DATE:20261017");
  expect(ics).toContain("TRIGGER:-PT24H");
  expect(ics).toContain("CPI\\, headline\\;\\n");
  expect(ics.split("\r\n").every((line) => Buffer.byteLength(line) <= 75)).toBe(
    true,
  );
  expect(exportEventCalendar(result.events, false, now)).not.toContain(
    "VALARM",
  );
  expect(
    assembleHoldingEvents(
      ["AAPL"],
      [{ symbol: "AAPL", quantity: 2 }],
      [],
      [],
      [{ ...q, stale: true }],
      7,
      now,
    ).holdingsValue,
  ).toBeNull();
});

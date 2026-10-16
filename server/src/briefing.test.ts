import { describe, expect, it } from "vitest";
import { assembleBriefing } from "./briefing.js";
import type { Quote } from "./providers/yahoo.js";
describe("personal briefings", () => {
  it("ranks absolute movers, filters news and upcoming events, and exposes missing data", () => {
    const now = new Date("2026-10-15T12:00:00Z");
    const result = assembleBriefing(["AAPL", "MSFT", "IBM"], "pre-market", {
      quotes: [{ symbol: "AAPL", price: 100, changePercent: 2 }, { symbol: "MSFT", price: 100, changePercent: -5 }] as Quote[],
      news: [{ title: "Current", link: "https://example.com/1", publisher: "Example", symbol: "AAPL", publishedAt: now.toISOString() }, { title: "Old", link: "https://example.com/2", publisher: "Example", symbol: "AAPL", publishedAt: "2020-01-01" }],
      earnings: [{ symbol: "AAPL", nextEarningsDate: Date.parse("2026-10-16") / 1000, lastEarningsDate: null, epsForecast: 1 }],
      economic: [{ title: "Upcoming CPI", date: "2026-10-16T12:30:00Z", country: "USD", impact: "High", forecast: null, previous: null, actual: null }, { title: "Old CPI", date: "2026-10-14T12:30:00Z", country: "USD", impact: "High", forecast: null, previous: null, actual: null }], warnings: [],
    }, now);
    expect(result.movers[0].symbol).toBe("MSFT"); expect(result.headlines).toHaveLength(1); expect(result.economic).toHaveLength(1); expect(result.warnings[0]).toContain("IBM"); expect(result.date).toBe("2026-10-15");
  });
  it("retains an explicit outage message when all feeds fail", () => {
    const result = assembleBriefing(["AAPL"], "after-close", { quotes: [], news: [], earnings: [], economic: [], warnings: ["News unavailable."] });
    expect(result.summary).toContain("unavailable"); expect(result.warnings).toContain("News unavailable.");
  });
});

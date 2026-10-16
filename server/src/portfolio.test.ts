import { describe, expect, it } from "vitest";
import { replayLedger, portfolioPerformance, type Trade, type CashEvent } from "./portfolio.js";
const day = (d: number) => `2026-01-${String(d).padStart(2, "0")}T00:00:00Z`;
const trade = (side: "BUY" | "SELL", qty: number, price: number, d = 1): Trade => ({ symbol: "AAPL", side, quantity: qty, price, executed_at: day(d) });
const event = (kind: CashEvent["kind"], amount: number, d = 1): CashEvent => ({ kind, amount, symbol: kind === "SPLIT" || kind === "DIVIDEND" ? "AAPL" : null, executed_at: day(d) });
const prices = (values: number[]) => values.map((close, i) => ({ time: Date.parse(day(i + 1)) / 1000, close }));
describe("portfolio ledger and performance", () => {
  it("rejects oversells, including selling before a backdated buy", () => {
    expect(() => replayLedger([trade("BUY", 10, 100, 2), trade("SELL", 1, 100, 1)], [])).toThrow("exceeds");
    expect(() => replayLedger([trade("BUY", 10, 100), trade("SELL", 11, 100, 2)], [])).toThrow("exceeds");
  });
  it("preserves value across splits and records dividends and average cost", () => {
    const result = replayLedger([trade("BUY", 10, 100), trade("SELL", 5, 60, 3)], [event("DEPOSIT", 1000), event("SPLIT", 2, 2), event("DIVIDEND", 10, 3)]);
    expect(result.positions.get("AAPL")).toEqual({ quantity: 15, avgCost: 50, realizedPnl: 50, dividends: 10 }); expect(result.cash).toBe(310);
  });
  it("does not count new deposits as investment returns", () => {
    const result = portfolioPerformance([trade("BUY", 10, 100)], [event("DEPOSIT", 1000), event("DEPOSIT", 1000, 2)], { AAPL: prices([100, 110]), SPY: prices([100, 105]) });
    expect(result.returnPercent).toBeCloseTo(10); expect(result.rows[1].nav).toBe(2100);
  });
  it("requires funding and price coverage instead of inventing a return", () => {
    expect(portfolioPerformance([trade("BUY", 10, 100)], [], { AAPL: prices([100, 110]) }).returnPercent).toBeNull();
    expect(portfolioPerformance([trade("BUY", 10, 100)], [event("DEPOSIT", 1000)], {}).returnPercent).toBeNull();
  });
  it("handles split-adjusted prices without creating a fictitious split profit", () => {
    const result = portfolioPerformance([trade("BUY", 10, 100)], [event("DEPOSIT", 1000), event("SPLIT", 2, 2)], { AAPL: prices([50, 50]) }, "split-adjusted");
    expect(result.returnPercent).toBe(0);
    expect(portfolioPerformance([trade("BUY", 10, 100)], [event("DEPOSIT", 1000), event("SPLIT", 2, 2)], { AAPL: prices([50, 50]) }).rows).toEqual([]);
  });
});

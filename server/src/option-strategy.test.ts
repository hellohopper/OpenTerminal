import { describe, expect, it } from "vitest";
import { analyzeStrategy, type StrategyLeg } from "../../web/lib/option-strategy";
const leg = (kind: StrategyLeg["kind"], side: StrategyLeg["side"], strike: number, premium: number, quantity = 1): StrategyLeg => ({ kind, side, strike, premium, quantity });
describe("expiration strategy analytics", () => {
  it("computes finite vertical-spread bounds and break-even", () => {
    const result = analyzeStrategy([leg("call", "BUY", 100, 5), leg("call", "SELL", 110, 3)], 100);
    expect(result.maximumLoss).toBe(200); expect(result.maximumProfit).toBe(800); expect(result.breakEvens).toEqual([102]);
  });
  it("detects unlimited short-call loss beyond the plotted range", () => {
    const result = analyzeStrategy([leg("call", "SELL", 100, 2)], 100); expect(result.maximumLoss).toBe(Infinity); expect(result.maximumProfit).toBe(200);
  });
  it("handles stock legs in shares and puts with two break-even points", () => {
    const covered = analyzeStrategy([leg("stock", "BUY", 0, 100, 100), leg("call", "SELL", 110, 2)], 100);
    expect(covered.maximumLoss).toBe(9800); expect(covered.maximumProfit).toBe(1200);
    expect(analyzeStrategy([leg("put", "BUY", 100, 4), leg("call", "BUY", 100, 5)], 100).breakEvens).toEqual([91, 109]);
  });
  it("rejects incomplete and non-finite legs", () => { expect(() => analyzeStrategy([leg("call", "BUY", 100, NaN)], 100)).toThrow(); expect(() => analyzeStrategy([], 100)).toThrow(); });
});

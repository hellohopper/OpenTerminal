import { describe, expect, it } from "vitest";
import { extractFinancials } from "./fundamentals.js";
const fact = (start: string, end: string, val: number, filed = "2026-02-01") => ({ start, end, val, filed, form: "10-K", accn: "0000320193-26-000001" });
const data = (values: unknown[]) => ({ facts: { "us-gaap": { Revenues: { units: { USD: values } } } } });
describe("SEC fundamentals", () => {
  it("derives Q2 and Q4 from cumulative disclosures without displaying YTD as a quarter", () => {
    const input = data([fact("2025-01-01", "2025-03-31", 10), fact("2025-01-01", "2025-06-30", 25), fact("2025-01-01", "2025-09-30", 45), fact("2025-01-01", "2025-12-31", 80)]);
    expect(extractFinancials(input, "quarterly", "320193").map((r) => r.revenue?.value)).toEqual([10, 15, 20, 35]);
    expect(extractFinancials(input, "annual", "320193").map((r) => r.revenue?.value)).toEqual([80]);
  });
  it("prefers amended values and leaves missing metrics null", () => {
    const rows = extractFinancials(data([fact("2025-01-01", "2025-03-31", 10), fact("2025-01-01", "2025-03-31", 12, "2026-03-01")]), "quarterly", "320193");
    expect(rows[0].revenue?.value).toBe(12); expect(rows[0].assets).toBeNull(); expect(rows[0].freeCashFlow).toBeNull();
    expect(rows[0].revenue?.filingUrl).toContain("/320193/000032019326000001/");
  });
  it("does not invent unsupported currency or taxonomy data", () => { expect(extractFinancials({ facts: { "ifrs-full": {} } }, "quarterly", "1")).toEqual([]); });
});

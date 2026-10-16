import { afterEach, describe, expect, it, vi } from "vitest";
import { getQuotes } from "./market.js";
import { cacheSet, staleSet } from "../cache.js";
import * as nasdaq from "../providers/nasdaq.js";
import * as yahoo from "../providers/yahoo.js";
import * as stooq from "../providers/stooq.js";
import * as binance from "../providers/binance.js";
import * as tradingview from "../providers/tradingview.js";
import type { Quote } from "../providers/yahoo.js";
afterEach(() => vi.restoreAllMocks());
describe("fresh quote reads for alerts", () => {
  it("excludes stale fallback values while preserving existing dashboard behavior", async () => {
    const quote = { symbol: "FAIL", price: 500, source: "test" } as Quote;
    staleSet("quote:FAIL", quote);
    vi.spyOn(nasdaq, "quote").mockRejectedValue(new Error("offline"));
    vi.spyOn(yahoo, "quotes").mockRejectedValue(new Error("offline"));
    vi.spyOn(yahoo, "quoteFromChart").mockRejectedValue(new Error("offline"));
    vi.spyOn(stooq, "quote").mockRejectedValue(new Error("offline"));
    expect(
      await getQuotes(["FAIL"], {
        allowStale: false,
        includeFundamentals: false,
      }),
    ).toEqual([]);
    expect(await getQuotes(["FAIL"], { includeFundamentals: false })).toEqual([
      quote,
    ]);
  });
  it("never resolves a failed crypto quote through a same-named equity", async () => {
    vi.spyOn(binance, "quote").mockRejectedValue(
      new Error("crypto unavailable"),
    );
    const equity = vi
      .spyOn(nasdaq, "quote")
      .mockResolvedValue({ symbol: "BTC", price: 10 } as Quote);
    const batch = vi.spyOn(yahoo, "quotes").mockResolvedValue([]);
    expect(
      await getQuotes(["BTC"], {
        allowStale: false,
        includeFundamentals: false,
      }),
    ).toEqual([]);
    expect(equity).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });
  it("shares fresh cached quotes and skips optional fundamentals enrichment", async () => {
    const quote = {
      symbol: "FRESH",
      price: 100,
      exchange: "NASDAQ",
      pe: null,
    } as Quote;
    cacheSet("quote:FRESH", quote, 60000);
    const enrich = vi.spyOn(tradingview, "scanFundamentals");
    expect(
      await getQuotes(["FRESH"], {
        allowStale: false,
        includeFundamentals: false,
      }),
    ).toEqual([quote]);
    expect(enrich).not.toHaveBeenCalled();
  });
  it("honors a caller cancellation before reading or calling providers", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      getQuotes(["AAPL"], { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

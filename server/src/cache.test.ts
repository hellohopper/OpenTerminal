import { describe, expect, it, vi } from "vitest";
import { cached, cacheGet, cacheSet, staleGet, staleSet } from "./cache.js";

describe("cache", () => {
  it("stores and retrieves values within TTL", () => {
    cacheSet("k1", 42, 1000);
    expect(cacheGet("k1")).toBe(42);
  });

  it("expires values after TTL", async () => {
    cacheSet("k2", "x", 1);
    await new Promise((r) => setTimeout(r, 10));
    expect(cacheGet("k2")).toBeUndefined();
  });

  it("serves stale data when the loader fails after a prior success", async () => {
    let calls = 0;
    const loader = async () => {
      calls++;
      if (calls === 1) return "fresh";
      throw new Error("provider down");
    };
    expect(await cached("k3", 1, loader)).toBe("fresh");
    await new Promise((r) => setTimeout(r, 10));
    expect(await cached("k3", 1, loader)).toBe("fresh"); // stale fallback
    expect(calls).toBe(2);
  });

  it("propagates errors when no stale data exists", async () => {
    await expect(cached("k4", 1000, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  });

  it("shares a concurrent refresh without blocking other cache keys", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const loader = vi.fn(() => pending);
    const first = cached("shared-refresh", 1000, loader);
    const second = cached("shared-refresh", 1000, loader);
    expect(await cached("independent-refresh", 1000, async () => "other")).toBe("other");
    resolve("fresh");
    expect(await Promise.all([first, second])).toEqual(["fresh", "fresh"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cacheGet("shared-refresh")).toBe("fresh");
  });

  it("shares failures and releases the pending load so a later request can retry", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<string>((_resolve, fail) => { reject = fail; });
    const loader = vi.fn(() => pending);
    const requests = Promise.allSettled([
      cached("shared-failure", 1000, loader),
      cached("shared-failure", 1000, loader),
    ]);
    reject(new Error("provider offline"));
    const results = await requests;
    expect(results.map(r => r.status)).toEqual(["rejected", "rejected"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(await cached("shared-failure", 1000, async () => "recovered")).toBe("recovered");
  });

  it("shares stale fallback without marking it fresh or preventing recovery", async () => {
    staleSet("shared-stale", "old");
    const loader = vi.fn(async () => { throw new Error("provider offline"); });
    expect(await Promise.all([
      cached("shared-stale", 1000, loader),
      cached("shared-stale", 1000, loader),
    ])).toEqual(["old", "old"]);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(cacheGet("shared-stale")).toBeUndefined();
    expect(await cached("shared-stale", 1000, async () => "new")).toBe("new");
  });

  it("evicts the oldest entries once the cache exceeds its max size", () => {
    for (let i = 0; i < 1001; i++) {
      cacheSet(`flood-${i}`, i, 60_000);
    }
    expect(cacheGet("flood-0")).toBeUndefined();
    expect(cacheGet("flood-1000")).toBe(1000);
  });

  it("evicts the oldest stale entries once staleStore exceeds its max size", () => {
    for (let i = 0; i < 1001; i++) {
      staleSet(`stale-flood-${i}`, i);
    }
    expect(staleGet("stale-flood-0")).toBeUndefined();
    expect(staleGet("stale-flood-1000")).toBe(1000);
  });
});

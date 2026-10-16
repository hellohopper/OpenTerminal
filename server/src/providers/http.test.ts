import { afterEach, describe, expect, it, vi } from "vitest";
import { providerFetch } from "./http.js";
afterEach(() => vi.unstubAllGlobals());
describe("provider request cancellation", () => {
  it("forwards headers and combines the caller signal with a timeout", async () => {
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetch);
    await providerFetch("https://example.com/quote", {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const init = fetch.mock.calls[0][1];
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(init.signal.aborted).toBe(false);
    controller.abort();
    expect(init.signal.aborted).toBe(true);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { gatherResearch, validateCitations } from "./research.js";
import { researchOptionsSchema } from "./research-schema.js";
import * as market from "./routes/market.js";
import type { Quote } from "./providers/yahoo.js";
const database = vi.hoisted(() => ({ prepare: vi.fn() }));
vi.mock("./db.js", () => ({ db: database }));
afterEach(() => vi.restoreAllMocks());
describe("research evidence", () => {
  it("does not read private data unless opted in, and distinguishes retrieval from quote time", async () => {
    vi.spyOn(market, "getQuotes").mockResolvedValue([
      { symbol: "AAPL", price: 100, source: "nasdaq", time: null },
    ] as Quote[]);
    const result = await gatherResearch(
      researchOptionsSchema.parse({
        symbol: "AAPL",
        includeNews: false,
        includeFinancials: false,
      }),
    );
    expect(database.prepare).not.toHaveBeenCalled();
    expect(result.sources[0].id).toBe("S1");
    expect(result.sources[0].asOf).toBeNull();
    expect(result.warnings.join()).toContain("timestamp unavailable");
  });
  it("includes only bounded note text, not attachments, when opted in", async () => {
    vi.spyOn(market, "getQuotes").mockRejectedValue(new Error("offline"));
    database.prepare.mockReturnValue({
      all: () => [
        {
          id: 1,
          title: "Thesis",
          body: "x".repeat(5000),
          kind: "research",
          updated_at: "2026-10-15 12:00:00",
        },
      ],
    });
    const result = await gatherResearch(
      researchOptionsSchema.parse({
        symbol: "AAPL",
        includeNews: false,
        includeFinancials: false,
        includeNotes: true,
      }),
    );
    expect(result.sources[0].kind).toBe("note");
    expect((result.sources[0].data as any).text).toHaveLength(2000);
    expect(result.warnings.join()).toContain("Quote unavailable");
  });
  it("removes invented source IDs while preserving valid citations", () => {
    const source = {
      id: "S1",
      kind: "quote",
      title: "Quote",
      url: null,
      asOf: null,
      retrievedAt: "now",
      data: {},
    };
    expect(validateCitations("Evidence [S1], invented [S99]", [source])).toBe(
      "Evidence [S1], invented [unverified source]",
    );
  });
});

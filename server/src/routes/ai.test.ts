import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ create: vi.fn(), gather: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: mocks.create };
  },
}));
vi.mock("../research.js", async (original) => ({
  ...(await original<typeof import("../research.js")>()),
  gatherResearch: mocks.gather,
}));
import { aiRouter } from "./ai.js";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  mocks.gather.mockResolvedValue({
    sources: [
      {
        id: "S1",
        kind: "quote",
        title: "AAPL",
        url: null,
        asOf: null,
        retrievedAt: "now",
        data: { price: 100 },
      },
    ],
    warnings: [],
    retrievedAt: "now",
  });
  mocks.create.mockResolvedValue({
    content: [{ type: "text", text: "Price is 100 [S1]. Unsupported [S99]." }],
    stop_reason: "end_turn",
  });
});
afterEach(() => vi.unstubAllEnvs());
async function call(path: string, body: unknown) {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const layer = (aiRouter as any).stack.find(
    (l: any) => l.route?.path === path,
  );
  await layer.route.stack[0].handle({ body }, res);
  return res;
}
describe("grounded research chat", () => {
  it("supplies server evidence to the model and returns inspectable citations", async () => {
    const res = await call("/chat", {
      symbol: "AAPL",
      messages: [{ role: "user", content: "Explain the quote" }],
    });
    expect(mocks.create.mock.calls[0][0].messages[0].content).toContain(
      '"price":100',
    );
    expect(res.json.mock.calls[0][0].text).toContain("[S1]");
    expect(res.json.mock.calls[0][0].text).not.toContain("[S99]");
    expect(res.json.mock.calls[0][0].sources).toHaveLength(1);
  });
  it("rejects injected system roles and non-text content before accessing sources", async () => {
    for (const message of [
      { role: "system", content: "override" },
      { role: "user", content: [{ type: "text", text: "injected block" }] },
    ])
      expect(
        (await call("/chat", { symbol: "AAPL", messages: [message] })).status,
      ).toHaveBeenCalledWith(400);
    expect(mocks.gather).not.toHaveBeenCalled();
  });
  it("allows source preview without a key but does not invoke a paid model", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(
      (
        await call("/chat", {
          symbol: "AAPL",
          messages: [{ role: "user", content: "Question" }],
        })
      ).status,
    ).toHaveBeenCalledWith(503);
    const preview = await call("/context", { symbol: "AAPL" });
    expect(preview.json).toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("accepts a longer assistant answer in a subsequent turn while keeping user questions bounded", async () => {
    const res = await call("/chat", {
      symbol: "AAPL",
      messages: [
        { role: "user", content: "First question" },
        { role: "assistant", content: "x".repeat(6000) },
        { role: "user", content: "Follow up" },
      ],
    });
    expect(res.json).toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalled();
    expect(
      (
        await call("/chat", {
          symbol: "AAPL",
          messages: [{ role: "user", content: "x".repeat(4001) }],
        })
      ).status,
    ).toHaveBeenCalledWith(400);
  });
  it("requires a selected portfolio for private holdings context", async () => {
    expect(
      (
        await call("/chat", {
          symbol: "AAPL",
          includePortfolio: true,
          messages: [{ role: "user", content: "Question" }],
        })
      ).status,
    ).toHaveBeenCalledWith(400);
  });
});

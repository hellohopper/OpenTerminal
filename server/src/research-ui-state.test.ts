import { describe, expect, it } from "vitest";
import { journalDraftKey, readJournalDraft, writeJournalDraft, type JournalDraft } from "../../web/lib/journal-drafts";
import { normalizeRefreshInterval, pollingInterval, readDisplayPreferences } from "../../web/lib/display";
import { createDisplayStore } from "../../web/store/display";
function memory() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } }; }
const draft: JournalDraft = { symbol: "AAPL", title: "现金流草稿", body: "Unsaved research notes", kind: "research", image: null };

describe("local journal draft recovery", () => {
  it("isolates drafts by widget and symbol and clears only the saved/discarded draft", () => {
    const storage = memory(), a = journalDraftKey("research-AAPL", "AAPL"), b = journalDraftKey("research-MSFT", "MSFT"), panel = journalDraftKey("journal-1", "AAPL");
    writeJournalDraft(storage, a, draft); writeJournalDraft(storage, b, { ...draft, symbol: "MSFT", id: 42 });
    expect(readJournalDraft(storage, a)).toEqual(draft); expect(readJournalDraft(storage, panel)).toBeNull();
    writeJournalDraft(storage, a, null);
    expect(readJournalDraft(storage, a)).toBeNull(); expect(readJournalDraft(storage, b)).toMatchObject({ id: 42, symbol: "MSFT" });
  });
  it("accepts bounded image attachments but rejects malformed or incompatible stored records", () => {
    const storage = memory(), key = journalDraftKey("research-AAPL", "AAPL");
    for (const value of ["not json", JSON.stringify({ version: 2, draft }), JSON.stringify({ version: 1, draft: { ...draft, kind: "unknown" } }), JSON.stringify({ version: 1, draft: { ...draft, image: "javascript:alert(1)" } }), JSON.stringify({ version: 1, draft: { ...draft, body: "x".repeat(20001) } })]) {
      storage.setItem(key, value); expect(readJournalDraft(storage, key)).toBeNull();
    }
    writeJournalDraft(storage, key, { ...draft, image: "data:image/png;base64,aGVsbG8=" });
    expect(readJournalDraft(storage, key)?.image).toBe("data:image/png;base64,aGVsbG8=");
  });
  it("surfaces storage failures so the editor can warn instead of claiming autosave succeeded", () => {
    expect(() => writeJournalDraft({ ...memory(), setItem: () => { throw new Error("quota"); } }, "key", draft)).toThrow("quota");
  });
});
describe("refresh preferences and visibility policy", () => {
  it("preserves manual mode, normalizes invalid intervals and reduces offscreen work", () => {
    expect(normalizeRefreshInterval(0)).toBe(0); expect(normalizeRefreshInterval(42)).toBe(5000);
    expect(pollingInterval(1000, true)).toBe(1000); expect(pollingInterval(1000, false)).toBe(60000);
    expect(pollingInterval(1000, true, false)).toBe(false); expect(pollingInterval(0, true)).toBe(false);
    expect(pollingInterval(1000, true, true, 8000)).toBe(8000);
    expect(readDisplayPreferences({ refreshInterval: Infinity, hideEmptyQuoteFields: "false" })).toMatchObject({ refreshInterval: 5000, hideEmptyQuoteFields: true });
  });
  it("persists refresh and quote choices through hydration and visibility resets", async () => {
    const storage = memory(), store = createDisplayStore(storage);
    store.getState().setRefreshInterval(0); store.getState().setHideEmptyQuoteFields(false);
    const restored = createDisplayStore(storage); await restored.persist.rehydrate(); restored.getState().resetVisibility();
    expect(restored.getState()).toMatchObject({ refreshInterval: 0, hideEmptyQuoteFields: false });
  });
});

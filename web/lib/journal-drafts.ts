import { normalizeSymbol } from "./symbol";

export type JournalDraft = { id?: number; version?: string; symbol: string; title: string; body: string; kind: "research" | "trade"; image: string | null };
export type JournalSaved = { id: number; version: string };
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function journalDraftKey(widgetId: string, symbol: string) {
  return `openterminal-journal-draft-v1:${encodeURIComponent(widgetId)}:${encodeURIComponent(symbol)}`;
}
export function readJournalDraft(storage: DraftStorage, key: string): JournalDraft | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw), draft = saved?.draft;
    if (saved.version !== 1 || !draft || typeof draft.symbol !== "string" || !normalizeSymbol(draft.symbol)
      || typeof draft.title !== "string" || draft.title.length > 120 || typeof draft.body !== "string" || draft.body.length > 20000
      || !["research", "trade"].includes(draft.kind) || !(draft.image === null || typeof draft.image === "string" && draft.image.length <= 1_400_000 && /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(draft.image))
      || !(draft.id === undefined || Number.isSafeInteger(draft.id) && draft.id > 0)
      || !(draft.version === undefined || typeof draft.version === "string" && draft.version.length > 0 && draft.version.length <= 100)) return null;
    return { ...(draft.id === undefined ? {} : { id: draft.id }), ...(draft.version === undefined ? {} : { version: draft.version }), symbol: normalizeSymbol(draft.symbol)!, title: draft.title, body: draft.body, kind: draft.kind, image: draft.image };
  } catch { return null; }
}
export function writeJournalDraft(storage: DraftStorage, key: string, draft: JournalDraft | null) {
  if (draft) storage.setItem(key, JSON.stringify({ version: 1, draft }));
  else storage.removeItem(key);
}

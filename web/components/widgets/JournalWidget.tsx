"use client";
import { useI18n } from "../../lib/use-i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { journalDraftKey, type JournalDraft, type JournalSaved } from "../../lib/journal-drafts";
import { useJournalDraft } from "../../lib/use-journal-draft";
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
export type JournalEntry = { id: number; version: string; symbol: string; title: string; body: string; kind: "research" | "trade"; image?: string | null; hasImage?: number; created_at: string; updated_at: string };
function entryDraft(entry: JournalEntry): JournalDraft {
  const { id, version, symbol, title, body, kind, image } = entry;
  return { id, version, symbol, title, body, kind, image: image ?? null };
}
export default function JournalWidget({ widget, startNew = false }: { widget: WidgetInstance; startNew?: boolean }) {
  const symbol = useWidgetSymbol(widget);
  return <JournalEditor key={`${widget.id}:${symbol}`} widget={widget} symbol={symbol} startNew={startNew} />;
}
function JournalEditor({ widget, symbol, startNew }: { widget: WidgetInstance; symbol: string; startNew: boolean }) {
  const { t: ui } = useI18n();
  const qc = useQueryClient();
  const [all, setAll] = useState(false), [kind, setKind] = useState("");
  const [before, setBefore] = useState<number | undefined>();
  const { draft, setDraft, startDraft, restored, storageError, saving, beginSave, finishSave } = useJournalDraft(journalDraftKey(widget.id, symbol), startNew ? { symbol, title: "", body: "", kind: "research", image: null } : null);
  const [reviewed, setReviewed] = useState<JournalEntry | null>(null);
  const discard = () => !draft || confirm(ui("Discard this unsaved draft?"));
  const [error, setError] = useState("");
  const { data, error: loadError } = useQuery({ queryKey: ["journal", all ? "all" : symbol, kind, before], queryFn: () => apiGet<{ entries: JournalEntry[]; nextCursor: number | null }>(`/api/journal?symbol=${all ? "" : encodeURIComponent(symbol)}&kind=${kind}${before ? `&before=${before}` : ""}`) });
  const save = useMutation({
    mutationFn: ({ draft: submitted }: NonNullable<ReturnType<typeof beginSave>>) => {
      if (submitted.id && !submitted.version) throw new Error("Review the saved entry before saving this older draft.");
      return submitted.id ? apiPut<JournalSaved>(`/api/journal/${submitted.id}`, submitted) : apiPost<JournalSaved>("/api/journal", submitted);
    },
    onSuccess: (result, submitted) => { finishSave(submitted, result); void qc.invalidateQueries({ queryKey: ["journal"] }); setReviewed(null); setError(""); },
    onError: (err, submitted) => { finishSave(submitted); setError(ui(err.message)); },
  });
  const submit = (version?: string) => { const submitted = beginSave(version); if (submitted) save.mutate(submitted); };
  return <div className="p-2 space-y-2"><div className="flex flex-wrap gap-2">
    <button className={`term-btn ${all ? "" : "active"}`} onClick={() => { setAll(!all); setBefore(undefined); }}>{all ? ui("All symbols") : symbol}</button>
    <select aria-label={ui("Journal category filter")} value={kind} onChange={(e) => { setKind(e.target.value); setBefore(undefined); }}><option value="">{ui("All entries")}</option><option value="research">{ui("Research")}</option><option value="trade">{ui("Trade log")}</option></select>
    <button className="term-btn" disabled={saving} onClick={() => { if (!discard()) return; startDraft({ symbol, title: "", body: "", kind: "research", image: null }); setReviewed(null); setError(""); }}>{ui("New entry")}</button>
  </div>
  {(error || loadError) && <p role="alert" className="down">{error || (loadError as Error)?.message}</p>}
  {draft && <p role="status" className={storageError ? "down" : "dim"}>{ui(storageError ? "Draft could not be saved on this device. Keep this page open and save your entry." : restored ? "Local draft restored. Changes save on this device until you save the entry." : "Draft saved on this device. Save entry to add it to your journal.")}</p>}
  {!draft && storageError && <p role="alert" className="down">{ui("Local draft storage is unavailable.")}</p>}
  {draft && <form className="space-y-2 border border-[var(--border)] p-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
    <div className="flex gap-2"><input aria-label={ui("Journal symbol")} required maxLength={20} value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} /><select aria-label={ui("Entry category")} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "research" | "trade" })}><option value="research">{ui("Research")}</option><option value="trade">{ui("Trade log")}</option></select></div>
    <input aria-label={ui("Entry title")} placeholder={ui("Research question or trade rationale")} className="w-full" required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
    <textarea aria-label={ui("Entry notes")} placeholder={ui("Thesis, evidence, risks, entry/exit reasons, and outcome…")} rows={7} className="w-full" maxLength={20000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
    <label className="block dim">{ui("Attach chart/image (PNG, JPEG, WebP; up to 1 MB)")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1048576) { setError("Images must be no larger than 1 MB."); return; } const reader = new FileReader(); reader.onload = () => setDraft((d) => d ? { ...d, image: String(reader.result) } : d); reader.onerror = () => setError("Could not read image."); reader.readAsDataURL(file); }} /></label>
    {draft.image && <><img src={draft.image} alt="Attached research chart" className="max-h-64 max-w-full" /><button type="button" className="term-btn" onClick={() => setDraft({ ...draft, image: null })}>{ui("Remove image")}</button></>}
    <div className="flex flex-wrap gap-2"><button className="term-btn" disabled={saving}>{ui("Save entry")}</button><button type="button" className="term-btn" disabled={saving} onClick={() => { if (discard()) startDraft(null); }}>{ui("Discard draft")}</button>
      {draft.id && <><button type="button" className="term-btn" disabled={saving} onClick={async () => { try { setReviewed(await apiGet<JournalEntry>(`/api/journal/${draft.id}`)); } catch (err) { setError(ui((err as Error).message)); } }}>{ui("Review saved entry")}</button><button type="button" className="term-btn" disabled={saving} onClick={() => { startDraft({ ...draft, id: undefined, version: undefined }); setReviewed(null); setError(""); }}>{ui("Keep draft as a new entry")}</button></>}
    </div>
  </form>}
  {reviewed && draft?.id === reviewed.id && <section aria-label={ui("Saved entry comparison")} className="border border-[var(--border)] p-2 space-y-2">
    <p className="amber">{ui("Saved entry for comparison. Your draft is kept above.")}</p><h3>{reviewed.symbol} · {reviewed.title}</h3><p className="whitespace-pre-wrap">{reviewed.body}</p>
    {reviewed.image && <img src={reviewed.image} alt={ui("Saved entry attachment")} className="max-h-64 max-w-full" />}
    <div className="flex flex-wrap gap-2"><button className="term-btn" disabled={saving} onClick={() => { if (discard()) { startDraft(entryDraft(reviewed)); setReviewed(null); setError(""); } }}>{ui("Use saved entry")}</button><button className="term-btn" disabled={saving} onClick={() => { if (confirm(ui("Replace the saved entry shown here with your current edits?"))) submit(reviewed.version); }}>{ui("Save my current edits")}</button></div>
  </section>}
  {data?.entries.map((entry) => <article key={entry.id} className="border-b border-[var(--border)] pb-2"><div className="flex gap-2"><button className="amber text-left" disabled={saving} onClick={async () => { if (!discard()) return; try { const n = await apiGet<JournalEntry>(`/api/journal/${entry.id}`); startDraft(entryDraft(n)); setReviewed(null); setError(""); } catch (err) { setError((err as Error).message); } }}>{entry.symbol} · {entry.title}{entry.hasImage ? " ▧" : ""}</button><button aria-label={ui("Delete {value}", { value: entry.title })} disabled={saving} className="dim ml-auto" onClick={async () => { if (!confirm(`Delete “${entry.title}”?`)) return; try { await apiDelete(`/api/journal/${entry.id}`); qc.invalidateQueries({ queryKey: ["journal"] }); if (draft?.id === entry.id) startDraft(null); } catch (err) { setError((err as Error).message); } }}>✕</button></div><p className="dim text-[10px]">{entry.kind} · {entry.created_at} UTC</p><p className="whitespace-pre-wrap">{entry.body}</p></article>)}
  {data?.entries.length === 0 && <p className="dim">{ui("No entries yet. Record a thesis or save a snapshot from a chart.")}</p>}
  <div className="flex gap-2">{before && <button className="term-btn" onClick={() => setBefore(undefined)}>{ui("Latest entries")}</button>}{data?.nextCursor && <button className="term-btn" onClick={() => setBefore(data.nextCursor!)}>{ui("Older entries")}</button>}</div>
  </div>;
}

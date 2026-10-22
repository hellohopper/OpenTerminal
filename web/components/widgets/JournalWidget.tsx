"use client";
import { useI18n } from "../../lib/use-i18n";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { journalDraftKey } from "../../lib/journal-drafts";
import { useJournalDraft } from "../../lib/use-journal-draft";
import { apiGet, apiPost, apiPut, apiDelete } from "../../lib/api";
import { useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
export type JournalEntry = { id: number; symbol: string; title: string; body: string; kind: "research" | "trade"; image?: string | null; hasImage?: number; created_at: string; updated_at: string };
export default function JournalWidget({ widget, startNew = false }: { widget: WidgetInstance; startNew?: boolean }) {
  const symbol = useWidgetSymbol(widget);
  return <JournalEditor key={`${widget.id}:${symbol}`} widget={widget} symbol={symbol} startNew={startNew} />;
}
function JournalEditor({ widget, symbol, startNew }: { widget: WidgetInstance; symbol: string; startNew: boolean }) {
  const { t: ui } = useI18n();
  const qc = useQueryClient();
  const [all, setAll] = useState(false), [kind, setKind] = useState("");
  const [before, setBefore] = useState<number | undefined>();
  const { draft, setDraft, restored, storageError } = useJournalDraft(journalDraftKey(widget.id, symbol), startNew ? { symbol, title: "", body: "", kind: "research", image: null } : null);
  const discard = () => !draft || confirm(ui("Discard this unsaved draft?"));
  const [error, setError] = useState("");
  const { data, error: loadError } = useQuery({ queryKey: ["journal", all ? "all" : symbol, kind, before], queryFn: () => apiGet<{ entries: JournalEntry[]; nextCursor: number | null }>(`/api/journal?symbol=${all ? "" : encodeURIComponent(symbol)}&kind=${kind}${before ? `&before=${before}` : ""}`) });
  const save = useMutation({ mutationFn: () => draft!.id ? apiPut(`/api/journal/${draft!.id}`, draft) : apiPost("/api/journal", draft), onSuccess: () => { qc.invalidateQueries({ queryKey: ["journal"] }); setDraft(null); setError(""); }, onError: (err) => setError(err.message) });
  return <div className="p-2 space-y-2"><div className="flex flex-wrap gap-2">
    <button className={`term-btn ${all ? "" : "active"}`} onClick={() => { setAll(!all); setBefore(undefined); }}>{all ? ui("All symbols") : symbol}</button>
    <select aria-label={ui("Journal category filter")} value={kind} onChange={(e) => { setKind(e.target.value); setBefore(undefined); }}><option value="">{ui("All entries")}</option><option value="research">{ui("Research")}</option><option value="trade">{ui("Trade log")}</option></select>
    <button className="term-btn" onClick={() => { if (!discard()) return; setDraft({ symbol, title: "", body: "", kind: "research", image: null }); setError(""); }}>{ui("New entry")}</button>
  </div>
  {(error || loadError) && <p role="alert" className="down">{error || (loadError as Error)?.message}</p>}
  {draft && <p role="status" className={storageError ? "down" : "dim"}>{ui(storageError ? "Draft could not be saved on this device. Keep this page open and save your entry." : restored ? "Local draft restored. Changes save on this device until you save the entry." : "Draft saved on this device. Save entry to add it to your journal.")}</p>}
  {!draft && storageError && <p role="alert" className="down">{ui("Local draft storage is unavailable.")}</p>}
  {draft && <form className="space-y-2 border border-[var(--border)] p-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
    <div className="flex gap-2"><input aria-label={ui("Journal symbol")} required maxLength={20} value={draft.symbol} onChange={(e) => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })} /><select aria-label={ui("Entry category")} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as "research" | "trade" })}><option value="research">{ui("Research")}</option><option value="trade">{ui("Trade log")}</option></select></div>
    <input aria-label={ui("Entry title")} placeholder={ui("Research question or trade rationale")} className="w-full" required maxLength={120} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
    <textarea aria-label={ui("Entry notes")} placeholder={ui("Thesis, evidence, risks, entry/exit reasons, and outcome…")} rows={7} className="w-full" maxLength={20000} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
    <label className="block dim">{ui("Attach chart/image (PNG, JPEG, WebP; up to 1 MB)")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 1048576) { setError("Images must be no larger than 1 MB."); return; } const reader = new FileReader(); reader.onload = () => setDraft((d) => d ? { ...d, image: String(reader.result) } : d); reader.onerror = () => setError("Could not read image."); reader.readAsDataURL(file); }} /></label>
    {draft.image && <><img src={draft.image} alt="Attached research chart" className="max-h-64 max-w-full" /><button type="button" className="term-btn" onClick={() => setDraft({ ...draft, image: null })}>{ui("Remove image")}</button></>}
    <div className="flex gap-2"><button className="term-btn" disabled={save.isPending}>{ui("Save entry")}</button><button type="button" className="term-btn" onClick={() => { if (discard()) setDraft(null); }}>{ui("Discard draft")}</button></div>
  </form>}
  {data?.entries.map((entry) => <article key={entry.id} className="border-b border-[var(--border)] pb-2"><div className="flex gap-2"><button className="amber text-left" onClick={async () => { if (!discard()) return; try { const n = await apiGet<JournalEntry>(`/api/journal/${entry.id}`); setDraft({ ...n, image: n.image ?? null }); } catch (err) { setError((err as Error).message); } }}>{entry.symbol} · {entry.title}{entry.hasImage ? " ▧" : ""}</button><button aria-label={ui("Delete {value}", { value: entry.title })} className="dim ml-auto" onClick={async () => { if (!confirm(`Delete “${entry.title}”?`)) return; try { await apiDelete(`/api/journal/${entry.id}`); qc.invalidateQueries({ queryKey: ["journal"] }); if (draft?.id === entry.id) setDraft(null); } catch (err) { setError((err as Error).message); } }}>✕</button></div><p className="dim text-[10px]">{entry.kind} · {entry.created_at} UTC</p><p className="whitespace-pre-wrap">{entry.body}</p></article>)}
  {data?.entries.length === 0 && <p className="dim">{ui("No entries yet. Record a thesis or save a snapshot from a chart.")}</p>}
  <div className="flex gap-2">{before && <button className="term-btn" onClick={() => setBefore(undefined)}>{ui("Latest entries")}</button>}{data?.nextCursor && <button className="term-btn" onClick={() => setBefore(data.nextCursor!)}>{ui("Older entries")}</button>}</div>
  </div>;
}

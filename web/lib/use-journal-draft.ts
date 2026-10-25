"use client";
import { useCallback, useEffect, useState, useSyncExternalStore, type SetStateAction } from "react";
import { readJournalDraft, writeJournalDraft, type JournalDraft, type JournalSaved } from "./journal-drafts";

type Snapshot = { draft: JournalDraft | null; session: number; pending?: number; restored: boolean; storageError: boolean };
type Submission = { draft: JournalDraft; session: number; operation: number };
// One authoritative draft per editor key, including when an editor closes during a save.
const memory = new Map<string, Snapshot>();
const listeners = new Map<string, Set<() => void>>();
let serial = 0;
function publish(key: string, snapshot: Snapshot) {
  let storageError = false;
  try { writeJournalDraft(localStorage, key, snapshot.draft); } catch { storageError = true; }
  memory.set(key, { ...snapshot, storageError });
  listeners.get(key)?.forEach(notify => notify());
}
export function useJournalDraft(key: string, initial: JournalDraft | null) {
  const [fallback] = useState<Snapshot>(() => ({ draft: initial, session: ++serial, restored: false, storageError: false }));
  const current = useCallback(() => {
    if (!memory.has(key)) {
      let value: JournalDraft | null = null, storageError = false;
      try { value = readJournalDraft(localStorage, key); } catch { storageError = true; }
      memory.set(key, { ...fallback, draft: value ?? fallback.draft, restored: value !== null, storageError });
    }
    return memory.get(key)!;
  }, [key, fallback]);
  const subscribe = useCallback((notify: () => void) => {
    const callbacks = listeners.get(key) ?? new Set();
    callbacks.add(notify); listeners.set(key, callbacks);
    return () => { callbacks.delete(notify); if (!callbacks.size) listeners.delete(key); };
  }, [key]);
  const state = useSyncExternalStore(subscribe, current, () => fallback);
  useEffect(() => {
    const old = current();
    // "Write note" remounts this editor to start a new entry after a saved/discarded draft.
    if (fallback.draft && !old.draft && old.pending === undefined)
      publish(key, { ...old, draft: fallback.draft, session: ++serial, restored: false });
  }, [key, fallback, current]);
  const setDraft = (value: SetStateAction<JournalDraft | null>) => {
    const old = current();
    const draft = typeof value === "function" ? value(old.draft) : value;
    publish(key, { ...old, draft });
  };
  const startDraft = (draft: JournalDraft | null) => {
    publish(key, { ...current(), draft, session: ++serial, restored: false });
  };
  const beginSave = (version?: string): Submission | null => {
    const old = current();
    if (!old.draft || old.pending !== undefined) return null;
    const submission = { draft: { ...old.draft, ...(version ? { version } : {}) }, session: old.session, operation: ++serial };
    publish(key, { ...old, pending: submission.operation });
    return submission;
  };
  const finishSave = (submission: Submission, saved?: JournalSaved) => {
    const old = current();
    if (old.pending !== submission.operation) return;
    let draft = old.draft;
    if (saved && old.session === submission.session && draft) {
      // Ignore the version override used after an explicit conflict review.
      const submitted = { ...submission.draft, version: draft.version };
      const same = (["id", "version", "symbol", "title", "body", "kind", "image"] as const).every(field => draft![field] === submitted[field]);
      draft = same ? null : { ...draft, ...saved };
    }
    publish(key, { ...old, draft, pending: undefined });
  };
  useEffect(() => {
    const flush = () => publish(key, current());
    const warn = (event: BeforeUnloadEvent) => {
      flush(); const latest = current();
      if (latest.storageError && latest.draft) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("pagehide", flush); window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", warn); };
  }, [key, current]);
  return { ...state, setDraft, startDraft, beginSave, finishSave, saving: state.pending !== undefined };
}

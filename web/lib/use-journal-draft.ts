"use client";
import { useEffect, useRef, useState } from "react";
import { readJournalDraft, writeJournalDraft, type JournalDraft } from "./journal-drafts";

// Memory also retains drafts if this browser denies storage or its quota is full.
const memory = new Map<string, JournalDraft | null>();
export function useJournalDraft(key: string, initial: JournalDraft | null) {
  const [loaded] = useState(() => {
    try { return { value: memory.has(key) ? memory.get(key)! : readJournalDraft(localStorage, key), error: false }; }
    catch { return { value: memory.get(key) ?? null, error: true }; }
  });
  const [draft, setDraft] = useState<JournalDraft | null>(loaded.value ?? initial);
  const [storageError, setStorageError] = useState(loaded.error);
  const latest = useRef(draft); latest.current = draft;
  const persist = (value: JournalDraft | null) => {
    memory.set(key, value);
    try { writeJournalDraft(localStorage, key, value); return true; } catch { return false; }
  };
  useEffect(() => { setStorageError(!persist(draft)); }, [key, draft]);
  useEffect(() => {
    const flush = () => { persist(latest.current); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!persist(latest.current) && latest.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("pagehide", flush); window.addEventListener("beforeunload", beforeUnload);
    return () => { flush(); window.removeEventListener("pagehide", flush); window.removeEventListener("beforeunload", beforeUnload); };
  }, [key]);
  return { draft, setDraft, restored: loaded.value !== null, storageError };
}

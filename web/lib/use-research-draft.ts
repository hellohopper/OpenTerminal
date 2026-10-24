"use client";
import { useEffect, useState, useRef, type SetStateAction } from 'react';
const memory = new Map<string, unknown>();
function matchesShape(value: unknown, model: unknown): boolean {
  if(model === null) return value === null || typeof value === 'number' && Number.isFinite(value) || !!value && typeof value === 'object' && !Array.isArray(value);
  if(Array.isArray(model))return Array.isArray(value)&&value.length<=200&&value.every(v=>typeof v==='string'||typeof v==='number'&&Number.isFinite(v));
  if(model&&typeof model==='object')return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(model).every(([k,v])=>matchesShape((value as Record<string,unknown>)[k],v));
  return typeof value===typeof model&&(typeof value!=='number'||Number.isFinite(value));
}
export const RESEARCH_DRAFT_PREFIX = 'openterminal-research-draft-v1:';
// Each form is isolated by workspace/panel (or research symbol). Nothing is sent to the server until Save.
export function useResearchDraft<T extends Record<string, unknown>>(key: string, initial: T, validate: (value: T) => boolean = () => true) {
  const storageKey = RESEARCH_DRAFT_PREFIX + key;
  const load = () => {
    let value: unknown = memory.get(storageKey), error = false;
    try { const raw = localStorage.getItem(storageKey), saved = raw ? JSON.parse(raw) : null; if(!memory.has(storageKey)&&saved?.version===1)value=saved.value; }
    catch { error=true; }
    if(value && JSON.stringify(value).length<=100000 && matchesShape(value,initial) && validate(value as T))
      return {key,value:value as T,restored:true,error,dirty:true};
    return {key,value:initial,restored:false,error,dirty:false};
  };
  const [state, setState] = useState(load);
  const latest = useRef(state.value); latest.current = state.value;
  if (state.key !== key) setState(load());
  const save = (value: T, clear = false) => {
    latest.current = value;
    if(clear)memory.delete(storageKey);else memory.set(storageKey,value);
    let error = false;
    try {
      if (clear) localStorage.removeItem(storageKey);
      else { const raw = JSON.stringify({ version: 1, value }); if (raw.length > 100000) throw new Error('Draft too large'); localStorage.setItem(storageKey, raw); }
    } catch { error = true; }
    setState(s => ({ ...s, key, value, error, dirty: !clear, restored: clear ? false : s.restored }));
  };
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (state.error && state.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state.error, state.dirty]);
  return {
    ...state,
    field<K extends keyof T>(name: K): [T[K], (value: SetStateAction<T[K]>) => void] {
      return [state.value[name], value => save({ ...latest.current, [name]: typeof value === 'function' ? (value as (v: T[K]) => T[K])(latest.current[name]) : value })];
    },
    reset: () => save(initial, true),
    saved: () => save(latest.current, true),
  };
}

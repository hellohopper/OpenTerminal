"use client";
import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTerminal, type WidgetInstance } from '../store/terminal';
import type { PanelSettings } from './panel-settings';

/** Workspace-backed settings survive hiding, reflow, reload and workspace switches. */
export function useWidgetSetting<K extends keyof PanelSettings>(widget: WidgetInstance | undefined, key: K, initial: NonNullable<PanelSettings[K]>): [NonNullable<PanelSettings[K]>, Dispatch<SetStateAction<NonNullable<PanelSettings[K]>>>] {
  const saved = useTerminal(state => state.widgets.find(w => w.id === widget?.id)?.settings?.[key]);
  // Research views use temporary widgets outside the workspace store.
  const [local, setLocal] = useState(initial);
  const value = (saved ?? local) as NonNullable<PanelSettings[K]>;
  const setValue: Dispatch<SetStateAction<NonNullable<PanelSettings[K]>>> = next => {
    const current = useTerminal.getState().widgets.find(w => w.id === widget?.id);
    const before = (current?.settings?.[key] ?? local) as NonNullable<PanelSettings[K]>;
    const updated = typeof next === 'function' ? next(before) : next;
    if (current) useTerminal.getState().setWidgetSetting(current.id, key, updated);
    else setLocal(updated);
  };
  return [value, setValue];
}

"use client";
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** The same dialog stays mounted in the grid and in the top layer, preserving panel state. */
export default function PanelFrame({ maximized, onRestore, label, children }: { maximized: boolean; onRestore: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const scrollPositions: Array<[Element, number, number]> = [];
    for (let parent = dialog.parentElement; parent; parent = parent.parentElement) scrollPositions.push([parent, parent.scrollTop, parent.scrollLeft]);
    if (dialog.open) dialog.close();
    if (maximized) dialog.showModal(); else dialog.show();
    if (!maximized && previous?.isConnected) previous.focus({ preventScroll: true });
    if (!maximized) for (const [element, top, left] of scrollPositions) { element.scrollTop = top; element.scrollLeft = left; }
    return () => dialog.close();
  }, [maximized]);
  return <dialog ref={ref} role={maximized ? "dialog" : "region"} aria-modal={maximized || undefined} aria-label={label} className={`terminal-panel workspace-panel ${maximized ? "panel-maximized" : ""}`} onCancel={event => { event.preventDefault(); if (maximized) onRestore(); }}>{children}</dialog>;
}

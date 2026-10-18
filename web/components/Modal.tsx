"use client";
import { useEffect, useRef, type ReactNode } from "react";
/** Native modal provides focus trapping, Escape dismissal and focus restoration. */
export default function Modal({ label, onClose, children, className = "" }: { label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-label={label} onCancel={e => { e.preventDefault(); onClose(); }} className={`terminal-dialog ${className}`}>
    {children}
  </dialog>;
}

"use client";

import { useState } from "react";
import { useI18n } from "../lib/use-i18n";
import { usePreferences } from "../store/preferences";
import type { Preferences } from "../lib/preferences";

export default function SavedControls<K extends keyof Preferences>({ kind, value, onLoad }: {
  kind: K;
  value: Preferences[K][number]["value"];
  onLoad: (value: Preferences[K][number]["value"]) => void;
}) {
  const { t: ui } = useI18n();
  const { data, replace } = usePreferences();
  const [selected, setSelected] = useState(""), [name, setName] = useState("");
  const [message, setMessage] = useState<{ text: string; name?: string } | null>(null);
  const label = ui(kind === "groups" ? "watchlist group" : "screener preset");
  const items = data[kind];
  const run = (fn: () => void) => {
    try { fn(); setMessage({ text: "Saved on this device." }); }
    catch (error) { setMessage({ text: (error as Error).message }); }
  };
  return <div className="p-1 border-b border-[var(--border)] flex gap-1 flex-wrap items-center">
    <select aria-label={ui("Saved {name}", { name: label })} value={selected} onChange={(e) => {
      setSelected(e.target.value); setName(items.find((item) => item.id === e.target.value)?.name ?? "");
    }}><option value="">{ui("New {name}", { name: label })}</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
    <input className="w-36" aria-label={ui("{name} name", { name: label })} placeholder={ui("Name")} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} />
    <button className="term-btn" onClick={() => run(() => {
      const id = selected || crypto.randomUUID();
      replace({ ...data, [kind]: [...items.filter((item) => item.id !== id), { id, name, value }] }); setSelected(id);
    })}>{ui("Save {name}", { name: label })}</button>
    <button className="term-btn" disabled={!selected} onClick={() => {
      const item = items.find((entry) => entry.id === selected);
      if (item) { onLoad(item.value); setMessage({ text: "Loaded {name}.", name: item.name }); }
    }}>{ui("Load {name}", { name: label })}</button>
    <button className="term-btn" disabled={!selected} onClick={() => run(() => {
      replace({ ...data, [kind]: items.filter((item) => item.id !== selected) }); setSelected(""); setName("");
    })}>{ui("Delete {name}", { name: label })}</button>
    {message && <span role="status" className="dim">{ui(message.text, message.name === undefined ? undefined : { name: message.name })}</span>}
  </div>;
}

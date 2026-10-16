"use client";
import { useEffect, useState } from "react";
import { parseDrawings, type Drawing } from "../lib/chart-tools";
import { fmt } from "../lib/api";
export function useDrawings(key: string) {
  const [saved, setSaved] = useState<{ key: string; drawings: Drawing[] }>({
    key: "",
    drawings: [],
  });
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    try {
      setSaved({ key, drawings: parseDrawings(localStorage.getItem(key)) });
      setStorageError("");
    } catch {
      setSaved({ key, drawings: [] });
      setStorageError(
        "Browser storage unavailable; annotations last until this page closes.",
      );
    }
  }, [key]);
  useEffect(() => {
    if (saved.key !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify(saved.drawings));
    } catch {
      setStorageError("Annotations could not be saved in this browser.");
    }
  }, [key, saved]);
  return {
    drawings: saved.key === key ? saved.drawings : [],
    storageError,
    update: (fn: (d: Drawing[]) => Drawing[]) =>
      setSaved((s) => ({
        key,
        drawings: fn(s.key === key ? s.drawings : []).slice(-50),
      })),
  };
}
export type DrawTool = "navigate" | "horizontal" | "trend";
export default function ChartTools({
  tool,
  setTool,
  drawings,
  update,
  message,
  disabled,
}: {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  drawings: Drawing[];
  update: (fn: (d: Drawing[]) => Drawing[]) => void;
  message: string;
  disabled: boolean;
}) {
  return (
    <details className="shrink-0 border-b border-[var(--border)] p-1">
      <summary className="cursor-pointer amber">
        Drawing tools · {drawings.length} saved
      </summary>
      <div className="flex gap-1 flex-wrap py-1">
        {(["navigate", "horizontal", "trend"] as const).map((t) => (
          <button
            key={t}
            disabled={disabled}
            className={`term-btn ${tool === t ? "active" : ""}`}
            onClick={() => setTool(t)}
          >
            {t === "navigate"
              ? "Navigate"
              : t === "horizontal"
                ? "Horizontal line"
                : "Trend line"}
          </button>
        ))}
        <button
          className="term-btn"
          disabled={!drawings.length}
          onClick={() => update((d) => d.slice(0, -1))}
        >
          Undo drawing
        </button>
        <button
          className="term-btn"
          disabled={!drawings.length}
          onClick={() => {
            if (confirm("Clear drawings for this chart, symbol and range?"))
              update(() => []);
          }}
        >
          Clear drawings
        </button>
      </div>
      <p role="status" className="dim text-[10px]">
        {disabled
          ? "Return to price mode to draw."
          : message ||
            "Horizontal: click a price. Trend: click two different times in the main price pane. Escape cancels. Up to 50 drawings, saved in this browser per chart, symbol and range."}
      </p>
      {drawings.length > 0 && (
        <ul className="max-h-20 overflow-auto">
          {drawings.map((d, i) => (
            <li key={d.id} className="flex gap-2">
              <span>
                {i + 1}.{" "}
                {d.kind === "horizontal"
                  ? `Horizontal ${fmt(d.price)}`
                  : `Trend ${fmt(d.start.price)} → ${fmt(d.end.price)}`}
              </span>
              <button
                className="term-btn"
                aria-label={`Delete drawing ${i + 1}`}
                onClick={() =>
                  update((rows) => rows.filter((r) => r.id !== d.id))
                }
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

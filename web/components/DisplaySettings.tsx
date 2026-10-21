"use client";

import { useState } from "react";
import { DEFAULT_FONT_SIZE, MIN_FONT_SIZE, MAX_FONT_SIZE, useDisplay } from "../store/display";
import Modal from "./Modal";

export default function DisplaySettings() {
  const [open, setOpen] = useState(false);
  const fontSize = useDisplay((state) => state.fontSize);
  const setFontSize = useDisplay((state) => state.setFontSize);

  return <>
    <button className="term-btn display-settings-trigger" aria-label="Display settings" onClick={() => setOpen(true)}>
      Aa <span>{fontSize}px</span>
    </button>
    {open && <Modal label="Display settings" className="display-settings" onClose={() => setOpen(false)}>
      <div className="display-settings-heading">
        <h2 className="amber text-lg">Display settings</h2>
        <button className="term-btn" onClick={() => setOpen(false)}>Done</button>
      </div>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label htmlFor="terminal-font-size">Global font size</label>
          <output htmlFor="terminal-font-size" className="amber" aria-live="polite">{fontSize}px · {Math.round(fontSize / DEFAULT_FONT_SIZE * 100)}%</output>
        </div>
        <div className="display-size-controls">
          <button className="term-btn" aria-label="Decrease font size" disabled={fontSize <= MIN_FONT_SIZE} onClick={() => setFontSize(fontSize - 1)}>A−</button>
          <input id="terminal-font-size" type="range" min={MIN_FONT_SIZE} max={MAX_FONT_SIZE} step={1} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} aria-valuetext={`${fontSize} pixels`} />
          <button className="term-btn" aria-label="Increase font size" disabled={fontSize >= MAX_FONT_SIZE} onClick={() => setFontSize(fontSize + 1)}>A+</button>
        </div>
        <div className="display-size-presets">
          {[12, 14, 16, 18, 20].map((size) => <button key={size} className={`term-btn ${fontSize === size ? "active" : ""}`} aria-pressed={fontSize === size} onClick={() => setFontSize(size)}>{size}px</button>)}
        </div>
        <div className="display-preview space-y-2" aria-label="Font size preview">
          <p className="amber font-bold">Your terminal, easier to read</p>
          <div className="flex justify-between gap-3 flex-wrap"><span>AAPL · Apple Inc.</span><span className="up">+1.37%</span></div>
          <p className="dim">Text, controls and chart labels resize together.</p>
        </div>
        <p className="dim">Panels gain space and stack when needed. Changes save automatically in this browser.</p>
        <button className="term-btn" disabled={fontSize === DEFAULT_FONT_SIZE} onClick={() => setFontSize(DEFAULT_FONT_SIZE)}>Reset to default (12px)</button>
      </div>
    </Modal>}
  </>;
}

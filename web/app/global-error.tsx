"use client";
import { useI18n } from "../lib/use-i18n";

import "./globals.css";

// Last-resort fallback when the root layout itself throws; replaces <html>/<body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { t: ui, language } = useI18n();

  return (
    <html lang={language === "zh" ? "zh-CN" : "en"}>
      <body>
        <div className="p-4 flex flex-col gap-2 items-start">
          <span className="down">{ui("Terminal error:")} {error.message}</span>
          <button onClick={reset} className="dim hover:text-[var(--amber)]">{ui("Retry")} </button>
        </div>
      </body>
    </html>
  );
}

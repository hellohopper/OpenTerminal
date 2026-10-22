"use client";
import { useEffect, useState } from "react";
import { useI18n } from "../lib/use-i18n";

export default function RelativeTime({ value }: { value?: string | null }) {
  const { t: ui, locale } = useI18n();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  const time = value ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) return <span>{ui("Update time unavailable")}</span>;
  const seconds = Math.max(0, Math.floor(((now ?? time) - time) / 1000));
  const relative = seconds < 60 ? ui("Updated just now") : new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-Math.floor(seconds / (seconds < 3600 ? 60 : seconds < 86400 ? 3600 : 86400)), seconds < 3600 ? "minute" : seconds < 86400 ? "hour" : "day");
  return <time dateTime={value!} title={new Date(time).toLocaleString(locale)}>{relative}</time>;
}

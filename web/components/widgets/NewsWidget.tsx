"use client";
import { useI18n } from "../../lib/use-i18n";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { apiGet } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { useTerminal, useWidgetSymbol, type WidgetInstance } from "../../store/terminal";
import { selectNews, type NewsItem } from "../../lib/news";

export default function NewsWidget({ widget }: { widget: WidgetInstance }) {
  const { t: ui, locale } = useI18n();

  const symbol = useWidgetSymbol(widget);
  const [mode, setMode] = useState<"symbol" | "global">("symbol");
  const [articlesOnly, setArticlesOnly] = useState(true);
  const [filter, setFilter] = useState("");

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ["news", mode, symbol],
    queryFn: () => apiGet<NewsItem[]>(mode === "symbol" ? `/api/news?symbol=${encodeURIComponent(symbol)}` : "/api/news"),
    refetchInterval: 30_000,
  });
  const items = selectNews(data, articlesOnly, filter);

  return (
    <div>
      <div className="flex gap-1 p-1 flex-wrap">
        <button className={`term-btn ${mode === "symbol" ? "active" : ""}`} onClick={() => setMode("symbol")}>
          {symbol}
        </button>
        <button className={`term-btn ${mode === "global" ? "active" : ""}`} onClick={() => setMode("global")}>{ui("GLOBAL")} </button>
        <button className="term-btn" onClick={() => useTerminal.getState().openResearch(symbol)}>{ui("Research")} {symbol}</button>
      </div>
      <div className="flex gap-2 p-2 flex-wrap items-center">
        <label>{ui("News content")} <select aria-label={ui("News content")} value={articlesOnly ? "articles" : "all"} onChange={event => setArticlesOnly(event.target.value === "articles")}><option value="articles">{ui("Articles only")}</option><option value="all">{ui("All results")}</option></select></label>
        <input aria-label={ui("Filter news")} placeholder={ui("Filter news…")} value={filter} onChange={event => setFilter(event.target.value)} className="min-w-0 flex-1" />
      </div>
      {isLoading && <div className="p-2 dim">{ui("Loading news…")}</div>}
      {error && <div role="alert" className="p-2 down">{ui("Unable to load news.")} <button className="term-btn" onClick={() => refetch()}>{ui("Retry")}</button></div>}
      {!isLoading && !error && items.length === 0 && <p className="p-2 dim">{ui("No news matches these filters. Try All results or Global.")}</p>}
      {items.map((n, i) => {
        const body = (
          <>
            <div className="news-title" title={n.title}>{n.title}</div>
            <div className="news-meta dim text-[10px]">
              <span>{n.publisher}</span>
              {n.publishedAt && Number.isFinite(Date.parse(n.publishedAt)) && <time dateTime={n.publishedAt}>{new Date(n.publishedAt).toLocaleString(locale)}</time>}
            </div>
          </>
        );
        const className = "news-item";
        return isSafeHttpUrl(n.link) ? (
          <a key={i} href={n.link} target="_blank" rel="noreferrer" className={className}>
            {body}
          </a>
        ) : (
          <div key={i} className={className}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

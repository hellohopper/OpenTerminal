"use client";
import { useI18n } from "../../lib/use-i18n";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { apiGet, apiPost } from "../../lib/api";
import { isSafeHttpUrl } from "../../lib/links";
import { useTerminal } from "../../store/terminal";
type Source = {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  asOf: string | null;
  retrievedAt: string;
  data: unknown;
};
type Reply = {
  text: string;
  sources: Source[];
  warnings: string[];
  retrievedAt: string;
};
type Msg = { role: "user" | "assistant"; content: string; reply?: Reply };
function SourceList({ sources }: { sources: Source[] }) {
  const { t: ui } = useI18n();

  return (
    <details className="mt-1">
      <summary className="dim cursor-pointer">{ui("Sources & data (")}{sources.length})
      </summary>
      {sources.map((s) => (
        <details
          key={s.id}
          className="border-l border-[var(--border)] pl-2 my-2"
        >
          <summary className="cursor-pointer">
            <span className="amber">[{s.id}]</span> {s.title}
          </summary>
          {s.url && isSafeHttpUrl(s.url) && (
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="amber underline"
            >{ui("Open source")} </a>
          )}
          <p className="dim">{ui("As of:")} {s.asOf ?? ui("not supplied")} {ui("· Retrieved:")} {s.retrievedAt}
          </p>
          <pre className="whitespace-pre-wrap break-words text-[10px]">
            {JSON.stringify(s.data, null, 2)}
          </pre>
        </details>
      ))}
    </details>
  );
}
function Answer({ message }: { message: Msg }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      {message.content.split(/(\[S\d+\])/g).map((part, i) => {
        const source = message.reply?.sources.find((s) => `[${s.id}]` === part);
        return source?.url && isSafeHttpUrl(source.url) ? (
          <a
            key={i}
            className="amber underline"
            title={source.title}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {part}
          </a>
        ) : (
          <span key={i} title={source?.title} className={source ? "amber" : ""}>
            {part}
          </span>
        );
      })}
    </div>
  );
}
export default function AiWidget() {
  const symbol = useTerminal((s) => s.activeSymbol);
  return <Assistant key={symbol} symbol={symbol} />;
}
function Assistant({ symbol }: { symbol: string }) {
  const { t: ui } = useI18n();

  const [messages, setMessages] = useState<Msg[]>([]),
    [input, setInput] = useState("");
  const [validation, setValidation] = useState("");
  const [includeNews, setNews] = useState(true),
    [includeFinancials, setFinancials] = useState(true),
    [includeNotes, setNotes] = useState(false),
    [includePortfolio, setPortfolio] = useState(false);
  const [portfolioId, setPortfolioId] = useState<number | undefined>();
  const scroll = useRef<HTMLDivElement>(null);
  const { data: portfolios = [] } = useQuery({
    queryKey: ["portfolios"],
    queryFn: () => apiGet<{ id: number; name: string }[]>("/api/portfolios"),
    enabled: includePortfolio,
  });
  const options = {
    symbol,
    includeNews,
    includeFinancials,
    includeNotes,
    includePortfolio,
    ...(includePortfolio
      ? { portfolioId: portfolioId ?? portfolios[0]?.id }
      : {}),
  };
  const preview = useMutation({
    mutationFn: () =>
      apiPost<{ sources: Source[]; warnings: string[] }>(
        "/api/ai/context",
        options,
      ),
  });
  const chat = useMutation({
    mutationFn: (
      turn: Array<{ role: "user" | "assistant"; content: string }>,
    ) => apiPost<Reply>("/api/ai/chat", { ...options, messages: turn }),
    onSuccess: (reply) => {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: reply.text, reply },
      ]);
      setTimeout(() => scroll.current?.scrollTo({ top: 1e9 }), 50);
    },
  });
  const clearConversation = () => {
    setMessages([]);
    setValidation("");
    chat.reset();
    preview.reset();
  };
  const send = () => {
    const text = input.trim();
    if (!text || chat.isPending || preview.isPending) return;
    const next = [...messages, { role: "user" as const, content: text }];
    if (
      next.length > 20 ||
      next.reduce((n, m) => n + m.content.length, 0) > 24000
    ) {
      setValidation(
        "Conversation is too long. Clear chat to start a new question.",
      );
      return;
    }
    setValidation("");
    setMessages(next);
    setInput("");
    chat.mutate(next.map(({ role, content }) => ({ role, content })));
  };
  return (
    <div className="flex flex-col h-full">
      <fieldset
        disabled={chat.isPending || preview.isPending}
        className="flex gap-2 flex-wrap p-2 border-b border-[var(--border)]"
      >
        <span className="amber">{symbol}</span>
        <label>
          <input
            type="checkbox"
            checked={includeNews}
            onChange={(e) => setNews(e.target.checked)}
          />{" "}{ui("News")} </label>
        <label>
          <input
            type="checkbox"
            checked={includeFinancials}
            onChange={(e) => setFinancials(e.target.checked)}
          />{" "}{ui("Financials")} </label>
        <label>
          <input
            type="checkbox"
            checked={includeNotes}
            onChange={(e) => {
              setNotes(e.target.checked);
              clearConversation();
            }}
          />{" "}{ui("My notes")} </label>
        <label>
          <input
            type="checkbox"
            checked={includePortfolio}
            onChange={(e) => {
              setPortfolio(e.target.checked);
              clearConversation();
            }}
          />{" "}{ui("My portfolio")} </label>
        {includePortfolio && (
          <select
            aria-label={ui("AI portfolio context")}
            value={portfolioId ?? portfolios[0]?.id ?? ""}
            onChange={(e) => {
              setPortfolioId(Number(e.target.value));
              clearConversation();
            }}
          >
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <button className="term-btn" onClick={() => preview.mutate()}>{ui("Preview sources")} </button>
        <button className="term-btn" onClick={clearConversation}>{ui("Clear chat")} </button>
      </fieldset>
      <div ref={scroll} className="flex-1 overflow-auto p-2 space-y-3 min-h-0">
        {!messages.length && (
          <p className="dim">{ui("Ask about")} {symbol}{ui(". Answers can cite server-fetched quotes, SEC statements and headlines. Personal notes and holdings are shared with the configured AI provider only when selected. Source preview needs no AI key. Changing personal-data selections starts a fresh conversation.")} </p>
        )}
        {preview.data && (
          <div>
            <SourceList sources={preview.data.sources} />
            {preview.data.warnings.map((w) => (
              <p className="amber" key={w}>
                {w}
              </p>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <span className={m.role === "user" ? "amber" : "up"}>
              {m.role === "user" ? ui("YOU") : "AI"} ›
            </span>
            <Answer message={m} />
            {m.reply && (
              <>
                <SourceList sources={m.reply.sources} />
                {m.reply.warnings.map((w) => (
                  <p key={w} className="dim text-[10px]">
                    {w}
                  </p>
                ))}
              </>
            )}
          </div>
        ))}
        {(chat.isPending || preview.isPending) && (
          <p className="dim">
            {chat.isPending
              ? ui("Gathering evidence and researching…")
              : ui("Loading sources…")}
          </p>
        )}
        {validation && (
          <p role="alert" className="down">
            {validation}
          </p>
        )}
        {(chat.error || preview.error) && (
          <p role="alert" className="down">
            {(chat.error || preview.error)?.message}
          </p>
        )}
        {messages.length >= 19 && (
          <p className="amber">{ui("Conversation limit reached. Clear chat to start a new research question.")} </p>
        )}
      </div>
      <div className="flex gap-1 p-1 border-t border-[var(--border)]">
        <input
          aria-label={ui("AI research question")}
          className="flex-1 min-w-0"
          maxLength={4000}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
          }}
          placeholder={`Research ${symbol}…`}
        />
        <button
          className="term-btn"
          disabled={
            chat.isPending ||
            preview.isPending ||
            !input.trim() ||
            messages.length >= 19
          }
          onClick={send}
        >{ui("SEND")} </button>
      </div>
    </div>
  );
}

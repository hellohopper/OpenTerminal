import { cached } from "./cache.js";
import { getQuotes } from "./routes/market.js";
import { fundamentals } from "./providers/fundamentals.js";
import * as news from "./providers/news.js";
import { replayLedger, type Trade, type CashEvent } from "./portfolio.js";
import type { ResearchOptions } from "./research-schema.js";
export type ResearchSource = {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  asOf: string | null;
  retrievedAt: string;
  data: unknown;
};
type InputSource = Omit<ResearchSource, "id" | "retrievedAt">;
async function bounded<T>(task: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("source timeout")), 15000);
        timer.unref();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export async function gatherResearch(options: ResearchOptions) {
  const tasks: Array<{ name: string; load: () => Promise<InputSource[]> }> = [
    {
      name: "Quote",
      load: async () => {
        const quote = (await getQuotes([options.symbol]))[0];
        if (!quote || quote.price === null)
          throw new Error("quote unavailable");
        return [
          {
            kind: "quote",
            title: `${options.symbol} quote (${quote.source})`,
            url: quote.sourceUrl ?? null,
            asOf: quote.time ? new Date(quote.time * 1000).toISOString() : null,
            data: quote,
          },
        ];
      },
    },
  ];
  if (options.includeFinancials)
    tasks.push({
      name: "Financials",
      load: async () => {
        const f = await cached(
          `fundamentals:${options.symbol}:quarterly`,
          3600000,
          () => fundamentals(options.symbol, "quarterly"),
        );
        if (!f.rows.length) throw new Error("no financial statements");
        return [
          {
            kind: "financials",
            title: `${options.symbol} SEC financial statements (USD)`,
            url: f.sourceUrl,
            asOf:
              f.rows
                .flatMap((r) =>
                  [r.revenue?.filed, r.netIncome?.filed].filter(
                    (v): v is string => !!v,
                  ),
                )
                .sort()
                .at(-1) ?? null,
            data: f.rows.slice(-4),
          },
        ];
      },
    });
  if (options.includeNews)
    tasks.push({
      name: "News",
      load: async () => {
        const items = await cached(
          `research-news:${options.symbol}`,
          300000,
          () =>
            news
              .symbolNews(options.symbol)
              .catch(() => news.topNews(`${options.symbol} stock`)),
        );
        return news
          .dedupe([items])
          .filter((n) => {
            try {
              return ["http:", "https:"].includes(new URL(n.link).protocol);
            } catch {
              return false;
            }
          })
          .slice(0, 5)
          .map((n) => ({
            kind: "headline",
            title: n.title,
            url: n.link,
            asOf: n.publishedAt,
            data: {
              headline: n.title,
              publisher: n.publisher,
              limitation: "Headline only. Full article was not retrieved.",
            },
          }));
      },
    });
  if (options.includeNotes)
    tasks.push({
      name: "Research notes",
      load: async () => {
        const { db } = await import("./db.js");
        const rows = db
          .prepare(
            "SELECT id,title,body,kind,updated_at FROM journal_entries WHERE symbol=? ORDER BY id DESC LIMIT 3",
          )
          .all(options.symbol) as Array<{
          id: number;
          title: string;
          body: string;
          kind: string;
          updated_at: string;
        }>;
        return rows.map((n) => ({
          kind: "note",
          title: `Private journal: ${n.title}`,
          url: null,
          asOf: n.updated_at + "Z",
          data: {
            id: n.id,
            kind: n.kind,
            text: n.body.slice(0, 2000),
            limitation: "User-authored notes, not independently verified.",
          },
        }));
      },
    });
  if (options.includePortfolio && options.portfolioId)
    tasks.push({
      name: "Portfolio",
      load: async () => {
        const { db } = await import("./db.js");
        const portfolio = db
          .prepare("SELECT name FROM portfolios WHERE id=?")
          .get(options.portfolioId) as { name: string } | undefined;
        if (!portfolio) throw new Error("portfolio not found");
        const state = replayLedger(
          db
            .prepare("SELECT * FROM transactions WHERE portfolio_id=?")
            .all(options.portfolioId) as Trade[],
          db
            .prepare("SELECT * FROM portfolio_events WHERE portfolio_id=?")
            .all(options.portfolioId) as CashEvent[],
        );
        return [
          {
            kind: "portfolio",
            title: `Private portfolio: ${portfolio.name}`,
            url: null,
            asOf: new Date().toISOString(),
            data: {
              cash: state.cash,
              netDeposits: state.netDeposits,
              positions: [...state.positions]
                .slice(0, 30)
                .map(([symbol, p]) => ({ symbol, ...p })),
              limitation:
                "User-maintained ledger. Cash is incomplete if funding events are missing. No current valuation or allocation percentages supplied.",
            },
          },
        ];
      },
    });
  const results = await Promise.allSettled(tasks.map((t) => bounded(t.load)));
  const retrievedAt = new Date().toISOString();
  const sources = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .map((s, i) => ({ ...s, id: `S${i + 1}`, retrievedAt }));
  const warnings = results.flatMap((r, i) =>
    r.status === "rejected"
      ? [
          `${tasks[i].name} unavailable; no evidence from this source was supplied.`,
        ]
      : [],
  );
  if (sources.some((s) => s.kind === "quote" && s.asOf === null))
    warnings.push(
      "Quote timestamp unavailable; retrieval time is not the market observation time.",
    );
  return { symbol: options.symbol, retrievedAt, sources, warnings };
}
export function validateCitations(text: string, sources: ResearchSource[]) {
  const ids = new Set(sources.map((s) => s.id));
  return text.replace(/\[(S\d+)\]/g, (citation, id) =>
    ids.has(id) ? citation : "[unverified source]",
  );
}

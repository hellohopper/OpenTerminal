export type NewsItem = { title: string; link: string; publisher: string; publishedAt: string | null };

/** Provider RSS sometimes returns quote landing pages instead of reporting. */
export function isQuotePage(item: NewsItem) {
  return /\b[A-Z]{1,6}\d{6}[CP]\d{6,8}\b/.test(item.title) || /interactive stock chart|stock options chain|stock historical prices?\s*(?:&|and)\s*data|stock price,?\s*news,?\s*quote\s*(?:&|and)\s*history/i.test(item.title);
}
export function selectNews(items: NewsItem[], articlesOnly: boolean, query = "") {
  const seen = new Set<string>();
  return items.filter(item => {
    if (articlesOnly && isQuotePage(item)) return false;
    const key = item.title.toLowerCase().replace(/\s*[-|]\s*yahoo!? finance(?:\s+(?:uk|canada|australia|singapore))?\s*$/i, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return `${item.title} ${item.publisher}`.toLowerCase().includes(query.trim().toLowerCase());
  });
}

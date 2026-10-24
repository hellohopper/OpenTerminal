/** Only bounded, serializable UI choices travel with workspace exports. */
export type PanelSettings = {
  sourceRecord?: { kind: "expiry" | "reconciliation"; id: number };
  optionExpiry?: { symbol: string; date: string };
  optionGreeks?: boolean;
  optionRate?: string;
  optionDividend?: string;
  optionIv?: string;
  optionView?: 'auto' | 'both' | 'calls' | 'puts';
  optionColumns?: string[];
  comparisonDraft?: string;
  comparisonSymbols?: string[];
  comparisonRange?: string;
  chartRange?: string;
  chartType?: string;
  chartIndicators?: string[];
  chartOverlayDraft?: string;
  chartOverlaySymbols?: string[];
  chartCompareMode?: boolean;
  newsMode?: 'symbol' | 'global';
  newsArticlesOnly?: boolean;
  newsFilter?: string;
  fundamentalFrequency?: string;
};
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 500;
const list = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 20 && v.every(text);
const oneOf = (...values: string[]) => (v: unknown) => typeof v === 'string' && values.includes(v);
const checks: Record<keyof PanelSettings, (value: unknown) => boolean> = {
  sourceRecord: v => !!v && typeof v === "object" && ["expiry", "reconciliation"].includes((v as {kind:string}).kind) && Number.isSafeInteger((v as {id:number}).id) && (v as {id:number}).id > 0,
  optionExpiry: v => !!v && typeof v === 'object' && text((v as {symbol:unknown}).symbol) && /^\d{4}-\d{2}-\d{2}$/.test(String((v as {date:unknown}).date)),
  optionGreeks: v => typeof v === 'boolean', optionRate: text, optionDividend: text, optionIv: text,
  optionView: oneOf('auto', 'both', 'calls', 'puts'),
  optionColumns: v => list(v) && v.length > 0 && v.every(key => ['last', 'bid', 'ask', 'volume', 'oi', 'iv'].includes(key)),
  comparisonDraft: text, comparisonSymbols: list, comparisonRange: oneOf('6M', '1Y', '5Y'),
  chartRange: oneOf('1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y', 'MAX'), chartType: oneOf('candles', 'bars', 'line', 'area'),
  chartIndicators: v => list(v) && v.every(key => ['SMA20', 'SMA50', 'SMA200', 'EMA20', 'VWAP', 'BOLL', 'RSI', 'MACD'].includes(key)),
  chartOverlayDraft: text, chartOverlaySymbols: list, chartCompareMode: v => typeof v === 'boolean',
  newsMode: oneOf('symbol', 'global'), newsArticlesOnly: v => typeof v === 'boolean', newsFilter: text,
  fundamentalFrequency: oneOf('quarterly', 'annual'),
};
export function readPanelSettings(value: unknown): PanelSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => Object.hasOwn(checks, key) && checks[key as keyof PanelSettings](item)));
}

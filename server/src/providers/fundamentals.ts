import { edgarFetch, resolveCik } from "./secedgar.js";
type Fact = { start?: string; end: string; val: number; accn: string; filed: string; form: string };
export type FinancialValue = { value: number; filingUrl: string; filed: string; derived: boolean; periodStart: string | null; periodEnd: string; componentUrls: string[] };
const TAGS = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  netIncome: ["NetIncomeLoss", "ProfitLoss"], operatingCashFlow: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment"], assets: ["Assets"], liabilities: ["Liabilities"],
};
const days = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86400000;
export function extractFinancials(data: any, frequency: "quarterly" | "annual", cik: string) {
  const gaap = data.facts?.["us-gaap"] ?? {};
  const facts = Object.fromEntries(Object.entries(TAGS).map(([metric, tags]) => {
    const byPeriod = new Map<string, Fact>();
    // Prefer the modern tag when multiple concepts cover the same period.
    for (const tag of [...tags].reverse()) {
      const rows: Fact[] = gaap[tag]?.units?.USD ?? [];
      for (const row of [...rows].sort((a, b) => a.filed.localeCompare(b.filed))) {
        if (!Number.isFinite(row.val) || !/^\d{4}-\d\d-\d\d$/.test(row.end) || !["10-K", "10-Q", "10-K/A", "10-Q/A"].includes(row.form) || !/^\d{10}-\d{2}-\d{6}$/.test(row.accn)) continue;
        byPeriod.set(`${row.start ?? "instant"}:${row.end}`, row);
      }
    }
    return [metric, [...byPeriod.values()]];
  })) as Record<keyof typeof TAGS, Fact[]>;
  const value = (f: Fact, amount = f.val, derived = false, periodStart:string|null=f.start??null, componentUrls:string[]=[]): FinancialValue => ({ value: amount, filed: f.filed, derived, periodStart,periodEnd:f.end,componentUrls, filingUrl: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${f.accn.replace(/-/g, "")}/${f.accn}-index.html` });
  const flow = (rows: Fact[], end: string): FinancialValue | null => {
    const candidates = rows.filter((f) => f.end === end && f.start);
    const direct = candidates.find((f) => frequency === "annual" ? days(f.start!, end) >= 300 && days(f.start!, end) <= 400 : days(f.start!, end) >= 60 && days(f.start!, end) <= 110);
    if (direct) return value(direct);
    if (frequency === "annual") return null;
    for (const cumulative of candidates) {
      const previous = rows.find((f) => f.start === cumulative.start && days(f.end, end) >= 60 && days(f.end, end) <= 110);
      if (previous) return value(cumulative, cumulative.val - previous.val, true,new Date(Date.parse(previous.end)+86400000).toISOString().slice(0,10),[value(cumulative).filingUrl,value(previous).filingUrl]);
    }
    return null;
  };
  const allEnds = [...new Set([...facts.revenue, ...facts.netIncome].map((f) => f.end))].sort();
  const rows = allEnds.map((end) => {
    const revenue = flow(facts.revenue, end), netIncome = flow(facts.netIncome, end);
    const operatingCashFlow = flow(facts.operatingCashFlow, end), capex = flow(facts.capex, end);
    return { end, revenue, netIncome, operatingCashFlow, capex,
      freeCashFlow: operatingCashFlow && capex ? operatingCashFlow.value - capex.value : null,
      assets: facts.assets.find((f) => f.end === end && !f.start) ? value(facts.assets.find((f) => f.end === end && !f.start)!) : null,
      liabilities: facts.liabilities.find((f) => f.end === end && !f.start) ? value(facts.liabilities.find((f) => f.end === end && !f.start)!) : null,
      netMargin: revenue && revenue.value > 0 && netIncome ? netIncome.value / revenue.value * 100 : null,
    };
  }).filter((r) => r.revenue || r.netIncome);
  return rows.map((row) => {
    const previous = rows.find((r) => days(r.end, row.end) >= 350 && days(r.end, row.end) <= 380);
    return { ...row, revenueYoY: row.revenue && previous?.revenue && previous.revenue.value > 0 ? (row.revenue.value / previous.revenue.value - 1) * 100 : null };
  }).slice(-12);
}
export async function fundamentals(symbol: string, frequency: "quarterly" | "annual") {
  const cik = await resolveCik(symbol);
  if (!cik) throw new Error("No SEC registrant found for this symbol");
  const sourceUrl = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
  const data = await edgarFetch(sourceUrl);
  return { symbol, name: data.entityName ?? symbol, currency: "USD", frequency, sourceUrl, retrievedAt: new Date().toISOString(), rows: extractFinancials(data, frequency, cik) };
}

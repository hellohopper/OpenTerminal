import type { WidgetType } from "./workspaces";
import { WIDGET_CATALOG } from "./widget-catalog";
import { zh } from "./zh";

export type Language = "en" | "zh";
export type TranslationValues = Record<string, string | number>;

export function translate(text: string, language: Language, values?: TranslationValues): string {
  const translated = language === "zh" ? zh[text] ?? text : text;
  return values ? translated.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  ) : translated;
}

export const WIDGET_NAMES_ZH: Record<WidgetType, string> = {
  chart: "行情图表", quote: "实时报价", watchlist: "自选列表", news: "新闻",
  screener: "股票筛选", heatmap: "市场热力图", crypto: "加密资产", macro: "宏观与指数",
  options: "期权链", portfolio: "投资组合", ai: "AI 研究助手", calendar: "财经日历",
  insider: "内部人交易", tv: "财经直播", recap: "市场回顾", comparison: "资产对比",
  fundamentals: "公司财务", journal: "研究日志", performance: "组合收益与风险",
  strategy: "期权策略", briefing: "个人市场简报", alerts: "价格提醒", quality: "数据质量",
  backup: "备份与恢复", sync: "设备同步", delivery: "定时简报", events: "持仓事件",
  signals: "技术信号", thesis: "投资观点", reviews: "交易复盘", rebalance: "再平衡模拟",
  filings: "SEC 文件追踪", notifications: "通知中心", tracking: "筛选变化", backtest: "回测与回放",
  today: "今日工作台", historyLibrary: "历史数据中心", valuationLab: "估值分析",
  portfolioRisk: "组合压力与相关性", paper: "模拟交易", consolidated: "多币种账本",
  filingReader: "SEC 文件阅读", earningsReview: "财报复盘", researchSearch: "研究搜索",
  peers: "同业财务对比", thesisMonitor: "观点证据监测", accountImport: "账户导入与核对",
  portfolioGuards: "组合风险规则", optionPositions: "期权持仓与到期", walkforward: "样本外策略验证",
};

export function widgetName(type: WidgetType, language: Language, short = false) {
  return language === "zh" ? WIDGET_NAMES_ZH[type] : WIDGET_CATALOG[type][short ? "label" : "title"];
}

export function matchesWidget(type: WidgetType, query: string) {
  const item = WIDGET_CATALOG[type];
  return (item.title + " " + item.label + " " + item.group + " " + translate(item.group, "zh") + " " + WIDGET_NAMES_ZH[type]).toLowerCase().includes(query.trim().toLowerCase());
}

import { describe, expect, it } from "vitest";
import { matchesWidget, translate, widgetName } from "../../web/lib/i18n";
import { WIDGET_TYPES } from "../../web/lib/workspaces";

describe("interface languages", () => {
  it("renders English verbatim and interpolates Chinese labels without translating user values", () => {
    expect(translate("UI settings", "en")).toBe("UI settings");
    expect(translate("UI settings", "zh")).toBe("界面设置");
    expect(translate("Switch to {name}", "zh", { name: "My Research / Save" })).toBe("切换到My Research / Save");
    expect(translate("Research {symbol}", "en", { symbol: "IWM" })).toBe("Research IWM");
    expect(translate("unrecognized provider message", "zh")).toBe("unrecognized provider message");
  });

  it("has Chinese names for every panel and finds features in either language", () => {
    for (const type of WIDGET_TYPES) {
      expect(widgetName(type, "zh")).toMatch(/[\u3400-\u9fff]/);
      expect(matchesWidget(type, widgetName(type, "zh"))).toBe(true);
      expect(matchesWidget(type, widgetName(type, "en"))).toBe(true);
    }
    expect(matchesWidget("chart", "图表")).toBe(true);
    expect(matchesWidget("chart", "市场")).toBe(true);
    expect(matchesWidget("chart", "CHART")).toBe(true);
    expect(matchesWidget("chart", "not a feature")).toBe(false);
  });
});

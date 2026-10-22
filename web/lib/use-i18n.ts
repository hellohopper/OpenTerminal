"use client";

import { useCallback } from "react";
import { useDisplay } from "../store/display";
import { translate, widgetName, type TranslationValues } from "./i18n";
import type { WidgetType } from "./workspaces";

export function useI18n() {
  const language = useDisplay((state) => state.language);
  const t = useCallback((text: string, values?: TranslationValues) => translate(text, language, values), [language]);
  const widgetTitle = useCallback((type: WidgetType) => widgetName(type, language), [language]);
  const widgetLabel = useCallback((type: WidgetType) => widgetName(type, language, true), [language]);
  return { t, language, locale: language === "zh" ? "zh-CN" : "en-US", widgetTitle, widgetLabel };
}

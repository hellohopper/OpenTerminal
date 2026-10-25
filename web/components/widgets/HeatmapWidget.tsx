"use client";
import { useI18n } from "../../lib/use-i18n";

import { usePollingQuery as useQuery } from "../../lib/use-polling-query";
import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { apiGet } from "../../lib/api";
import { useTerminal } from "../../store/terminal";
import { DEFAULT_FONT_SIZE, useDisplay } from "../../store/display";

type Cell = { symbol: string; name: string | null; sector: string; marketCap: number | null; changePercent: number | null };

export default function HeatmapWidget() {
  const { t: ui } = useI18n();

  const scale = useDisplay((state) => state.fontSize) / DEFAULT_FONT_SIZE;
  const ref = useRef<HTMLDivElement>(null);
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [market, setMarket] = useState<"us" | "eu">("us");
  const { data, error } = useQuery({
    queryKey: ["heatmap", market],
    queryFn: () => apiGet<Cell[]>(`/api/heatmap?market=${market}`),
    refetchInterval: 3_000,
  });

  useEffect(() => {
    const el = ref.current;
    if (!el || !data) return;

    const render = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width === 0 || height === 0) return;
      el.innerHTML = "";

      const valid = data.filter((d) => d.marketCap && d.changePercent !== null);
      type Node = { name: string; children?: Node[]; data?: Cell };
      const root = d3
        .hierarchy<Node>({
          name: "root",
          children: [...d3.group(valid, (d) => d.sector)].map(([sector, items]) => ({
            name: sector,
            children: items.map((d) => ({ name: d.symbol, data: d })),
          })),
        })
        .sum((d) => d.data?.marketCap ?? 0)
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

      d3.treemap<Node>().size([width, height]).paddingInner(1).paddingTop(12 * scale)(root);

      const color = (chg: number) => {
        const clamped = Math.max(-3, Math.min(3, chg));
        return clamped >= 0
          ? d3.interpolateRgb("#1a1a1a", "#00c853")(clamped / 3)
          : d3.interpolateRgb("#1a1a1a", "#ff3d3d")(-clamped / 3);
      };

      const svg = d3.select(el).append("svg").attr("width", width).attr("height", height);

      // Clip each sector label to its own column so long names never bleed
      // into the neighboring sector (the visible cause of overlapping text).
      const sectorClipId = (name: string) => `sector-clip-${name.replace(/[^a-zA-Z0-9]/g, "")}`;

      svg
        .selectAll("clipPath.sector-clip")
        .data(root.children ?? [])
        .join("clipPath")
        .attr("class", "sector-clip")
        .attr("id", (d: any) => sectorClipId(d.data.name))
        .append("rect")
        .attr("x", (d: any) => d.x0)
        .attr("y", (d: any) => d.y0)
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0 - 4))
        .attr("height", 12 * scale);

      svg
        .selectAll("text.sector")
        .data((root.children ?? []).filter((d: any) => d.x1 - d.x0 > 20))
        .join("text")
        .attr("class", "sector")
        .attr("x", (d: any) => d.x0 + 3)
        .attr("y", (d: any) => d.y0 + 9 * scale)
        .attr("clip-path", (d: any) => `url(#${sectorClipId(d.data.name)})`)
        .attr("fill", "#808080")
        .attr("font-size", 8 * scale)
        .text((d: any) => d.data.name.toUpperCase());

      const leaf = svg
        .selectAll("g.leaf")
        .data(root.leaves())
        .join("g")
        .attr("class", "leaf")
        .attr("transform", (d: any) => `translate(${d.x0},${d.y0})`)
        .style("cursor", "pointer")
        .on("click", (_e, d: any) => setActiveSymbol(d.data.data.symbol));

      leaf
        .append("rect")
        .attr("width", (d: any) => Math.max(0, d.x1 - d.x0))
        .attr("height", (d: any) => Math.max(0, d.y1 - d.y0))
        .attr("fill", (d: any) => color(d.data.data.changePercent))
        .append("title")
        .text((d: any) => `${d.data.data.symbol} ${d.data.data.name ?? ""}: ${d.data.data.changePercent?.toFixed(2)}%`);

      leaf
        .filter((d: any) => d.x1 - d.x0 > Math.max(32, d.data.data.symbol.length * 6 + 6) * scale && d.y1 - d.y0 > 18 * scale)
        .append("text")
        .attr("x", 3)
        .attr("y", 11 * scale)
        .attr("fill", "#fff")
        .attr("font-size", 9 * scale)
        .attr("font-weight", "bold")
        .text((d: any) => d.data.data.symbol);

      leaf
        .filter((d: any) => d.x1 - d.x0 > 45 * scale && d.y1 - d.y0 > 30 * scale)
        .append("text")
        .attr("x", 3)
        .attr("y", 22 * scale)
        .attr("fill", "#ddd")
        .attr("font-size", 8 * scale)
        .text((d: any) => `${d.data.data.changePercent >= 0 ? "+" : ""}${d.data.data.changePercent.toFixed(2)}%`);
    };

    render();
    const obs = new ResizeObserver(render);
    obs.observe(el);
    return () => obs.disconnect();
  }, [data, setActiveSymbol, scale]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 p-1 shrink-0">
        {(["us", "eu"] as const).map((m) => (
          <button key={m} className={`term-btn ${market === m ? "active" : ""}`} onClick={() => setMarket(m)}>
            {m.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {error ? (
          <div className="p-2 down">{ui("Error:")} {(error as Error).message}</div>
        ) : !data ? (
          <div className="p-2 dim">{ui("Loading heatmap…")}</div>
        ) : (
          <div ref={ref} className="w-full h-full" />
        )}
      </div>
    </div>
  );
}

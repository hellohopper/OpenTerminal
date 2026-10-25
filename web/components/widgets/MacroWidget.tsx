"use client";
import { useI18n } from "../../lib/use-i18n";

import { usePollingQuery as useQuery } from "../../lib/use-polling-query";
import { useState } from "react";
import { apiGet, fmt, pctClass } from "../../lib/api";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from "recharts";
import { useTerminal } from "../../store/terminal";
import Flash from "../Flash";
import DataStatus from "../DataStatus";
import { useAdaptiveRefresh } from "../../lib/use-adaptive-refresh";
import { DEFAULT_FONT_SIZE, useDisplay } from "../../store/display";

type MacroData = {
  yields: Array<{ tenor: string; value: number | null }>;
  vix: number | null;
  indexes: Array<{ symbol: string; label: string; price: number | null; changePercent: number | null }>;
  policyRate: number | null;
  inflation: number | null;
};

export default function MacroWidget() {
  const { t: ui } = useI18n();

  const polling = useAdaptiveRefresh();
  const setActiveSymbol = useTerminal((s) => s.setActiveSymbol);
  const [region, setRegion] = useState<"us" | "eu">("us");
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["macro", region],
    queryFn: () => apiGet<MacroData>(`/api/macro?region=${region}`),
    enabled: polling.active,
    refetchInterval: polling.interval,
  });

  return (
    <div ref={polling.ref}>
      <div className="flex gap-1 p-1">
        {(["us", "eu"] as const).map((r) => (
          <button key={r} className={`term-btn ${region === r ? "active" : ""}`} onClick={() => setRegion(r)}>
            {ui(r.toUpperCase())}
          </button>
        ))}
      </div>
      <DataStatus hasData={!!data} loading={isLoading} fetching={isFetching} error={error} updatedAt={dataUpdatedAt} onRefresh={refetch} />
      {data && <MacroBody data={data} region={region} setActiveSymbol={setActiveSymbol} />}
    </div>
  );
}

function MacroBody({
  data,
  region,
  setActiveSymbol,
}: {
  data: MacroData;
  region: "us" | "eu";
  setActiveSymbol: (s: string) => void;
}) {
  const { t: ui } = useI18n();

  const scale = useDisplay((state) => state.fontSize) / DEFAULT_FONT_SIZE;
  return (
    <div>
      <div className="px-2 py-1 dim text-[10px] uppercase flex justify-between">
        <span>{region === "eu" ? ui("Euro Area AAA Yield Curve") : ui("US Treasury Yield Curve")}</span>
        {region === "us" && data.vix !== null && (
          <span className="cursor-pointer" onClick={() => setActiveSymbol("^VIX")}>
            VIX <Flash value={data.vix} className="amber">{fmt(data.vix, 2)}</Flash>
          </span>
        )}
        {region === "eu" && (data.policyRate !== null || data.inflation !== null) && (
          <span>
            {data.policyRate !== null && (
              <>{ui("ECB depo")} <Flash value={data.policyRate} className="amber">{fmt(data.policyRate, 2)}%</Flash></>
            )}
            {data.inflation !== null && (
              <>
                {" "}HICP <Flash value={data.inflation} className="amber">{fmt(data.inflation, 1)}%</Flash>
              </>
            )}
          </span>
        )}
      </div>
      <div className="h-24 px-1">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.yields} margin={{ top: 4 * scale, right: 12 * scale, bottom: 0, left: -22 * scale }}>
            <XAxis height={30 * scale} minTickGap={20 * scale} dataKey="tenor" stroke="#808080" fontSize={9 * scale} />
            <YAxis width={60 * scale} stroke="#808080" fontSize={9 * scale} domain={["auto", "auto"]} />
            <Tooltip
              contentStyle={{ background: "#111", border: "1px solid #262626", fontSize: 10 * scale }}
              labelStyle={{ color: "#808080" }}
            />
            <Line type="monotone" dataKey="value" stroke="#ff9900" strokeWidth={1.5} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="data-table">
        <thead>
          <tr><th>{ui("Index / Commodity")}</th><th>{ui("Last")}</th><th>{ui("Chg%")}</th></tr>
        </thead>
        <tbody>
          {data.indexes.map((q) => (
            <tr key={q.symbol} onClick={() => setActiveSymbol(q.symbol)}>
              <td>{q.label}</td>
              <td><Flash value={q.price}>{fmt(q.price)}</Flash></td>
              <td className={pctClass(q.changePercent)}>
                <Flash value={q.changePercent}>{fmt(q.changePercent)}%</Flash>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { DEFAULT_FONT_SIZE, useDisplay } from "../store/display";
const COLORS = ["#ff9900", "#4fc3f7", "#b39ddb", "#00c853", "#ff5252"];
export default function AnalysisChart({ rows, series, xKey = "date", numericX = false }: { rows: Record<string, string | number>[]; series: string[]; xKey?: string; numericX?: boolean }) {
  const scale = useDisplay((state) => state.fontSize) / DEFAULT_FONT_SIZE;
  return <div className="w-full h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 20, left: 0, bottom: 5 }}>
    <CartesianGrid stroke="#262626" strokeDasharray="3 3" /><XAxis height={30 * scale} type={numericX ? "number" : "category"} domain={numericX ? ["dataMin", "dataMax"] : undefined} dataKey={xKey} tick={{ fill: "#808080", fontSize: 10 * scale }} minTickGap={40 * scale} /><YAxis width={60 * scale} domain={["auto", "auto"]} tick={{ fill: "#808080", fontSize: 10 * scale }} tickFormatter={(n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 })} />
    <Tooltip contentStyle={{ background: "#111", border: "1px solid #333" }} formatter={(v: number) => v.toFixed(2)} /><Legend />
    {series.map((key, i) => <Line key={key} dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
  </LineChart></ResponsiveContainer></div>;
}

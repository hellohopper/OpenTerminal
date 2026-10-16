"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
const COLORS = ["#ff9900", "#4fc3f7", "#b39ddb", "#00c853", "#ff5252"];
export default function AnalysisChart({ rows, series, xKey = "date" }: { rows: Record<string, string | number>[]; series: string[]; xKey?: string }) {
  return <div className="w-full h-64 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 20, left: 0, bottom: 5 }}>
    <CartesianGrid stroke="#262626" strokeDasharray="3 3" /><XAxis dataKey={xKey} tick={{ fill: "#808080", fontSize: 10 }} minTickGap={40} /><YAxis domain={["auto", "auto"]} tick={{ fill: "#808080", fontSize: 10 }} tickFormatter={(n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 })} />
    <Tooltip contentStyle={{ background: "#111", border: "1px solid #333" }} formatter={(v: number) => v.toFixed(2)} /><Legend />
    {series.map((key, i) => <Line key={key} dataKey={key} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />)}
  </LineChart></ResponsiveContainer></div>;
}

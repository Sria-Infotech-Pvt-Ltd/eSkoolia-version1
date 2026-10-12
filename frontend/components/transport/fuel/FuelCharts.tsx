"use client";
/** Fuel charts (Master Prompt §7.12): single-hue #6D4AFF; hover updates the card-header label (no tooltip box). */
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr } from "@/lib/transport/format";
import { T } from "@/components/transport/ui";

function ChartCard({ title, sub, label, children }: { title: string; sub: string; label: string; children: React.ReactNode }) {
  return (
    <div className="tp-card" style={{ padding: 16, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{title}</span>
        <span aria-live="polite" style={{ fontSize: 12, color: T.muted, whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <div style={{ fontSize: 12, color: T.muted, marginTop: 2, marginBottom: 10 }}>{sub}</div>
      {children}
    </div>
  );
}

const axisTick = { fill: T.exInk3 };

export function SpendByVehicleChart({ data }: { data: { plate: string; amount: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.amount, 0);
  const max = Math.max(5000, Math.ceil(Math.max(0, ...data.map((d) => d.amount)) / 5000) * 5000);
  const hovered = active !== null ? data[active] : null;
  return (
    <ChartCard title="Spend by vehicle · MTD" sub="October 2026 · hover a bar for detail"
      label={hovered ? `${hovered.plate} · ${inr(hovered.amount)}` : `Total ${inr(total)}`}>
      <div style={{ height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: -14 }}
            onMouseMove={(s) => { const i = s?.activeTooltipIndex; setActive(i === undefined || i === null ? null : Number(i)); }}
            onMouseLeave={() => setActive(null)}>
            <CartesianGrid vertical={false} stroke={T.track} />
            <XAxis dataKey="plate" tickFormatter={(p: string) => p.replace(/\s/g, "").slice(-4)} interval={0}
              tick={{ ...axisTick, fontSize: 8.5 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, max]} ticks={[0, max / 2, max]} tickFormatter={(v: number) => `₹${Math.round(v / 1000)}k`}
              tick={{ ...axisTick, fontSize: 9.5 }} axisLine={false} tickLine={false} />
            <Tooltip content={() => null} cursor={false} />
            <Bar dataKey="amount" radius={[3, 3, 0, 0]} maxBarSize={20} isAnimationActive={false}>
              {data.map((d, i) => <Cell key={d.plate} fill={i === active ? T.puDeep : T.pu} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function EfficiencyTrendChart({ data }: { data: { week: string; kml: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const hovered = active !== null ? data[active] : null;
  const last = data[data.length - 1];
  return (
    <ChartCard title="Fleet efficiency trend" sub="Average km per litre · last 8 weeks"
      label={hovered ? `${hovered.week} · ${hovered.kml.toFixed(1)} km/L` : `Now ${last?.kml.toFixed(1) ?? "—"} km/L`}>
      <div style={{ height: 230 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}
            onMouseMove={(s) => { const i = s?.activeTooltipIndex; setActive(i === undefined || i === null ? null : Number(i)); }}
            onMouseLeave={() => setActive(null)}>
            <CartesianGrid vertical={false} stroke={T.track} />
            <XAxis dataKey="week" tick={{ ...axisTick, fontSize: 9.5 }} axisLine={false} tickLine={false} />
            <YAxis domain={[5, 7]} ticks={[5, 6, 7]} tick={{ ...axisTick, fontSize: 9.5 }} axisLine={false} tickLine={false} />
            <Tooltip content={() => null} cursor={false} />
            <Line type="monotone" dataKey="kml" stroke={T.pu} strokeWidth={2.2} isAnimationActive={false}
              dot={{ r: 3.5, fill: "#fff", stroke: T.pu, strokeWidth: 2 }} activeDot={{ r: 5, fill: "#fff", stroke: T.pu, strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

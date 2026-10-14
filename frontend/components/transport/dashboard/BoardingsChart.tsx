"use client";
/** "Boardings this week" area chart (Master Prompt §7.1): morning boardings per day from the register. Hover updates the header label. */
import { useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { num } from "@/lib/transport/format";
import { SideCard, T } from "@/components/transport/ui";

export function BoardingsChart({ data }: { data: { day: string; value: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const hovered = active !== null ? data[active] : null;

  return (
    <SideCard>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.exInk1 }}>Boardings this week</span>
        <span style={{ fontSize: 12, color: T.muted }} aria-live="polite">
          {hovered ? `${hovered.day} · ${num(hovered.value)} boardings` : `Total ${num(total)}`}
        </span>
      </div>
      <div style={{ fontSize: 11.5, color: T.exInk2, marginTop: 2, marginBottom: 8 }}>Morning pickups boarded, last 7 days, all routes</div>
      <div style={{ height: 150 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 6, right: 6, bottom: 0, left: -18 }}
            onMouseMove={(s) => {
              const idx = s?.activeTooltipIndex;
              setActive(idx === undefined || idx === null ? null : Number(idx));
            }}
            onMouseLeave={() => setActive(null)}
          >
            <defs>
              <linearGradient id="tpBoardingsFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={T.exPu} stopOpacity={0.22} />
                <stop offset="100%" stopColor={T.exPu} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={T.track} />
            <XAxis dataKey="day" tick={{ fontSize: 9, fill: T.exInk3 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, "auto"]} allowDecimals={false} tick={{ fontSize: 9, fill: T.exInk3 }} axisLine={false} tickLine={false}
              tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
            <Tooltip content={() => null} cursor={false} />
            <Area type="monotone" dataKey="value" stroke={T.exPu} strokeWidth={2} fill="url(#tpBoardingsFill)"
              dot={{ r: 3, fill: "#fff", stroke: T.exPu, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: "#fff", stroke: T.exPu, strokeWidth: 2 }} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </SideCard>
  );
}

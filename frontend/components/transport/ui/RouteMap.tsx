"use client";
/**
 * Stylised SVG route map (Master Prompt §6.1 geometry, §7.6). Pure inline SVG,
 * viewBox 600×480, school at (300,240). Used by Pickup Points; Live Tracking
 * (Phase 3) reuses it and draws bus markers through `children`.
 */
import type { TransportRoute } from "@/lib/transport/types";
import { T } from "./tokens";

export interface RouteMapProps {
  routes: TransportRoute[];
  /** Stop ids that pass the page filters; others drop to .18 opacity. Omit = all visible. */
  visibleStopIds?: Set<string>;
  /** Highlighted route code (null = all routes). */
  highlight: string | null;
  focusedStopId?: string | null;
  onSelectStop?: (stopId: string) => void;
  showStops?: boolean;
  /** Override the route path style (Live Tracking). Default follows §7.6 highlight rules. */
  routeStyle?: (route: TransportRoute) => { width: number; opacity: number };
  ariaLabel?: string;
  children?: React.ReactNode;
}

export function RouteMap({
  routes, visibleStopIds, highlight, focusedStopId, onSelectStop, showStops = true, routeStyle, ariaLabel = "Route map", children,
}: RouteMapProps) {
  const focused = focusedStopId
    ? routes.flatMap((r) => r.stops.map((s) => ({ s, r }))).find((x) => x.s.id === focusedStopId) ?? null
    : null;

  return (
    <svg viewBox="0 0 600 480" role="img" aria-label={ariaLabel}
      style={{ width: "100%", height: "auto", display: "block", background: T.surface2, borderRadius: 12 }}>
      {/* Water */}
      <ellipse cx={505} cy={420} rx={48} ry={26} fill="#EFF6FF" />
      <ellipse cx={80} cy={60} rx={36} ry={20} fill="#EFF6FF" />
      {/* Roads */}
      <g fill="none" stroke="#FFFFFF" strokeLinecap="round">
        <path d="M-10 132 C 150 102, 430 182, 610 150" strokeWidth={14} />
        <path d="M-10 356 C 170 386, 420 316, 610 344" strokeWidth={12} />
        <path d="M150 -10 C 122 150, 196 320, 166 490" strokeWidth={12} />
        <path d="M448 -10 C 476 140, 414 330, 452 490" strokeWidth={14} />
        <path d="M0 240 L600 240" strokeWidth={8} />
        <path d="M300 0 L300 480" strokeWidth={8} />
      </g>

      {/* Route paths: outer stop → … → school */}
      {routes.map((r) => {
        const on = highlight === r.code;
        const style = routeStyle ? routeStyle(r) : { width: on ? 3 : 1.6, opacity: highlight === null ? 0.55 : on ? 1 : 0.15 };
        const opacity = style.opacity;
        const pts = [...r.stops.map((s) => `${s.x.toFixed(1)},${s.y.toFixed(1)}`), "300,240"].join(" ");
        return (
          <polyline key={r.code} points={pts} fill="none" stroke={T.pu} strokeWidth={style.width}
            strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" opacity={opacity} />
        );
      })}

      {/* School */}
      <rect x={282} y={222} width={36} height={36} rx={9} fill={T.ink} />
      <text x={300} y={244} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff" style={{ fontFamily: "Inter, sans-serif" }}>SCH</text>

      {/* Stop markers */}
      {showStops && routes.map((r) => r.stops.map((s) => {
        if (s.id === focusedStopId) return null;
        const dim = (visibleStopIds && !visibleStopIds.has(s.id)) || (highlight !== null && highlight !== r.code);
        return (
          <g key={s.id} opacity={dim ? 0.18 : 1} style={{ cursor: onSelectStop ? "pointer" : undefined }}
            onClick={onSelectStop ? () => onSelectStop(s.id) : undefined}>
            <title>{`${s.name} · ${r.code} stop ${s.seq}`}</title>
            <circle cx={s.x} cy={s.y} r={7} fill={T.pu} stroke="#fff" strokeWidth={1.5} />
            <text x={s.x} y={s.y + 2.6} textAnchor="middle" fontSize={7.5} fontWeight={800} fill="#fff" style={{ fontFamily: "Inter, sans-serif", pointerEvents: "none" }}>{s.seq}</text>
          </g>
        );
      }))}

      {children}

      {/* Focused marker + tooltip card */}
      {showStops && focused && (() => {
        const { s, r } = focused;
        const below = s.y < 70;
        const cardX = Math.max(4, Math.min(600 - 174, s.x - 85));
        const cardY = below ? s.y + 19 : s.y - 59;
        return (
          <g>
            <circle cx={s.x} cy={s.y} r={18} fill={T.pu} opacity={0.18} />
            <circle cx={s.x} cy={s.y} r={11} fill={T.puDeep} stroke="#fff" strokeWidth={1.5} />
            <text x={s.x} y={s.y + 3.4} textAnchor="middle" fontSize={9.5} fontWeight={800} fill="#fff" style={{ fontFamily: "Inter, sans-serif" }}>{s.seq}</text>
            <g transform={`translate(${cardX} ${cardY})`}>
              <rect width={170} height={40} rx={8} fill="#fff" stroke={T.cardBd} />
              <text x={10} y={17} fontSize={11} fontWeight={800} fill={T.ink} style={{ fontFamily: "Inter, sans-serif" }}>
                {s.name.length > 24 ? `${s.name.slice(0, 23)}…` : s.name}
              </text>
              <text x={10} y={31} fontSize={10} fill={T.muted} style={{ fontFamily: "Inter, sans-serif" }}>
                {`${r.code} · stop ${s.seq} · ${s.students} students`}
              </text>
            </g>
          </g>
        );
      })()}
    </svg>
  );
}

export function MapLegend() {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: T.muted, marginTop: 10 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: T.pu }} /> Pickup point
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <svg width={22} height={6} aria-hidden><line x1={1} y1={3} x2={21} y2={3} stroke={T.pu} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" /></svg>
        Route path
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 10, height: 10, borderRadius: 3, background: T.ink }} /> School
      </span>
    </div>
  );
}

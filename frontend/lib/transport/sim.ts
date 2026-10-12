/**
 * Live-tracking simulation (Master Prompt §7.9). Deterministic: everything is a
 * function of the tick count and each bus's accumulated progress.
 */
import { addMinutes } from "./format";
import type { TransportRoute } from "./types";

export const P0 = [0.9, 0.55, 0.46, 0.6, 0.7, 0.36, 0.42, 0.66, 0.3];
export const V = [0.006, 0.007, 0.004, 0.006, 0.008, 0.006, 0.0045, 0.006, 0.007];
export const LATE_MIN: Record<string, number> = { R3: 14, R7: 9 };

export type BusStatus = "At school" | "Running late" | "Overspeed" | "On route";

export interface BusState {
  routeCode: string;
  routeName: string;
  zone: TransportRoute["zone"];
  plate: string;
  driver: string;
  progress: number;
  x: number;
  y: number;
  speed: number;
  status: BusStatus;
  lateMin: number;
  nextStopIdx: number | null; // index into route.stops, or route.stops.length = school gate
  nextStopName: string;
  etaMin: number | null;
  pingSec: number;
  /** Cumulative fraction at each stop, then 1 for the school gate. */
  fractions: number[];
}

/** Index into P0 / V for a route (canonical order; new routes wrap around). */
export function simIndex(route: TransportRoute): number {
  return route.geoIdx % 9;
}

export function initialProgress(routes: TransportRoute[]): Record<string, number> {
  return Object.fromEntries(routes.map((r) => [r.code, P0[simIndex(r)]]));
}

/** One tick: progress += V[i] * (0.7 + ((tick + i) % 5) * 0.15), capped at 1. */
export function advance(progress: Record<string, number>, routes: TransportRoute[], tick: number): Record<string, number> {
  const next: Record<string, number> = { ...progress };
  routes.forEach((r) => {
    const i = simIndex(r);
    const p = next[r.code] ?? P0[i];
    next[r.code] = Math.min(1, p + V[i] * (0.7 + ((tick + i) % 5) * 0.15));
  });
  return next;
}

function polyline(route: TransportRoute): { x: number; y: number }[] {
  return [...route.stops.map((s) => ({ x: s.x, y: s.y })), { x: 300, y: 240 }];
}

function cumulative(pts: { x: number; y: number }[]): number[] {
  const out = [0];
  for (let k = 1; k < pts.length; k++) out.push(out[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
  return out;
}

/** Saved Settings thresholds (§7.14): overspeed limit (km/h) and late-arrival threshold (min). */
export interface SimThresholds { overspeedLimit: number; lateThresholdMin: number }
const DEFAULT_THRESHOLDS: SimThresholds = { overspeedLimit: 50, lateThresholdMin: 8 };

export function busState(route: TransportRoute, progress: number, tick: number, th: SimThresholds = DEFAULT_THRESHOLDS): BusState {
  const i = simIndex(route);
  const pts = polyline(route);
  const cum = cumulative(pts);
  const total = cum[cum.length - 1] || 1;
  const fractions = cum.map((c) => c / total);
  const p = Math.max(0, Math.min(1, progress));

  // Interpolate the position along the polyline by cumulative length.
  const target = p * total;
  let seg = 0;
  while (seg < cum.length - 2 && cum[seg + 1] < target) seg++;
  const segLen = cum[seg + 1] - cum[seg] || 1;
  const t = Math.max(0, Math.min(1, (target - cum[seg]) / segLen));
  const x = pts[seg].x + (pts[seg + 1].x - pts[seg].x) * t;
  const y = pts[seg].y + (pts[seg + 1].y - pts[seg].y) * t;

  const atSchool = p >= 1;
  let speed = 26 + ((tick * 7 + i * 11) % 18);
  if (route.code === "R5" && tick % 12 < 4) speed += 24;
  if (atSchool) speed = 0;
  // A bus counts as late once it is past the saved late threshold; overspeed fires
  // 5 km/h above the saved limit (50 → the spec's ">55").
  const lateMin = (LATE_MIN[route.code] ?? 0) > th.lateThresholdMin ? LATE_MIN[route.code] : 0;
  const status: BusStatus = atSchool ? "At school" : lateMin > 0 ? "Running late" : speed > th.overspeedLimit + 5 ? "Overspeed" : "On route";

  const n = route.stops.length;
  const nextIdx = atSchool ? null : fractions.findIndex((f) => f > p + 1e-9);
  const nextStopIdx = nextIdx === null || nextIdx < 0 ? null : nextIdx;
  const nextStopName = nextStopIdx === null ? "—" : nextStopIdx >= n ? "School gate" : route.stops[nextStopIdx].name;
  const etaMin = nextStopIdx === null ? null : Math.max(1, Math.round((fractions[nextStopIdx] - p) * (n * 6 + 12)));

  return {
    routeCode: route.code, routeName: route.name, zone: route.zone, plate: route.busReg, driver: route.driverName,
    progress: p, x, y, speed, status, lateMin, nextStopIdx, nextStopName, etaMin,
    pingSec: ((tick + i * 3) % 9) + 2, fractions,
  };
}

const STATUS_ORDER: Record<BusStatus, number> = { Overspeed: 0, "Running late": 1, "On route": 2, "At school": 3 };
export function byStatus(a: BusState, b: BusState): number {
  return STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.routeCode.localeCompare(b.routeCode, undefined, { numeric: true });
}

/** Scheduled time at a stop plus the bus's late minutes. */
export function expectedTime(hhmm: string, lateMin: number): string {
  return addMinutes(hhmm, lateMin);
}

"use client";
/**
 * Live Tracking — /transport/live (Master Prompt §7.9). Buses come from the
 * store's routes (bus + crew edits in Routes show here); positions come from
 * lib/transport/sim.ts on a 1 s interval that stops while paused and is
 * cleared on unmount.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigation } from "lucide-react";
import { useOwnerName, useTransport } from "@/lib/transport/store";
import { P0, advance, busState, byStatus, expectedTime, initialProgress, simIndex, type BusState } from "@/lib/transport/sim";
import { addMinutes, fmtTime, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { TransportRoute, Zone } from "@/lib/transport/types";
import {
  Badge, ContextBar, HeroPrimary, HeroSecondary, KpiCard, KpiGrid, OutlineButton, PageHero, ProgressBar, RouteMap,
  SearchRow, SmartFilter, T, TransportPage, useDeepLink, useMountSkeleton, useTpToast, type FilterChip, type Tone,
} from "@/components/transport/ui";

const ALL = "all";

function useLiveSim(routes: TransportRoute[], playing: boolean) {
  const routesRef = useRef(routes);
  routesRef.current = routes;
  const [sim, setSim] = useState(() => ({ tick: 0, progress: initialProgress(routes) }));
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setSim((s) => {
        const tick = s.tick + 1;
        return { tick, progress: advance(s.progress, routesRef.current, tick) };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [playing]);
  return sim;
}

function statusBadge(b: BusState): { tone: Tone; text: string } {
  if (b.status === "Running late") return { tone: "red", text: `Running late +${b.lateMin}m` };
  if (b.status === "Overspeed") return { tone: "red", text: "Overspeed" };
  if (b.status === "At school") return { tone: "green", text: "At school" };
  return { tone: "blue", text: "On route" };
}

function Micro({ label, children, color }: { label: string; children: React.ReactNode; color?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.label }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: color ?? T.ink, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</div>
    </div>
  );
}

export function LiveTrackingPage() {
  const { state, dispatch } = useTransport();
  const { routes } = state;
  const owner = useOwnerName();
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [playing, setPlaying] = useState(true);
  const sim = useLiveSim(routes, playing);
  const [selected, setSelected] = useState<string>(() => (routes.some((r) => r.code === "R3") ? "R3" : routes[0]?.code ?? ""));
  const [ctxRoute, setCtxRoute] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fZone, setFZone] = useState(ALL);
  const [fSpeed, setFSpeed] = useState(ALL);
  const [fGps, setFGps] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const limit = state.settings.thresholds.overspeed;
  const lateThreshold = state.settings.thresholds.lateMin;
  const buses = useMemo(
    () => routes.map((r) => busState(r, sim.progress[r.code] ?? P0[simIndex(r)], sim.tick, { overspeedLimit: limit, lateThresholdMin: lateThreshold })),
    [routes, sim, limit, lateThreshold],
  );
  const lateNote = buses.filter((b) => b.lateMin > 0).map((b) => `${b.routeCode} +${b.lateMin} min`).join(" · ") || "No buses running late";

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return buses.filter((b) => {
      const route = routes.find((r) => r.code === b.routeCode)!;
      if (ctxRoute !== ALL && b.routeCode !== ctxRoute) return false;
      if (fStatus !== ALL && b.status !== fStatus) return false;
      if (fZone !== ALL && b.zone !== fZone) return false;
      if (fSpeed === "over50" && !(b.speed > limit)) return false;
      if (fSpeed === "upto50" && b.speed > limit) return false;
      if (fGps === "stale" && b.pingSec < 8) return false;
      if (q && ![b.plate, b.routeCode, b.routeName, b.driver, ...route.stops.map((s) => s.name)].join(" ").toLowerCase().includes(q)) return false;
      return true;
    }).sort(byStatus);
  }, [buses, routes, ctxRoute, fStatus, fZone, fSpeed, fGps, applied, limit]);

  const visibleCodes = new Set(visible.map((b) => b.routeCode));
  const sel = buses.find((b) => b.routeCode === selected) ?? null;
  const selRoute = routes.find((r) => r.code === selected) ?? null;

  const SPEED: Record<string, string> = { over50: `Over ${limit} km/h`, upto50: `${limit} km/h or less` };
  const chips: FilterChip[] = [
    ...(ctxRoute !== ALL ? [{ label: `Route: ${ctxRoute}`, tone: "purple" as const }] : []),
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus}`, tone: "purple" as const }] : []),
    ...(fZone !== ALL ? [{ label: `Zone: ${fZone}`, tone: "purple" as const }] : []),
    ...(fSpeed !== ALL ? [{ label: `Speed: ${SPEED[fSpeed]}`, tone: "purple" as const }] : []),
    ...(fGps !== ALL ? [{ label: "GPS: Stale (8 s+)", tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  const moving = buses.filter((b) => b.status !== "At school");
  const avgSpeed = moving.length ? Math.round(moving.reduce((s, b) => s + b.speed, 0) / moving.length) : 0;
  const lateCount = buses.filter((b) => b.status === "Running late").length;
  const atSchool = buses.length - moving.length;

  const csv: CsvColumn<BusState>[] = [
    { header: "Bus", value: (b) => b.plate }, { header: "Route", value: (b) => `${b.routeCode} · ${b.routeName}` }, { header: "Driver", value: (b) => b.driver },
    { header: "Status", value: (b) => b.status }, { header: "Speed (km/h)", value: (b) => b.speed }, { header: "Progress %", value: (b) => Math.round(b.progress * 100) },
    { header: "Next stop", value: (b) => b.nextStopName }, { header: "ETA (min)", value: (b) => b.etaMin ?? "" }, { header: "Last ping (s)", value: (b) => b.pingSec },
  ];

  useDeepLink(({ id }) => {
    if (!id) return;
    const r = routes.find((x) => x.code === id || x.busReg === id);
    if (r) setSelected(r.code);
  });

  const resetFilters = () => { setCtxRoute(ALL); setFStatus(ALL); setFZone(ALL); setFSpeed(ALL); setFGps(ALL); setQuery(""); setApplied(""); };

  const raiseAlert = () => {
    if (!sel) return;
    const type = sel.status === "Overspeed" ? "Overspeed" : sel.status === "Running late" ? "Late arrival" : "Route deviation";
    const severity = sel.status === "Overspeed" ? "Critical" : sel.status === "Running late" ? "Warning" : "Info";
    dispatch({
      type: "alert/raise",
      input: {
        title: `${type} — ${sel.plate} on Route ${sel.routeCode}`, type, severity, routeCode: sel.routeCode, state: "open",
        detail: `Raised from Live Tracking by ${owner} · ${sel.speed} km/h · next ${sel.nextStopName}`,
      },
    });
    toast(`Alert raised for ${sel.plate} — see Alerts tab`);
  };

  const livePill = (
    <span style={{
      height: 22, padding: "0 9px", borderRadius: 999, background: T.puSoft, color: T.pu, fontSize: 11, fontWeight: 800, letterSpacing: "0.06em",
      display: "inline-flex", alignItems: "center", gap: 6,
    }}>
      <span className={playing ? "tp-pulse" : undefined} style={{ width: 7, height: 7, borderRadius: 999, background: playing ? T.pu : T.ink3 }} />
      {playing ? "LIVE" : "PAUSED"}
    </span>
  );

  return (
    <TransportPage>
      <ContextBar icon={Navigation} note="Morning pickup · 06 Oct 2026 · GPS ping every 10 s" selects={[
        { label: "Route", value: ctxRoute, onChange: (v) => { setCtxRoute(v); if (v !== ALL) setSelected(v); },
          options: [{ value: ALL, label: "All routes" }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))] },
      ]} />

      <PageHero eyebrow="Transport · Live" eyebrowAddon={livePill} title="Live" accent="tracking"
        sub="Every bus on the morning pickup, positioned from its GPS feed. Select a bus to follow it and see its stop-by-stop progress."
        actions={<>
          <HeroSecondary download={false} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause feed" : "Resume feed"}</HeroSecondary>
          <HeroPrimary icon={false} onClick={() => toast(`ETA links sent to parents on ${plural(moving.length, "bus", "buses")}`, "info")}>
            <Navigation size={15} strokeWidth={1.8} /> Share ETA with parents
          </HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="On road" value={`${moving.length} / ${buses.length}`} sub="Morning pickup in progress" />
        <KpiCard loading={loading} label="Avg speed" value={`${avgSpeed} km/h`} sub={`Limit ${limit} km/h in city`} color={T.pu} />
        <KpiCard loading={loading} label="Running late" value={lateCount} sub={lateNote} color={T.red} />
        <KpiCard loading={loading} label="At school" value={atSchool} sub="Students handed over at gate" color={T.green} />
      </KpiGrid>

      <SmartFilter chips={chips} onReset={resetFilters} fields={[
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus,
          options: [{ value: ALL, label: "All statuses" }, ...["On route", "Running late", "Overspeed", "At school"].map((s) => ({ value: s, label: s }))] },
        { key: "zone", label: "Zone", value: fZone, onChange: setFZone,
          options: [{ value: ALL, label: "All zones" }, ...(["West", "North", "South"] as Zone[]).map((z) => ({ value: z, label: z }))] },
        { key: "speed", label: "Speed", value: fSpeed, onChange: setFSpeed,
          options: [{ value: ALL, label: "Any speed" }, { value: "over50", label: `Over ${limit} km/h` }, { value: "upto50", label: `${limit} km/h or less` }] },
        { key: "gps", label: "GPS", value: fGps, onChange: setFGps,
          options: [{ value: ALL, label: "Any ping" }, { value: "stale", label: "Stale (8 s+)" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={() => setApplied(query.trim())} placeholder="Search by bus, route, driver or stop…"
        allSelected={false} onToggleAll={() => toast("Select buses from the list to act on them", "info")}
        onExport={() => { downloadCsv("gps-trail-today.csv", csv, buses); toast("GPS trail for today exported"); }} />

      <div className="tp-split tp-split--live">
        {/* Bus list */}
        <div className="tp-card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.rowBd}` }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Buses</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{visible.length} shown · sorted by status</div>
          </div>
          <div style={{ background: T.page, padding: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 720, overflowY: "auto" }}>
            {visible.length === 0 && <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: T.muted }}>No buses match these filters.</div>}
            {visible.map((b) => {
              const on = b.routeCode === selected;
              const badge = statusBadge(b);
              return (
                <button key={b.routeCode} type="button" className="tp-bus-card tp-link-reset" onClick={() => setSelected(b.routeCode)} aria-pressed={on}
                  style={{
                    background: "#fff", border: `1px solid ${on ? T.pu : T.cardBd}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8,
                    boxShadow: on ? "0 0 0 3px rgba(108,60,225,0.12)" : undefined, width: "100%",
                  }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span className="tp-mono" style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{b.plate}</span>
                    <Badge tone={badge.tone}>{badge.text}</Badge>
                  </span>
                  <span style={{ fontSize: 12, color: T.muted }}>{b.routeCode} · {b.routeName} · {b.driver}</span>
                  <span style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.8fr", gap: 8 }}>
                    <Micro label="Speed" color={b.speed > limit ? T.red : undefined}>{b.speed} km/h</Micro>
                    <Micro label="Next stop">{b.nextStopName}</Micro>
                    <Micro label="ETA">{b.etaMin !== null ? `${b.etaMin} min` : "—"}</Micro>
                  </span>
                  <ProgressBar value={b.progress * 100} />
                  <span style={{ fontSize: 11, color: T.ink3 }}>Last ping {b.pingSec} s ago</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Map + timeline */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div className="tp-card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>
                  {sel ? <><span className="tp-mono">{sel.plate}</span> · <span style={{ fontWeight: 500, color: T.muted }}>{sel.routeCode} · {sel.routeName}</span></> : "No bus selected"}
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                  {!sel ? "" : sel.status === "At school" ? "Arrived at school"
                    : `${sel.driver} · ${sel.speed} km/h · next ${sel.nextStopName} in ${sel.etaMin ?? 0} min${sel.lateMin ? ` · ${sel.lateMin} min late` : ""}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <OutlineButton disabled={!sel} onClick={() => sel && toast(`Calling ${sel.driver} via masked number`, "info")}>Call driver</OutlineButton>
                <OutlineButton disabled={!sel} onClick={raiseAlert}>Raise alert</OutlineButton>
              </div>
            </div>

            <RouteMap routes={routes} highlight={null} showStops={false} ariaLabel="Live bus map"
              routeStyle={(r) => (r.code === selected ? { width: 3, opacity: 1 } : { width: 1.4, opacity: visibleCodes.has(r.code) ? 0.35 : 0.1 })}>
              {selRoute && sel && selRoute.stops.map((s, k) => {
                const passed = sel.fractions[k] <= sel.progress;
                return <circle key={s.id} cx={s.x} cy={s.y} r={4} fill={passed ? T.pu : "#fff"} stroke={T.pu} strokeWidth={1.5} />;
              })}
              {buses.map((b) => {
                const on = b.routeCode === selected;
                const alarm = b.status === "Running late" || b.status === "Overspeed";
                return (
                  <g key={b.routeCode} className="tp-bus" style={{ transform: `translate(${b.x}px, ${b.y}px)` }}
                    opacity={visibleCodes.has(b.routeCode) ? 1 : 0.25} onClick={() => setSelected(b.routeCode)}>
                    <title>{`${b.plate} · ${b.routeCode} · ${b.status}`}</title>
                    {on && <circle r={22} fill={T.pu} opacity={0.18} />}
                    <rect x={-17} y={-11} width={34} height={22} rx={7} fill={on ? T.pu : "#fff"} stroke={alarm ? "#DC2626" : T.pu} strokeWidth={2} />
                    <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={800} fill={on ? "#fff" : T.ink} style={{ fontFamily: "Inter, sans-serif", pointerEvents: "none" }}>{b.routeCode}</text>
                  </g>
                );
              })}
            </RouteMap>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: T.muted, marginTop: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 10, borderRadius: 4, background: T.pu }} /> Selected bus</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 10, borderRadius: 4, background: "#fff", border: `2px solid ${T.pu}` }} /> Other buses</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 10, borderRadius: 4, background: "#fff", border: "2px solid #DC2626" }} /> Running late</span>
            </div>
          </div>

          {selRoute && sel && (
            <div className="tp-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginBottom: 12 }}>Stop timeline · {selRoute.code} · {selRoute.name}</div>
              {[...selRoute.stops.map((s, k) => ({ key: s.id, name: s.name, sub: plural(s.students, "student"), time: s.pickupTime, k })),
                { key: "school", name: "School gate", sub: "Destination", time: addMinutes(selRoute.firstPickup, selRoute.routeTimeMin), k: selRoute.stops.length }]
                .map((row, idx, arr) => {
                  const passed = sel.fractions[row.k] <= sel.progress;
                  const current = sel.nextStopIdx === row.k;
                  const last = idx === arr.length - 1;
                  const status = passed ? (row.k === selRoute.stops.length ? "Arrived" : "Departed") : current ? `Next · ${sel.etaMin ?? 0} min` : "Upcoming";
                  const statusColor = passed ? T.ok : current ? T.pu : T.ink3;
                  return (
                    <div key={row.key} style={{ display: "flex", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14, flexShrink: 0 }}>
                        <span style={{
                          width: 14, height: 14, borderRadius: 999, marginTop: 2, flexShrink: 0,
                          background: passed ? "#22C55E" : current ? T.pu : "#fff",
                          boxShadow: passed || current ? undefined : "inset 0 0 0 2px #D6D7E0",
                        }} />
                        {!last && <span style={{ width: 2, flex: 1, minHeight: 18, background: passed ? "#22C55E" : "#E3E3EC" }} />}
                      </div>
                      <div style={{ flex: 1, display: "flex", justifyContent: "space-between", gap: 10, paddingBottom: last ? 0 : 12, minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: current ? 800 : 600, color: passed ? T.ink2 : T.ink }}>{row.name}</div>
                          <div style={{ fontSize: 11.5, color: T.muted }}>{row.sub}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="tp-mono" style={{ fontSize: 12, color: T.ink }}>{fmtTime(expectedTime(row.time, sel.lateMin))}</div>
                          <div style={{ fontSize: 11.5, fontWeight: 700, color: statusColor }}>{status}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>
    </TransportPage>
  );
}

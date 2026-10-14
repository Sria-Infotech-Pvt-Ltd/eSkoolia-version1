"use client";
/**
 * Live Tracking — /transport/live (Master Prompt §7.9). One card per vehicle on
 * a route. Positions come from the GPS feed (GET bus-locations/live/, refreshed
 * every 10 s while the feed is on); the next stop is the one the backend tracks
 * from geofence arrivals. Positions sent by the development simulator
 * (manage.py simulate_bus_gps) are labelled SIMULATED; a vehicle that has not
 * reported yet shows "No GPS" instead of a made-up position.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigation } from "lucide-react";
import { loadLive, type LivePosition } from "@/lib/transport/api";
import { useOwnerName, useTransport } from "@/lib/transport/store";
import { TODAY, clockOf, fmtDate, fmtTime, plural, toISO } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { TransportRoute, Vehicle } from "@/lib/transport/types";
import {
  Badge, ContextBar, HeroPrimary, HeroSecondary, KpiCard, KpiGrid, OutlineButton, PageHero, ProgressBar, RouteMap,
  SearchRow, SmartFilter, T, TransportPage, useDeepLink, useMountSkeleton, useTpToast, type FilterChip, type Tone,
} from "@/components/transport/ui";

const ALL = "all";
const POLL_MS = 10_000;
/** A position older than this is "stale". */
const STALE_SEC = 120;

type BusStatus = "Overspeed" | "Running late" | "On route" | "At school" | "No GPS";
const STATUS_ORDER: Record<BusStatus, number> = { Overspeed: 0, "Running late": 1, "On route": 2, "At school": 3, "No GPS": 4 };

interface BusState {
  key: string; // vehicle id
  vehicle: Vehicle;
  route: TransportRoute;
  plate: string;
  driver: string;
  driverPhone: string;
  x: number | null;
  y: number | null;
  speed: number;
  status: BusStatus;
  simulated: boolean;
  /** Index of the next stop in route.stops (stops.length = school gate), null when unknown. */
  nextStopIdx: number | null;
  nextStopName: string;
  etaMin: number | null;
  /** Seconds since the last GPS position, null when none. */
  pingSec: number | null;
  progress: number;
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Polls the live feed while `on`; returns the latest positions by vehicle pk. */
function useLiveFeed(on: boolean) {
  const [positions, setPositions] = useState<Map<number, LivePosition>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const refresh = useCallback(async () => {
    try {
      const rows = await loadLive();
      setPositions(new Map(rows.map((r) => [r.vehiclePk, r])));
      setFetchedAt(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "GPS feed unavailable");
    }
  }, []);
  useEffect(() => {
    if (!on) return;
    void refresh();
    const id = setInterval(() => { void refresh(); }, POLL_MS);
    return () => clearInterval(id);
  }, [on, refresh]);
  return { positions, error, fetchedAt, refresh };
}

function statusBadge(b: BusState): { tone: Tone; text: string } {
  if (b.status === "Running late") return { tone: "red", text: "Running late" };
  if (b.status === "Overspeed") return { tone: "red", text: "Overspeed" };
  if (b.status === "At school") return { tone: "green", text: "At school" };
  if (b.status === "No GPS") return { tone: "grey", text: "No GPS" };
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
  const { routes, settings } = state;
  const owner = useOwnerName();
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [playing, setPlaying] = useState(true);
  const feed = useLiveFeed(playing);
  const [selected, setSelected] = useState<string>("");
  const [ctxRoute, setCtxRoute] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fZone, setFZone] = useState(ALL);
  const [fSpeed, setFSpeed] = useState(ALL);
  const [fGps, setFGps] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const limit = settings.thresholds.overspeed;
  const { lat: schoolLat, lng: schoolLng } = settings.geofence;
  const school = useMemo(
    () => (schoolLat !== null && schoolLng !== null ? { lat: schoolLat, lng: schoolLng } : null),
    [schoolLat, schoolLng],
  );
  const lateRoutes = useMemo(
    () => new Set(state.alerts.filter((a) => a.state !== "resolved" && a.type === "Late arrival").map((a) => a.routeCode)),
    [state.alerts],
  );

  const buses: BusState[] = useMemo(() => {
    const now = feed.fetchedAt?.getTime() ?? 0;
    return state.vehicles
      .filter((v) => !v.archived && v.routeCode)
      .flatMap((v) => {
        const route = routes.find((r) => r.code === v.routeCode);
        if (!route) return [];
        const live = feed.positions.get(v.pk);
        const hasFix = live?.lat !== null && live?.lat !== undefined && live.lng !== null;
        const point = hasFix ? { lat: live!.lat as number, lng: live!.lng as number } : null;
        const pingSec = live?.lastUpdate && now ? Math.max(0, Math.round((now - new Date(live.lastUpdate).getTime()) / 1000)) : null;
        const atSchool = !!(point && school && haversineKm(point, school) * 1000 <= settings.geofence.radius);
        const nextIdx = atSchool ? route.stops.length
          : live?.nextStop ? route.stops.findIndex((s) => s.name === live.nextStop) : -1;
        const nextStopIdx = nextIdx >= 0 ? nextIdx : null;
        const next = nextStopIdx !== null && nextStopIdx < route.stops.length ? route.stops[nextStopIdx] : null;
        const speed = live?.speed ?? 0;
        const etaMin = point && next && speed >= 5 ? Math.max(1, Math.round((haversineKm(point, next) / speed) * 60)) : null;
        const status: BusStatus = !point ? "No GPS" : atSchool ? "At school" : speed > limit ? "Overspeed"
          : lateRoutes.has(route.code) ? "Running late" : "On route";
        const driver = state.drivers.find((d) => d.id === v.driverId);
        return [{
          key: v.id, vehicle: v, route, plate: v.reg, driver: driver?.name ?? route.driverName ?? "", driverPhone: driver?.phone ?? "",
          x: point ? state.projection.x(point.lat, point.lng) : null, y: point ? state.projection.y(point.lat, point.lng) : null,
          speed, status, simulated: !!live?.simulated, nextStopIdx,
          nextStopName: atSchool ? "—" : next?.name ?? (live?.nextStop || "—"), etaMin, pingSec,
          progress: atSchool ? 1 : nextStopIdx !== null && route.stops.length ? nextStopIdx / route.stops.length : 0,
        }];
      });
  }, [state.vehicles, state.drivers, state.projection, routes, feed.positions, feed.fetchedAt, school, settings.geofence.radius, limit, lateRoutes]);

  useEffect(() => {
    if (!selected && buses.length) setSelected(buses[0].key);
  }, [buses, selected]);

  const zones = [...new Set(routes.map((r) => r.zone).filter(Boolean))].sort();
  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return buses.filter((b) => {
      if (ctxRoute !== ALL && b.route.code !== ctxRoute) return false;
      if (fStatus !== ALL && b.status !== fStatus) return false;
      if (fZone !== ALL && b.route.zone !== fZone) return false;
      if (fSpeed === "over" && !(b.speed > limit)) return false;
      if (fSpeed === "upto" && b.speed > limit) return false;
      if (fGps === "stale" && !(b.pingSec === null || b.pingSec > STALE_SEC)) return false;
      if (q && ![b.plate, b.route.code, b.route.name, b.driver, ...b.route.stops.map((s) => s.name)].join(" ").toLowerCase().includes(q)) return false;
      return true;
    }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.route.code.localeCompare(b.route.code, undefined, { numeric: true }));
  }, [buses, ctxRoute, fStatus, fZone, fSpeed, fGps, applied, limit]);

  const visibleKeys = new Set(visible.map((b) => b.key));
  const sel = buses.find((b) => b.key === selected) ?? null;
  const selRoute = sel?.route ?? null;

  const SPEED: Record<string, string> = { over: `Over ${limit} km/h`, upto: `${limit} km/h or less` };
  const chips: FilterChip[] = [
    ...(ctxRoute !== ALL ? [{ label: `Route: ${ctxRoute}`, tone: "purple" as const }] : []),
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus}`, tone: "purple" as const }] : []),
    ...(fZone !== ALL ? [{ label: `Zone: ${fZone}`, tone: "purple" as const }] : []),
    ...(fSpeed !== ALL ? [{ label: `Speed: ${SPEED[fSpeed]}`, tone: "purple" as const }] : []),
    ...(fGps !== ALL ? [{ label: "GPS: Stale or none", tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  const reporting = buses.filter((b) => b.status !== "No GPS");
  const moving = reporting.filter((b) => b.status !== "At school" && b.speed > 0);
  const avgSpeed = moving.length ? Math.round(moving.reduce((s, b) => s + b.speed, 0) / moving.length) : 0;
  const lateCount = buses.filter((b) => b.status === "Running late").length;
  const atSchool = buses.filter((b) => b.status === "At school").length;
  const simulatedCount = buses.filter((b) => b.simulated).length;

  const csv: CsvColumn<BusState>[] = [
    { header: "Bus", value: (b) => b.plate }, { header: "Route", value: (b) => `${b.route.code} · ${b.route.name}` }, { header: "Driver", value: (b) => b.driver },
    { header: "Status", value: (b) => b.status }, { header: "Speed (km/h)", value: (b) => b.speed }, { header: "Next stop", value: (b) => b.nextStopName },
    { header: "ETA (min)", value: (b) => b.etaMin ?? "" }, { header: "Last ping (s)", value: (b) => b.pingSec ?? "" },
    { header: "Source", value: (b) => (b.status === "No GPS" ? "" : b.simulated ? "Simulated" : "GPS") },
  ];

  useDeepLink(({ id }) => {
    if (!id) return;
    const b = buses.find((x) => x.route.code === id || x.plate === id || x.key === id);
    if (b) setSelected(b.key);
  });

  const resetFilters = () => { setCtxRoute(ALL); setFStatus(ALL); setFZone(ALL); setFSpeed(ALL); setFGps(ALL); setQuery(""); setApplied(""); };

  const raiseAlert = async () => {
    if (!sel) return;
    const type = sel.status === "Overspeed" ? "Overspeed" : sel.status === "Running late" ? "Late arrival" : "Route deviation";
    const severity = sel.status === "Overspeed" ? "Critical" : sel.status === "Running late" ? "Warning" : "Info";
    const ok = await dispatch({
      type: "alert/raise",
      input: {
        title: `${type} — ${sel.plate} on Route ${sel.route.code}`, type, severity, routeCode: sel.route.code, state: "open",
        detail: `Raised from Live Tracking by ${owner} · ${sel.speed} km/h · next ${sel.nextStopName}`,
      },
    });
    if (ok) toast(`Alert raised for ${sel.plate} — see Alerts tab`);
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
  const simPill = (b: BusState) => (b.simulated ? <Badge tone="amber">SIMULATED</Badge> : null);

  return (
    <TransportPage>
      <ContextBar icon={Navigation}
        note={`${fmtDate(toISO(TODAY))} · positions refresh every ${POLL_MS / 1000} s${feed.fetchedAt ? ` · updated ${clockOf(feed.fetchedAt.toISOString())}` : ""}${feed.error ? ` · ${feed.error}` : ""}`}
        selects={[
          { label: "Route", value: ctxRoute, onChange: (v) => { setCtxRoute(v); const b = buses.find((x) => x.route.code === v); if (b) setSelected(b.key); },
            options: [{ value: ALL, label: "All routes" }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))] },
        ]} />

      <PageHero eyebrow="Transport · Live" eyebrowAddon={livePill} title="Live" accent="tracking"
        sub="Every bus on a route, positioned from its GPS feed. Select a bus to follow it and see its stop-by-stop progress."
        actions={<>
          <HeroSecondary download={false} onClick={() => setPlaying((p) => !p)}>{playing ? "Pause feed" : "Resume feed"}</HeroSecondary>
          <HeroPrimary icon={false} onClick={() => { void feed.refresh(); }}>
            <Navigation size={15} strokeWidth={1.8} /> Refresh now
          </HeroPrimary>
        </>} />

      {simulatedCount > 0 && (
        <div role="note" style={{ margin: "0 0 12px", padding: "10px 14px", borderRadius: 12, background: T.warnSoft, color: T.warn, fontSize: 12.5, fontWeight: 600 }}>
          {plural(simulatedCount, "bus", "buses")} {simulatedCount === 1 ? "is" : "are"} showing SIMULATED positions from the development GPS simulator — not real locations.
        </div>
      )}

      <KpiGrid>
        <KpiCard loading={loading} label="Reporting GPS" value={`${reporting.length} / ${buses.length}`} sub={`${moving.length} moving now`} />
        <KpiCard loading={loading} label="Avg speed" value={moving.length ? `${avgSpeed} km/h` : "—"} sub={`Limit ${limit} km/h (Settings)`} color={T.pu} />
        <KpiCard loading={loading} label="Running late" value={lateCount} sub="Routes with an open late-arrival alert" color={T.red} />
        <KpiCard loading={loading} label="At school" value={atSchool} sub={school ? "Inside the school geofence" : "Set the school location in Settings"} color={T.green} />
      </KpiGrid>

      <SmartFilter chips={chips} onReset={resetFilters} fields={[
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus,
          options: [{ value: ALL, label: "All statuses" }, ...(["On route", "Running late", "Overspeed", "At school", "No GPS"] as BusStatus[]).map((s) => ({ value: s, label: s }))] },
        { key: "zone", label: "Zone", value: fZone, onChange: setFZone,
          options: [{ value: ALL, label: "All zones" }, ...zones.map((z) => ({ value: z, label: z }))] },
        { key: "speed", label: "Speed", value: fSpeed, onChange: setFSpeed,
          options: [{ value: ALL, label: "Any speed" }, { value: "over", label: SPEED.over }, { value: "upto", label: SPEED.upto }] },
        { key: "gps", label: "GPS", value: fGps, onChange: setFGps,
          options: [{ value: ALL, label: "Any ping" }, { value: "stale", label: `Stale (${STALE_SEC / 60} min+) or none` }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={() => setApplied(query.trim())} placeholder="Search by bus, route, driver or stop…"
        allSelected={false} onToggleAll={() => toast("Select buses from the list to act on them", "info")}
        onExport={() => { downloadCsv("live-positions.csv", csv, buses); toast("Current positions exported"); }} />

      <div className="tp-split tp-split--live">
        {/* Bus list */}
        <div className="tp-card" style={{ overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.rowBd}` }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Buses</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{visible.length} shown · sorted by status</div>
          </div>
          <div style={{ background: T.page, padding: 10, display: "flex", flexDirection: "column", gap: 8, maxHeight: 720, overflowY: "auto" }}>
            {buses.length === 0 && <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: T.muted }}>No vehicles are assigned to a route yet.</div>}
            {buses.length > 0 && visible.length === 0 && <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: T.muted }}>No buses match these filters.</div>}
            {visible.map((b) => {
              const on = b.key === selected;
              const badge = statusBadge(b);
              return (
                <button key={b.key} type="button" className="tp-bus-card tp-link-reset" onClick={() => setSelected(b.key)} aria-pressed={on}
                  style={{
                    background: "#fff", border: `1px solid ${on ? T.pu : T.cardBd}`, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8,
                    boxShadow: on ? "0 0 0 3px rgba(108,60,225,0.12)" : undefined, width: "100%",
                  }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                    <span className="tp-mono" style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{b.plate}</span>
                    <span style={{ display: "inline-flex", gap: 6 }}>{simPill(b)}<Badge tone={badge.tone}>{badge.text}</Badge></span>
                  </span>
                  <span style={{ fontSize: 12, color: T.muted }}>{b.route.code} · {b.route.name}{b.driver ? ` · ${b.driver}` : ""}</span>
                  <span style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.8fr", gap: 8 }}>
                    <Micro label="Speed" color={b.speed > limit ? T.red : undefined}>{b.status === "No GPS" ? "—" : `${b.speed} km/h`}</Micro>
                    <Micro label="Next stop">{b.nextStopName}</Micro>
                    <Micro label="ETA">{b.etaMin !== null ? `${b.etaMin} min` : "—"}</Micro>
                  </span>
                  <ProgressBar value={b.progress * 100} />
                  <span style={{ fontSize: 11, color: b.pingSec !== null && b.pingSec > STALE_SEC ? T.warn : T.ink3 }}>
                    {b.pingSec === null ? "No GPS position received yet" : `Last ping ${b.pingSec < 120 ? `${b.pingSec} s` : `${Math.round(b.pingSec / 60)} min`} ago`}
                  </span>
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
                  {sel ? <><span className="tp-mono">{sel.plate}</span> · <span style={{ fontWeight: 500, color: T.muted }}>{sel.route.code} · {sel.route.name}</span></> : "No bus selected"}
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                  {!sel ? "" : sel.status === "No GPS" ? "No GPS position received yet"
                    : sel.status === "At school" ? "Arrived at school"
                    : `${sel.driver ? `${sel.driver} · ` : ""}${sel.speed} km/h · next ${sel.nextStopName}${sel.etaMin !== null ? ` in ${sel.etaMin} min` : ""}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {sel?.driverPhone
                  ? <a className="tp-btn-outline" href={`tel:${sel.driverPhone.replace(/\s/g, "")}`}>Call driver</a>
                  : <OutlineButton disabled onClick={() => undefined}>Call driver</OutlineButton>}
                <OutlineButton disabled={!sel} onClick={() => { void raiseAlert(); }}>Raise alert</OutlineButton>
              </div>
            </div>

            <RouteMap routes={routes} highlight={null} showStops={false} ariaLabel="Live bus map (schematic, stops placed by their coordinates)"
              routeStyle={(r) => (r.code === selRoute?.code ? { width: 3, opacity: 1 } : { width: 1.4, opacity: visible.some((b) => b.route.code === r.code) ? 0.35 : 0.1 })}>
              {selRoute && sel && selRoute.stops.map((s, k) => {
                const passed = sel.nextStopIdx !== null && k < sel.nextStopIdx;
                return <circle key={s.id} cx={s.x} cy={s.y} r={4} fill={passed ? T.pu : "#fff"} stroke={T.pu} strokeWidth={1.5} />;
              })}
              {buses.filter((b) => b.x !== null && b.y !== null).map((b) => {
                const on = b.key === selected;
                const alarm = b.status === "Running late" || b.status === "Overspeed";
                return (
                  <g key={b.key} className="tp-bus" style={{ transform: `translate(${b.x}px, ${b.y}px)` }}
                    opacity={visibleKeys.has(b.key) ? 1 : 0.25} onClick={() => setSelected(b.key)}>
                    <title>{`${b.plate} · ${b.route.code} · ${b.status}${b.simulated ? " · SIMULATED" : ""}`}</title>
                    {on && <circle r={22} fill={T.pu} opacity={0.18} />}
                    <rect x={-17} y={-11} width={34} height={22} rx={7} fill={on ? T.pu : "#fff"} stroke={alarm ? T.danger : b.simulated ? T.amber : T.pu}
                      strokeWidth={2} strokeDasharray={b.simulated ? "4 2" : undefined} />
                    <text y={3.5} textAnchor="middle" fontSize={10} fontWeight={800} fill={on ? "#fff" : T.ink} style={{ fontFamily: "Inter, sans-serif", pointerEvents: "none" }}>{b.route.code.slice(0, 4)}</text>
                  </g>
                );
              })}
            </RouteMap>

            <div style={{ display: "flex", flexWrap: "wrap", gap: 14, fontSize: 11.5, color: T.muted, marginTop: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 10, borderRadius: 4, background: T.pu }} /> Selected bus</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 10, borderRadius: 4, background: "#fff", border: `2px solid ${T.pu}` }} /> Other buses</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 10, borderRadius: 4, background: "#fff", border: `2px solid ${T.danger}` }} /> Late / overspeed</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 10, borderRadius: 4, background: "#fff", border: `2px dashed ${T.amber}` }} /> Simulated position</span>
            </div>
          </div>

          {selRoute && sel && (
            <div className="tp-card" style={{ padding: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink, marginBottom: 12 }}>Stop timeline · {selRoute.code} · {selRoute.name}</div>
              {[...selRoute.stops.map((s, k) => ({ key: s.id, name: s.name, sub: plural(s.students, "student"), time: s.pickupTime, k })),
                { key: "school", name: "School gate", sub: "Destination", time: settings.shifts.schoolArrival, k: selRoute.stops.length }]
                .map((row, idx, arr) => {
                  const known = sel.nextStopIdx !== null;
                  const passed = known && row.k < (sel.nextStopIdx as number);
                  const current = sel.nextStopIdx === row.k && sel.status !== "At school";
                  const arrived = sel.status === "At school" && row.k === selRoute.stops.length;
                  const last = idx === arr.length - 1;
                  const status = arrived ? "Arrived" : passed ? "Departed" : current ? `Next${sel.etaMin !== null ? ` · ${sel.etaMin} min` : ""}` : known ? "Upcoming" : "—";
                  const statusColor = passed || arrived ? T.ok : current ? T.pu : T.ink3;
                  return (
                    <div key={row.key} style={{ display: "flex", gap: 12 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14, flexShrink: 0 }}>
                        <span style={{
                          width: 14, height: 14, borderRadius: 999, marginTop: 2, flexShrink: 0,
                          background: passed || arrived ? T.dotOk : current ? T.pu : "#fff",
                          boxShadow: passed || current || arrived ? undefined : `inset 0 0 0 2px ${T.ink4}`,
                        }} />
                        {!last && <span style={{ width: 2, flex: 1, minHeight: 18, background: passed ? T.dotOk : T.cardBd }} />}
                      </div>
                      <div style={{ flex: 1, display: "flex", justifyContent: "space-between", gap: 10, paddingBottom: last ? 0 : 12, minWidth: 0 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: current ? 800 : 600, color: passed ? T.ink2 : T.ink }}>{row.name}</div>
                          <div style={{ fontSize: 11.5, color: T.muted }}>{row.sub}</div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div className="tp-mono" style={{ fontSize: 12, color: T.ink }}>{fmtTime(row.time)}</div>
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

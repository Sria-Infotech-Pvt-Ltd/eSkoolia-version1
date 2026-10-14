"use client";
/**
 * Routes — /transport/routes (Master Prompt §7.5). One accordion per route,
 * rows are its stops in pickup order. Stops are the same records as Pickup Points.
 */
import { useCallback, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Eye, Pencil, X } from "lucide-react";
import { useTransport, useVehicles } from "@/lib/transport/store";
import { defaultStopFare } from "@/lib/transport/fares";
import { addMinutes, fmtTime, inr, num, pad, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { RouteStop, TransportRoute } from "@/lib/transport/types";
import {
  Badge, BulkBar, Button, Chip, ConfirmDialog, Drawer, DrawerActions, DrawerHeader, DrawerHighlight, DrawerSection,
  EmptyLine, GroupCard, GroupedList, HeroPrimary, HeroSecondary, InfoRow, KpiCard, KpiGrid, ListFooter, OutlineButton,
  PageHero, RowIconButton, SearchRow, SmartFilter, T, TransportPage, useDeepLink, useGroupOpen, useMountSkeleton,
  useSelection, useTpToast, type FilterChip,
} from "@/components/transport/ui";
import { AddRouteWizard, EditRouteModal, MoveStopsModal, StopFormModal, type StopFormValues } from "./RouteModals";

const ALL = "all";
const studentsOf = (r: TransportRoute) => r.stops.reduce((s, x) => s + x.students, 0);
const utilPct = (r: TransportRoute) => (studentsOf(r) / r.capacity) * 100;

type StopForm = { mode: "add"; routeCode: string } | { mode: "edit"; routeCode: string; stopId: string };
type ConfirmState = { kind: "removeStop"; stopId: string } | { kind: "archiveRoute"; code: string } | { kind: "bulkRemove" };

export function RoutesPage() {
  const { state, dispatch } = useTransport();
  const vehicles = useVehicles();
  const { routes } = state;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [fZone, setFZone] = useState(ALL);
  const [fUtil, setFUtil] = useState(ALL);
  const [fVehicle, setFVehicle] = useState(ALL);
  const [fLength, setFLength] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const groups = useGroupOpen("R3");
  const selection = useSelection();
  const [drawerCode, setDrawerCode] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [stopForm, setStopForm] = useState<StopForm | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const findStop = useCallback((id: string) => {
    for (const r of routes) { const s = r.stops.find((x) => x.id === id); if (s) return { route: r, stop: s }; }
    return null;
  }, [routes]);

  // Route-level filters, then stop-level search.
  const shown = useMemo(() => {
    const q = applied.toLowerCase();
    return routes
      .filter((r) => {
        if (fZone !== ALL && r.zone !== fZone) return false;
        const u = utilPct(r);
        if (fUtil === "over90" && !(u > 90)) return false;
        if (fUtil === "70to90" && !(u >= 70 && u <= 90)) return false;
        if (fUtil === "under70" && !(u < 70)) return false;
        if (fVehicle !== ALL && r.busReg !== fVehicle) return false;
        if (fLength === "8plus" && r.stops.length < 8) return false;
        if (fLength === "under8" && r.stops.length >= 8) return false;
        return true;
      })
      .map((r) => {
        if (!q) return { route: r, stops: r.stops };
        const routeHit = [r.code, r.name, r.busReg].join(" ").toLowerCase().includes(q);
        return { route: r, stops: routeHit ? r.stops : r.stops.filter((s) => `${s.name} ${s.landmark}`.toLowerCase().includes(q)) };
      })
      .filter((g) => !q || g.stops.length > 0);
  }, [routes, fZone, fUtil, fVehicle, fLength, applied]);

  const visibleStops = shown.flatMap((g) => g.stops);
  const visibleIds = visibleStops.map((s) => s.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));
  const filtersActive = fZone !== ALL || fUtil !== ALL || fVehicle !== ALL || fLength !== ALL || applied !== "";

  const UTIL_LABEL: Record<string, string> = { over90: "Over 90%", "70to90": "70–90%", under70: "Under 70%" };
  const LEN_LABEL: Record<string, string> = { "8plus": "8+ stops", under8: "Under 8 stops" };
  const chips: FilterChip[] = [
    ...(fZone !== ALL ? [{ label: `Zone: ${fZone}`, tone: "purple" as const }] : []),
    ...(fUtil !== ALL ? [{ label: `Utilisation: ${UTIL_LABEL[fUtil]}`, tone: "purple" as const }] : []),
    ...(fVehicle !== ALL ? [{ label: `Vehicle: ${fVehicle}`, tone: "purple" as const }] : []),
    ...(fLength !== ALL ? [{ label: `Length: ${LEN_LABEL[fLength]}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  // KPIs
  const totalStops = routes.reduce((s, r) => s + r.stops.length, 0);
  const timed = routes.filter((r) => r.routeTimeMin > 0);
  const avgTime = timed.length ? Math.round(timed.reduce((s, r) => s + r.routeTimeMin, 0) / timed.length) : 0;
  const zones = [...new Set(routes.map((r) => r.zone).filter(Boolean))].sort();
  const totalStudents = routes.reduce((s, r) => s + studentsOf(r), 0);

  // CSV
  type StopRow = { route: TransportRoute; stop: RouteStop };
  const csv: CsvColumn<StopRow>[] = [
    { header: "Route", value: (x) => `${x.route.code} · ${x.route.name}` }, { header: "Vehicle", value: (x) => x.route.busReg },
    { header: "Seq", value: (x) => x.stop.seq }, { header: "Stop ID", value: (x) => x.stop.id }, { header: "Stop", value: (x) => x.stop.name },
    { header: "Landmark", value: (x) => x.stop.landmark }, { header: "Pickup time", value: (x) => fmtTime(x.stop.pickupTime) },
    { header: "Drop time", value: (x) => fmtTime(x.stop.dropTime) }, { header: "Students", value: (x) => x.stop.students },
    { header: "Monthly fare", value: (x) => x.stop.fare },
  ];
  const rowsFor = (ids?: Set<string>) => shown.flatMap((g) => g.stops.filter((s) => !ids || ids.has(s.id)).map((stop) => ({ route: g.route, stop })));
  const exportAll = () => {
    downloadCsv("transport-routes.csv", csv, rowsFor());
    toast(`Exported ${plural(shown.length, "route")} and ${plural(visibleStops.length, "stop")}`);
  };

  useDeepLink(({ id, isNew }) => {
    if (id && routes.some((r) => r.code === id)) { setDrawerCode(id); groups.openOnly(id); }
    if (isNew) setWizardOpen(true);
  });

  const runSearch = () => {
    const q = query.trim();
    setApplied(q);
    if (!q) return;
    const ql = q.toLowerCase();
    const hits = routes.filter((r) => [r.code, r.name, r.busReg, ...r.stops.map((s) => `${s.name} ${s.landmark}`)].join(" ").toLowerCase().includes(ql)).map((r) => r.code);
    groups.expandAll(hits);
  };
  const resetFilters = () => { setFZone(ALL); setFUtil(ALL); setFVehicle(ALL); setFLength(ALL); setQuery(""); setApplied(""); };

  const move = async (r: TransportRoute, s: RouteStop, dir: -1 | 1) => {
    const i = r.stops.findIndex((x) => x.id === s.id);
    if (i + dir < 0 || i + dir >= r.stops.length) return;
    if (await dispatch({ type: "stop/reorder", routeCode: r.code, id: s.id, dir })) toast("Stop order updated");
  };

  const submitStop = async (v: StopFormValues) => {
    if (!stopForm) return;
    const input = {
      name: v.name, landmark: v.landmark.trim(), fare: Math.max(0, Number(v.fare) || 0),
      lat: Number(v.lat), lng: Number(v.lng), pickupTime: v.pickupTime, dropTime: v.dropTime,
    };
    const ok = stopForm.mode === "add"
      ? await dispatch({ type: "stop/add", routeCode: stopForm.routeCode, input })
      : await dispatch({ type: "stop/update", id: stopForm.stopId, patch: input });
    if (!ok) { toast("Not saved — see the message above", "error"); return; }
    toast(stopForm.mode === "add" ? `${v.name} added to ${stopForm.routeCode}` : `${v.name} updated`);
    groups.openOnly(stopForm.routeCode);
    setStopForm(null);
  };

  const runConfirm = () => {
    if (!confirm) return;
    const cf = confirm;
    setConfirm(null);
    setDrawerCode(null);
    if (cf.kind === "removeStop") {
      const hit = findStop(cf.stopId);
      dispatch({ type: "stop/remove", ids: [cf.stopId] });
      selection.clear();
      if (hit) toast(`${hit.stop.name} removed from ${hit.route.code}`);
    } else if (cf.kind === "archiveRoute") {
      dispatch({ type: "route/archive", code: cf.code });
      selection.clear();
      toast(`${cf.code} archived`);
    } else {
      const n = selection.count;
      dispatch({ type: "stop/remove", ids: selection.ids });
      selection.clear();
      toast(`${plural(n, "stop")} removed`);
    }
  };

  const confirmText = (() => {
    if (!confirm) return null;
    if (confirm.kind === "bulkRemove") return { title: `Remove ${plural(selection.count, "stop")}?`, message: "Students at these stops move to Pending allocation.", label: "Remove stops" };
    if (confirm.kind === "removeStop") {
      const hit = findStop(confirm.stopId);
      if (!hit) return null;
      return {
        title: `Remove ${hit.stop.name} from ${hit.route.code}?`,
        message: `${plural(hit.stop.students, "student")} board here. They will move to Pending in Student Allocation until reassigned.`,
        label: "Remove stop",
      };
    }
    const r = routes.find((x) => x.code === confirm.code);
    if (!r) return null;
    return { title: `Archive route ${r.code}?`, message: `All ${studentsOf(r)} students on this route move to Pending allocation. This cannot be undone from here.`, label: "Archive route" };
  })();

  const drawerRoute = routes.find((r) => r.code === drawerCode) ?? null;
  const editRoute = routes.find((r) => r.code === editCode) ?? null;
  const formRoute = stopForm ? routes.find((r) => r.code === stopForm.routeCode) ?? null : null;
  const formStop = stopForm?.mode === "edit" ? findStop(stopForm.stopId)?.stop ?? null : null;
  const activeDrivers = state.drivers.filter((d) => !d.archived && d.status !== "Inactive");
  const activeAttendants = state.attendants.filter((a) => !a.archived && a.status !== "Inactive");

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Routes" title="Route" accent="planner"
        sub="Nine routes, seventy stops. Set the stop order, pickup and drop times and the monthly fare for each stop, then assign a vehicle and crew."
        actions={<>
          <HeroSecondary onClick={exportAll}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setWizardOpen(true)}>Add Route</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Routes" value={routes.length} sub="Active routes" />
        <KpiCard loading={loading} label="Stops" value={totalStops} sub={`Avg ${routes.length ? (totalStops / routes.length).toFixed(1) : "0"} per route`} color={T.pu} />
        <KpiCard loading={loading} label="Avg route time" value={avgTime ? `${avgTime} min` : "—"} sub="First pickup to school arrival (Settings)" />
        <KpiCard loading={loading} label="Students on routes" value={num(totalStudents)} sub="Allocated students" color={T.green} />
      </KpiGrid>

      <SmartFilter chips={chips} groupingChip="Grouped by route" onReset={resetFilters} fields={[
        { key: "zone", label: "Zone", value: fZone, onChange: setFZone,
          options: [{ value: ALL, label: "All zones" }, ...zones.map((z) => ({ value: z, label: z }))] },
        { key: "util", label: "Seat utilisation", value: fUtil, onChange: setFUtil,
          options: [{ value: ALL, label: "Any" }, { value: "over90", label: "Over 90%" }, { value: "70to90", label: "70–90%" }, { value: "under70", label: "Under 70%" }] },
        { key: "vehicle", label: "Vehicle", value: fVehicle, onChange: setFVehicle,
          options: [{ value: ALL, label: "Any vehicle" }, ...[...new Set(routes.map((r) => r.busReg))].map((p) => ({ value: p, label: p }))] },
        { key: "length", label: "Route length", value: fLength, onChange: setFLength,
          options: [{ value: ALL, label: "Any length" }, { value: "8plus", label: "8+ stops" }, { value: "under8", label: "Under 8 stops" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={runSearch} placeholder="Search by route, stop name or vehicle…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportAll} />

      <GroupedList title="All routes" helper="One accordion per route · rows are stops in pickup order · donut shows seat utilisation"
        onCollapseAll={groups.collapseAll} onExpandAll={() => groups.expandAll(routes.map((r) => r.code))}
        footer={visibleStops.length > 0 && (
          <ListFooter summary={`Showing ${plural(visibleStops.length, "stop")} across ${plural(shown.length, "route")}`}
            counts={`· ${num(visibleStops.reduce((s, x) => s + x.students, 0))} students`}
            onCollapseAll={groups.collapseAll}
            onExportView={() => { downloadCsv("transport-routes-view.csv", csv, rowsFor()); toast("Current view exported"); }} />
        )}>
        {shown.length === 0 ? (
          <EmptyLine>{filtersActive ? "No routes match these filters. Try clearing the search or resetting filters." : "No routes yet."}</EmptyLine>
        ) : shown.map(({ route: r, stops }) => (
          <GroupCard key={r.code} name={`${r.code} · ${r.name}`} open={groups.isOpen(r.code)} onToggle={() => groups.toggle(r.code)}
            pct={Math.min(100, utilPct(r))}
            chips={<>
              <Chip tone="slate">{plural(r.stops.length, "stop")}</Chip>
              {r.routeTimeMin > 0 && <Chip tone="green">{r.routeTimeMin} min</Chip>}
              <Chip tone="purple">{r.busReg || "No vehicle"}</Chip>
              <Chip tone="blue">{studentsOf(r)} / {r.capacity} seats</Chip>
            </>}
            extra={<>
              <RowIconButton label={`Edit route ${r.code}`} onClick={() => setEditCode(r.code)}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
              <RowIconButton label={`View route ${r.code}`} onClick={() => setDrawerCode(r.code)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
              <OutlineButton onClick={() => setStopForm({ mode: "add", routeCode: r.code })}>+ Add stop</OutlineButton>
            </>}>
            {stops.length === 0 ? <EmptyLine>No stops on this route yet.</EmptyLine> : (
              <div className="tp-scroll-x">
                <table className="tp-table" style={{ minWidth: 1100 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                      <th>Seq</th><th>Stop</th><th>Pickup time</th><th>Drop time</th><th>Students</th><th>Monthly fare</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stops.map((s) => {
                      const sel = selection.isSelected(s.id);
                      const idx = r.stops.findIndex((x) => x.id === s.id);
                      return (
                        <tr key={s.id} className={sel ? "is-selected" : undefined}>
                          <td style={{ width: 42 }}><input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(s.id)} aria-label={`Select ${s.name}`} /></td>
                          <td>
                            <span style={{ width: 26, height: 26, borderRadius: 999, background: T.pu, color: "#fff", display: "inline-grid", placeItems: "center", fontSize: 11, fontWeight: 800 }}>{s.seq}</span>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700, color: T.ink }}>{s.name}</div>
                            <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{s.landmark}</div>
                          </td>
                          <td className="tp-mono" style={{ fontSize: 12.5 }}>{fmtTime(s.pickupTime)}</td>
                          <td className="tp-mono" style={{ fontSize: 12.5 }}>{fmtTime(s.dropTime)}</td>
                          <td>{s.students}</td>
                          <td style={{ fontWeight: 700 }}>{inr(s.fare)}</td>
                          <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                            <RowIconButton label="Move up" disabled={idx === 0} onClick={() => move(r, s, -1)}><ChevronUp size={15} strokeWidth={2} /></RowIconButton>
                            <RowIconButton label="Move down" disabled={idx === r.stops.length - 1} onClick={() => move(r, s, 1)}><ChevronDown size={15} strokeWidth={2} /></RowIconButton>
                            <RowIconButton label="Edit stop" onClick={() => setStopForm({ mode: "edit", routeCode: r.code, stopId: s.id })}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
                            <RowIconButton label="Remove stop" onClick={() => setConfirm({ kind: "removeStop", stopId: s.id })}><X size={15} strokeWidth={2} /></RowIconButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </GroupCard>
        ))}
      </GroupedList>

      <BulkBar count={selection.count} onClear={selection.clear} actions={[
        { label: "Move to route", onClick: () => setMoveOpen(true) },
        { label: "Export", onClick: () => {
          const ids = new Set(selection.ids);
          const list = routes.flatMap((route) => route.stops.filter((s) => ids.has(s.id)).map((stop) => ({ route, stop })));
          downloadCsv("transport-stops.csv", csv, list); toast(`Exported ${plural(list.length, "stop")}`); selection.clear();
        } },
        { label: "Archive", onClick: () => setConfirm({ kind: "bulkRemove" }) },
      ]} />

      {drawerRoute && (() => {
        const r = drawerRoute;
        const fares = r.stops.map((s) => s.fare);
        const fareRange = fares.length ? `${inr(Math.min(...fares))}–${num(Math.max(...fares))}` : "—";
        return (
          <Drawer open onClose={() => setDrawerCode(null)} label={`Route ${r.code}`}>
            <DrawerHeader avatar={r.code} title={`${r.code} · ${r.name}`} sub={`${r.zone ? `${r.zone} zone · ` : ""}${r.shift}`} idLabel={`RT-${pad(r.pk, 3)}`}
              badges={<><Badge tone="green">Published</Badge><Badge tone="purple">{plural(r.stops.length, "stop")}</Badge></>} />
            <DrawerHighlight items={[{ label: "Seats occupied", value: `${studentsOf(r)} / ${r.capacity}` }, { label: "Fare range", value: fareRange }]} />
            <DrawerSection title="Crew & vehicle">
              <InfoRow label="Vehicle"><span className="tp-mono">{r.busReg || "—"}</span></InfoRow>
              <InfoRow label="Driver">{r.driverName || "—"}</InfoRow>
              <InfoRow label="Attendant">{r.attendantName || "—"}</InfoRow>
            </DrawerSection>
            <DrawerSection title="Timing">
              <InfoRow label="First pickup">{fmtTime(r.firstPickup)}</InfoRow>
              <InfoRow label="School arrival">{fmtTime(state.settings.shifts.schoolArrival)}</InfoRow>
              <InfoRow label="Afternoon drop starts">{fmtTime(state.settings.shifts.afternoonDrop)}</InfoRow>
              <InfoRow label="Distance along stops">{r.distanceKm ? `${r.distanceKm} km` : "—"}</InfoRow>
            </DrawerSection>
            <DrawerSection title="Stops">
              {r.stops.slice(0, 6).map((s) => (
                <div key={s.id} style={{ fontSize: 12, padding: "4px 0", borderBottom: `1px dashed ${T.dashed}`, color: T.ink }}>
                  {s.seq}. {s.name} <span style={{ color: T.muted }}>— {plural(s.students, "student")}</span>
                </div>
              ))}
              {r.stops.length === 0 && <div style={{ fontSize: 12, color: T.muted }}>No stops yet.</div>}
            </DrawerSection>
            <DrawerActions>
              <Button type="button" variant="soft" size="sm" onClick={() => setEditCode(r.code)}>Edit route</Button>
              <Button type="button" variant="red" size="sm" onClick={() => setConfirm({ kind: "archiveRoute", code: r.code })}>Archive route</Button>
            </DrawerActions>
          </Drawer>
        );
      })()}

      {editRoute && (
        <EditRouteModal key={editRoute.code} route={editRoute} plates={vehicles.map((v) => v.reg)} drivers={activeDrivers} attendants={activeAttendants}
          onClose={() => setEditCode(null)}
          onSubmit={async (patch) => {
            const code = editRoute.code;
            const clashBus = routes.find((x) => x.code !== code && patch.busReg && x.busReg === patch.busReg);
            const clashDriver = routes.find((x) => x.code !== code && patch.driverName && x.driverName === patch.driverName);
            if (!(await dispatch({ type: "route/update", code, patch: { ...patch, driverName: patch.driverName || editRoute.driverName, attendantName: patch.attendantName || editRoute.attendantName } }))) {
              toast("Not saved — see the message above", "error"); return;
            }
            const note = clashBus ? ` · note: ${clashBus.code} shares this vehicle` : clashDriver ? ` · note: ${clashDriver.code} shares this driver` : "";
            toast(`${code} updated${note}`);
            setEditCode(null);
          }} />
      )}

      {stopForm && formRoute && (
        <StopFormModal key={stopForm.mode === "edit" ? stopForm.stopId : `add-${stopForm.routeCode}`} mode={stopForm.mode}
          routeLabel={`${formRoute.code} · ${formRoute.name}`}
          initial={formStop
            ? { name: formStop.name, landmark: formStop.landmark, fare: String(formStop.fare), lat: String(formStop.lat), lng: String(formStop.lng), pickupTime: formStop.pickupTime, dropTime: formStop.dropTime }
            : { name: "", landmark: "", fare: String(defaultStopFare(state.settings.fareSlabs)), lat: "", lng: "", pickupTime: "", dropTime: "" }}
          onClose={() => setStopForm(null)} onSubmit={(v) => { void submitStop(v); }} />
      )}

      {moveOpen && (
        <MoveStopsModal title="Move stops" subtitle="Move the selected stops to another route" fieldLabel="Destination route" cta="Move stops"
          routes={routes} onClose={() => setMoveOpen(false)}
          onSubmit={(code) => {
            const n = selection.count;
            dispatch({ type: "stop/move", ids: selection.ids, routeCode: code });
            selection.clear(); setMoveOpen(false); groups.openOnly(code);
            toast(`${plural(n, "stop")} moved to ${code}`);
          }} />
      )}

      {wizardOpen && (
        <AddRouteWizard existingCodes={[...routes, ...state.archivedRoutes].map((r) => r.code)}
          plates={vehicles.map((v) => v.reg)} freePlates={vehicles.filter((v) => !v.routeCode).map((v) => v.reg)}
          drivers={state.drivers} attendants={state.attendants} onClose={() => setWizardOpen(false)}
          onCreate={async (input) => {
            if (!(await dispatch({ type: "route/add", input }))) { toast("Not saved — see the message above", "error"); return; }
            groups.openOnly(input.code);
            setWizardOpen(false);
            toast(`Route ${input.code} created with ${plural(input.stops.length, "stop")}`);
          }} />
      )}

      <ConfirmDialog open={!!confirmText} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="danger"
        title={confirmText?.title ?? ""} message={confirmText?.message ?? ""} confirmLabel={confirmText?.label ?? ""} />
    </TransportPage>
  );
}

"use client";
/**
 * Pickup Points — /transport/pickup-points (Master Prompt §7.6). Split view:
 * table ↔ SVG map stay in sync. Points are the same records as route stops.
 */
import { useCallback, useMemo, useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import { useTransport } from "@/lib/transport/store";
import { defaultStopFare } from "@/lib/transport/fares";
import { fmtTime, inr, num, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { RouteStop, TransportRoute } from "@/lib/transport/types";
import {
  Badge, BulkBar, Button, SaveButton, Chip, ConfirmDialog, Drawer, DrawerActions, DrawerHeader, DrawerHighlight, DrawerSection, Field,
  HeroPrimary, HeroSecondary, InfoRow, Input, KpiCard, KpiGrid, MapLegend, Modal, OutlineButton, PageHero, RouteMap,
  RowIconButton, SearchRow, Select, SmartFilter, T, TransportPage, useDeepLink, useMountSkeleton, useSelection, useTpToast,
  type FilterChip,
} from "@/components/transport/ui";
import { MoveStopsModal, coord } from "../routes/RouteModals";

const ALL = "all";

interface Point { stop: RouteStop; route: TransportRoute }
type ConfirmState = { kind: "delete"; id: string } | { kind: "bulkDelete" };

interface FormValues { name: string; landmark: string; routeCode: string; lat: string; lng: string; fare: string; pickupTime: string; dropTime: string }

export function PickupPointsPage() {
  const { state, dispatch, errorText } = useTransport();
  const { routes } = state;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [fRoute, setFRoute] = useState(ALL);
  const [fZone, setFZone] = useState(ALL);
  const [fStrength, setFStrength] = useState(ALL);
  const [fFare, setFFare] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [highlight, setHighlight] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  const selection = useSelection();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const points: Point[] = useMemo(() => routes.flatMap((route) => route.stops.map((stop) => ({ stop, route }))), [routes]);
  const byId = useCallback((id: string | null) => points.find((p) => p.stop.id === id) ?? null, [points]);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return points.filter(({ stop: s, route: r }) => {
      if (fRoute !== ALL && r.code !== fRoute) return false;
      if (fZone !== ALL && r.zone !== fZone) return false;
      if (fStrength === "6plus" && s.students < 6) return false;
      if (fStrength === "under6" && s.students >= 6) return false;
      if (fFare === "upto1800" && s.fare > 1800) return false;
      if (fFare === "above1800" && s.fare <= 1800) return false;
      if (q && ![s.name, s.landmark, r.code, r.name, s.pickupId].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [points, fRoute, fZone, fStrength, fFare, applied]);

  const visibleIds = visible.map((p) => p.stop.id);
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));

  const STR: Record<string, string> = { "6plus": "6+ students", under6: "Under 6 students" };
  const FARE: Record<string, string> = { upto1800: "Up to ₹1,800", above1800: "Above ₹1,800" };
  const chips: FilterChip[] = [
    ...(fRoute !== ALL ? [{ label: `Route: ${fRoute}`, tone: "purple" as const }] : []),
    ...(fZone !== ALL ? [{ label: `Zone: ${fZone}`, tone: "purple" as const }] : []),
    ...(fStrength !== ALL ? [{ label: `Strength: ${STR[fStrength]}`, tone: "purple" as const }] : []),
    ...(fFare !== ALL ? [{ label: `Fare: ${FARE[fFare]}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  // KPIs
  const students = points.reduce((s, p) => s + p.stop.students, 0);
  const avgFare = points.length ? points.reduce((s, p) => s + p.stop.fare, 0) / points.length : 0;
  const lowStrength = points.filter((p) => p.stop.students < 4).length;

  const csv: CsvColumn<Point>[] = [
    { header: "Pickup point ID", value: (p) => p.stop.pickupId }, { header: "Stop", value: (p) => p.stop.name },
    { header: "Landmark", value: (p) => p.stop.landmark }, { header: "Route", value: (p) => `${p.route.code} · ${p.route.name}` },
    { header: "Seq", value: (p) => p.stop.seq }, { header: "Latitude", value: (p) => p.stop.lat.toFixed(4) },
    { header: "Longitude", value: (p) => p.stop.lng.toFixed(4) }, { header: "Students", value: (p) => p.stop.students },
    { header: "Monthly fare", value: (p) => p.stop.fare },
  ];
  const exportVisible = () => {
    downloadCsv("transport-pickup-points.csv", csv, visible);
    toast(`Exported ${plural(visible.length, "pickup point")} with coordinates`);
  };

  const focus = useCallback((id: string, scroll: boolean) => {
    setFocusId(id);
    if (scroll) requestAnimationFrame(() => document.getElementById(`pp-row-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }, []);

  useDeepLink(({ id, isNew }) => {
    if (id) {
      const p = points.find((x) => x.stop.pickupId === id || x.stop.id === id);
      if (p) { focus(p.stop.id, true); setDrawerId(p.stop.id); }
    }
    if (isNew) setForm({ mode: "add" });
  });

  const runSearch = () => setApplied(query.trim());
  const resetFilters = () => { setFRoute(ALL); setFZone(ALL); setFStrength(ALL); setFFare(ALL); setQuery(""); setApplied(""); };

  const submitForm = async (v: FormValues) => {
    if (!form) return;
    const input = {
      name: v.name, landmark: v.landmark.trim(), fare: Math.max(0, Number(v.fare) || 0),
      lat: Number(v.lat), lng: Number(v.lng), pickupTime: v.pickupTime, dropTime: v.dropTime,
    };
    if (form.mode === "add") {
      if (!(await dispatch({ type: "stop/add", routeCode: v.routeCode, input }))) { toast(`Not saved: ${errorText()}`, "error"); return; }
      toast(`${v.name} added to ${v.routeCode}`);
    } else {
      const prev = byId(form.id);
      if (!(await dispatch({ type: "stop/update", id: form.id, patch: { ...input, routeCode: v.routeCode } }))) { toast(`Not saved: ${errorText()}`, "error"); return; }
      if (prev) focus(prev.stop.id, true);
      toast(`${v.name} updated`);
    }
    setForm(null);
  };

  // The dialog stays open (showing progress) until the save finishes; a failure keeps it open to retry.
  const runConfirm = async () => {
    if (!confirm) return;
    const cf = confirm;
    const p = cf.kind === "delete" ? byId(cf.id) : null;
    const n = selection.count;
    const focusRemoved = cf.kind === "delete" ? focusId === cf.id : !!focusId && selection.isSelected(focusId);
    const ok = await dispatch({ type: "stop/remove", ids: cf.kind === "delete" ? [cf.id] : selection.ids });
    if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
    setConfirm(null);
    setDrawerId(null);
    if (focusRemoved) setFocusId(null);
    selection.clear();
    toast(cf.kind === "delete" ? `${p?.stop.name ?? "Pickup point"} deleted` : `${plural(n, "pickup point")} deleted`);
  };

  const confirmText = (() => {
    if (!confirm) return null;
    if (confirm.kind === "bulkDelete") {
      return { title: `Delete ${plural(selection.count, "pickup point")}?`, message: "Students at these points move to Pending allocation.", label: "Delete all" };
    }
    const p = byId(confirm.id);
    if (!p) return null;
    return { title: `Delete ${p.stop.name}?`, message: `${plural(p.stop.students, "student")} board here. They will move to Pending in Student Allocation.`, label: "Delete point" };
  })();

  const drawer = byId(drawerId);
  const highlighted = routes.find((r) => r.code === highlight) ?? null;
  const visibleOnMap = visible.filter((p) => !highlight || p.route.code === highlight).length;
  const formPoint = form?.mode === "edit" ? byId(form.id) : null;

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Stops" title="Pickup" accent="points"
        sub="Every boarding point with its coordinates, the students who board there and the monthly fare. Select a row to see it on the map."
        actions={<>
          <HeroSecondary onClick={exportVisible}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setForm({ mode: "add" })}>Add Pickup Point</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Pickup points" value={points.length} sub={`Across ${plural(routes.length, "route")}`} />
        <KpiCard loading={loading} label="Students served" value={num(students)} sub="Boarding at a mapped point" color={T.green} />
        <KpiCard loading={loading} label="Avg monthly fare" value={inr(avgFare)} sub="Distance-slab pricing" color={T.pu} />
        <KpiCard loading={loading} label="Low-strength stops" value={lowStrength} sub="Fewer than 4 students — review" color={T.amber} />
      </KpiGrid>

      <SmartFilter chips={chips} onReset={resetFilters} fields={[
        { key: "route", label: "Route", value: fRoute, onChange: setFRoute,
          options: [{ value: ALL, label: "All routes" }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))] },
        { key: "zone", label: "Zone", value: fZone, onChange: setFZone,
          options: [{ value: ALL, label: "All zones" }, ...[...new Set(routes.map((r) => r.zone).filter(Boolean))].sort().map((z) => ({ value: z, label: z }))] },
        { key: "strength", label: "Strength", value: fStrength, onChange: setFStrength,
          options: [{ value: ALL, label: "Any strength" }, { value: "6plus", label: "6+ students" }, { value: "under6", label: "Under 6 students" }] },
        { key: "fare", label: "Monthly fare", value: fFare, onChange: setFFare,
          options: [{ value: ALL, label: "Any fare" }, { value: "upto1800", label: "Up to ₹1,800" }, { value: "above1800", label: "Above ₹1,800" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={runSearch} placeholder="Search by stop, landmark or route…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportVisible} />

      <div className="tp-split">
        {/* Table */}
        <div className="tp-card" style={{ overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${T.rowBd}` }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>All pickup points</div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{visible.length} of {points.length} points · click a row to locate it on the map</div>
            </div>
            <OutlineButton onClick={() => { downloadCsv("transport-pickup-points-view.csv", csv, visible); toast("Current view exported"); }}>Export view</OutlineButton>
          </div>
          {visible.length === 0 ? (
            <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: T.muted }}>No pickup points match these filters.</div>
          ) : (
            <div style={{ maxHeight: 620, overflow: "auto" }}>
              <table className="tp-table tp-table--sticky" style={{ minWidth: 720 }}>
                <thead>
                  <tr>
                    <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                    <th>Stop</th><th>Route</th><th>Coordinates</th><th>Students</th><th>Monthly fare</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ stop: s, route: r }) => {
                    const sel = selection.isSelected(s.id);
                    const cls = [sel ? "is-selected" : "", focusId === s.id ? "is-focused" : ""].filter(Boolean).join(" ");
                    return (
                      <tr key={s.id} id={`pp-row-${s.id}`} className={cls || undefined}>
                        <td style={{ width: 42 }}><input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(s.id)} aria-label={`Select ${s.name}`} /></td>
                        <td>
                          <button type="button" className="tp-link-reset" onClick={() => focus(s.id, false)} aria-label={`Locate ${s.name} on the map`}
                            style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ width: 24, height: 24, borderRadius: 999, background: T.pu, color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{s.seq}</span>
                            <span>
                              <span style={{ display: "block", fontWeight: 700, color: T.ink }}>{s.name}</span>
                              <span style={{ display: "block", fontSize: 11.5, color: T.muted, marginTop: 2 }}>{s.landmark}</span>
                            </span>
                          </button>
                        </td>
                        <td><Chip tone="purple">{r.code}</Chip></td>
                        <td className="tp-mono" style={{ fontSize: 11.5, color: T.inkChip, whiteSpace: "nowrap" }}>{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</td>
                        <td>{s.students}</td>
                        <td style={{ fontWeight: 700 }}>{inr(s.fare)}</td>
                        <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                          <RowIconButton label={`View ${s.name}`} onClick={() => { focus(s.id, false); setDrawerId(s.id); }}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                          <RowIconButton label={`Edit ${s.name}`} onClick={() => setForm({ mode: "edit", id: s.id })}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
                          <RowIconButton label={`Delete ${s.name}`} onClick={() => setConfirm({ kind: "delete", id: s.id })}><X size={15} strokeWidth={2} /></RowIconButton>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Map */}
        <div className="tp-card tp-split-side" style={{ padding: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Route map</div>
              <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                {highlighted ? `${highlighted.code} · ${highlighted.name} highlighted` : `All routes · ${visibleOnMap} points visible`}
              </div>
            </div>
            <select aria-label="Highlight route" value={highlight ?? ""} onChange={(e) => setHighlight(e.target.value || null)}
              style={{ height: 36, padding: "0 8px", border: `1px solid ${T.cardBd}`, borderRadius: 9, background: "#fff", fontSize: 13, color: T.ink }}>
              <option value="">All routes</option>
              {routes.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
            </select>
          </div>
          <RouteMap routes={routes} visibleStopIds={visibleSet} highlight={highlight} focusedStopId={focusId}
            onSelectStop={(id) => focus(id, true)} ariaLabel="Pickup points route map" />
          <MapLegend />
        </div>
      </div>

      <BulkBar count={selection.count} onClear={selection.clear} actions={[
        { label: "Move to route", onClick: () => setMoveOpen(true) },
        { label: "Export", onClick: () => {
          const list = points.filter((p) => selection.isSelected(p.stop.id));
          downloadCsv("transport-pickup-points-selected.csv", csv, list); toast(`Exported ${plural(list.length, "pickup point")}`); selection.clear();
        } },
        { label: "Archive", onClick: () => setConfirm({ kind: "bulkDelete" }) },
      ]} />

      {drawer && (
        <Drawer open onClose={() => setDrawerId(null)} label={`Pickup point ${drawer.stop.name}`}>
          <DrawerHeader avatar={String(drawer.stop.seq)} title={drawer.stop.name} sub={`${drawer.route.code} · ${drawer.route.name} · Stop ${drawer.stop.seq}`}
            idLabel={drawer.stop.pickupId} badges={<><Badge tone="green">Active</Badge>{drawer.route.zone && <Badge tone="purple">{drawer.route.zone} zone</Badge>}</>} />
          <DrawerHighlight items={[{ label: "Students boarding", value: String(drawer.stop.students) }, { label: "Monthly fare", value: inr(drawer.stop.fare) }]} />
          <DrawerSection title="Location">
            <InfoRow label="Landmark">{drawer.stop.landmark || "—"}</InfoRow>
            <InfoRow label="Latitude"><span className="tp-mono">{drawer.stop.lat.toFixed(4)}</span></InfoRow>
            <InfoRow label="Longitude"><span className="tp-mono">{drawer.stop.lng.toFixed(4)}</span></InfoRow>
            <InfoRow label="Geofence radius">{drawer.stop.radius ? `${drawer.stop.radius} m` : "—"}</InfoRow>
          </DrawerSection>
          <DrawerSection title="Schedule">
            <InfoRow label="Morning pickup">{drawer.stop.pickupTime ? fmtTime(drawer.stop.pickupTime) : "Not set"}</InfoRow>
            <InfoRow label="Afternoon drop">{drawer.stop.dropTime ? fmtTime(drawer.stop.dropTime) : "Not set"}</InfoRow>
          </DrawerSection>
          <DrawerActions>
            <Button type="button" variant="soft" size="sm" onClick={() => setForm({ mode: "edit", id: drawer.stop.id })}>Edit point</Button>
            <Button type="button" variant="red" size="sm" onClick={() => setConfirm({ kind: "delete", id: drawer.stop.id })}>Delete point</Button>
          </DrawerActions>
        </Drawer>
      )}

      {form && (
        <PointForm key={form.mode === "edit" ? form.id : "add"} mode={form.mode} routes={routes}
          initial={formPoint
            ? { name: formPoint.stop.name, landmark: formPoint.stop.landmark, routeCode: formPoint.route.code,
                lat: String(formPoint.stop.lat), lng: String(formPoint.stop.lng), fare: String(formPoint.stop.fare),
                pickupTime: formPoint.stop.pickupTime, dropTime: formPoint.stop.dropTime }
            : { name: "", landmark: "", routeCode: highlight ?? routes[0]?.code ?? "", lat: "", lng: "", fare: String(defaultStopFare(state.settings.fareSlabs)), pickupTime: "", dropTime: "" }}
          onClose={() => setForm(null)} onSubmit={submitForm} />
      )}

      {moveOpen && (
        <MoveStopsModal title="Move to route" subtitle="Move the selected points to another route" fieldLabel="Route" cta="Move points"
          routes={routes} onClose={() => setMoveOpen(false)}
          onSubmit={async (code) => {
            const n = selection.count;
            const r = routes.find((x) => x.code === code);
            if (!(await dispatch({ type: "stop/move", ids: selection.ids, routeCode: code }))) { toast(`Not saved: ${errorText()}`, "error"); return; }
            selection.clear(); setMoveOpen(false);
            toast(`${plural(n, "point")} moved to ${r ? `${r.code} · ${r.name}` : code}`);
          }} />
      )}

      <ConfirmDialog open={!!confirmText} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="danger"
        title={confirmText?.title ?? ""} message={confirmText?.message ?? ""} confirmLabel={confirmText?.label ?? ""} />
    </TransportPage>
  );
}

function PointForm({
  mode, routes, initial, onClose, onSubmit,
}: { mode: "add" | "edit"; routes: TransportRoute[]; initial: FormValues; onClose: () => void; onSubmit: (v: FormValues) => void }) {
  const { toast } = useTpToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<{ name?: string; lat?: string; lng?: string; routeCode?: string }>({});
  const set = (k: keyof FormValues, val: string) => { setV((p) => ({ ...p, [k]: val })); setErrors((e) => ({ ...e, [k]: undefined })); };
  const submit = () => {
    const e: typeof errors = {};
    if (!v.name.trim()) e.name = "This field is required.";
    if (!v.routeCode) e.routeCode = "This field is required.";
    if (coord(v.lat, 90) === null) e.lat = "Enter a latitude between -90 and 90.";
    if (coord(v.lng, 180) === null) e.lng = "Enter a longitude between -180 and 180.";
    setErrors(e);
    if (Object.keys(e).length) { toast("Fill in the required fields", "error"); return; }
    onSubmit({ ...v, name: v.name.trim() });
  };
  return (
    <Modal open onClose={onClose} size="md" title={mode === "add" ? "Add pickup point" : "Edit pickup point"} subtitle="Location, route and monthly fare"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <SaveButton onClick={submit}>{mode === "add" ? "Add pickup point" : "Save changes"}</SaveButton>
      </>}>
      <div className="tp-form-grid">
        <Field label="Stop name" required error={errors.name}>
          <Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Kothaguda X Rd" />
        </Field>
        <Field label="Landmark"><Input value={v.landmark} onChange={(e) => set("landmark", e.target.value)} placeholder="e.g. opp. petrol bunk" /></Field>
        <Field label="Route" required error={errors.routeCode}>
          <Select value={v.routeCode} onChange={(e) => set("routeCode", e.target.value)}>
            {!v.routeCode && <option value="">Choose a route</option>}
            {routes.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
          </Select>
        </Field>
        <Field label="Latitude" required error={errors.lat}><Input type="number" step="0.000001" value={v.lat} onChange={(e) => set("lat", e.target.value)} className="tp-mono" placeholder="e.g. 17.4486" /></Field>
        <Field label="Longitude" required error={errors.lng}><Input type="number" step="0.000001" value={v.lng} onChange={(e) => set("lng", e.target.value)} className="tp-mono" placeholder="e.g. 78.3908" /></Field>
        <Field label="Pickup time"><Input type="time" value={v.pickupTime} onChange={(e) => set("pickupTime", e.target.value)} /></Field>
        <Field label="Drop time"><Input type="time" value={v.dropTime} onChange={(e) => set("dropTime", e.target.value)} /></Field>
        <Field label="Monthly fare (₹)" hint="Per student per month"><Input type="number" min={0} value={v.fare} onChange={(e) => set("fare", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

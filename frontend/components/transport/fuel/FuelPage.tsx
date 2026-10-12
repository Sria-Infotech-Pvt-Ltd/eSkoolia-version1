"use client";
/** Fuel Management — /transport/fuel (Master Prompt §7.12). */
import { useCallback, useMemo, useState } from "react";
import { Eye, Pencil, X } from "lucide-react";
import { useTransport, useVehicles } from "@/lib/transport/store";
import { FLEET_KML_TREND } from "@/lib/transport/mock";
import { fmtDate, inr, num, plural, toISO, TODAY } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { FuelEntry, Vehicle } from "@/lib/transport/types";
import {
  Badge, BulkBar, Button, ConfirmDialog, Drawer, DrawerActions, DrawerHeader, DrawerHighlight, DrawerSection, Field, HeroPrimary,
  HeroSecondary, InfoRow, Input, KpiCard, KpiGrid, Modal, OutlineButton, PageHero, RowIconButton, SearchRow, Select, ShowMoreRow,
  SmartFilter, T, TransportPage, useDeepLink, useMountSkeleton, useSelection, useTpToast, type FilterChip,
} from "@/components/transport/ui";
import { EfficiencyTrendChart, SpendByVehicleChart } from "./FuelCharts";

const ALL = "all";
const PAGE = 20;
const STATIONS = ["[Fuel Station A]", "[Fuel Station B]", "[Fuel Station C]"];
const isOctober = (iso: string) => iso.startsWith("2026-10");
const deviation = (f: FuelEntry) => Math.round((f.kml / f.baseKml - 1) * 100);
const isAnomaly = (f: FuelEntry) => f.kml < f.baseKml * 0.8;
/** "−28%" (typographic minus, §7.12). */
const devLabel = (f: FuelEntry) => { const d = deviation(f); return `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d)}%`; };

type ConfirmState = { kind: "delete"; id: string } | { kind: "bulkDelete" };
interface FormValues { vehicleId: string; date: string; litres: string; rate: string; odometer: string; station: string }

export function FuelPage() {
  const { state, dispatch } = useTransport();
  const vehicles = useVehicles();
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [fVehicle, setFVehicle] = useState(ALL);
  const [fCheck, setFCheck] = useState(ALL);
  const [fPeriod, setFPeriod] = useState("month");
  const [fStation, setFStation] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const selection = useSelection();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const reg = useCallback((id: string) => state.vehicles.find((v) => v.id === id)?.reg ?? "—", [state.vehicles]);
  const sorted = useMemo(() => [...state.fuel].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)), [state.fuel]);
  const byId = useCallback((id: string | null) => state.fuel.find((f) => f.id === id) ?? null, [state.fuel]);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return sorted.filter((f) => {
      if (fVehicle !== ALL && f.vehicleId !== fVehicle) return false;
      if (fCheck === "anomaly" && !isAnomaly(f)) return false;
      if (fCheck === "normal" && isAnomaly(f)) return false;
      if (fPeriod === "month" && !isOctober(f.date)) return false;
      if (fStation !== ALL && f.station !== fStation) return false;
      if (q && ![reg(f.vehicleId), f.id, f.station].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sorted, fVehicle, fCheck, fPeriod, fStation, applied, reg]);

  const visibleIds = visible.map((f) => f.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));
  const CHECK: Record<string, string> = { anomaly: "Anomalies only", normal: "Normal only" };
  const chips: FilterChip[] = [
    ...(fPeriod === "month" && fVehicle === ALL ? [{ label: "This month · all vehicles", tone: "purple" as const }] : []),
    ...(fPeriod === "month" && fVehicle !== ALL ? [{ label: "This month", tone: "purple" as const }] : []),
    ...(fPeriod !== "month" ? [{ label: "Period: Any date", tone: "purple" as const }] : []),
    ...(fVehicle !== ALL ? [{ label: `Vehicle: ${reg(fVehicle)}`, tone: "purple" as const }] : []),
    ...(fCheck !== ALL ? [{ label: `Check: ${CHECK[fCheck]}`, tone: "purple" as const }] : []),
    ...(fStation !== ALL ? [{ label: `Station: ${fStation}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  // KPIs (month to date)
  const mtd = state.fuel.filter((f) => isOctober(f.date));
  const litres = mtd.reduce((s, f) => s + f.litres, 0);
  const spend = mtd.reduce((s, f) => s + f.amount, 0);
  const avgKml = state.fuel.length ? state.fuel.reduce((s, f) => s + f.kml, 0) / state.fuel.length : 0;
  const anomalies = state.fuel.filter(isAnomaly).length;
  const spendByVehicle = vehicles.map((v) => ({ plate: v.reg, amount: mtd.filter((f) => f.vehicleId === v.id).reduce((s, f) => s + f.amount, 0) }));

  const csv: CsvColumn<FuelEntry>[] = [
    { header: "Entry ID", value: (f) => f.id }, { header: "Date", value: (f) => fmtDate(f.date) }, { header: "Vehicle", value: (f) => reg(f.vehicleId) },
    { header: "Station", value: (f) => f.station }, { header: "Litres", value: (f) => f.litres }, { header: "Rate", value: (f) => f.rate.toFixed(2) },
    { header: "Amount", value: (f) => f.amount }, { header: "Odometer (km)", value: (f) => f.odometer }, { header: "km/L", value: (f) => f.kml.toFixed(2) },
    { header: "Check", value: (f) => (isAnomaly(f) ? `Anomaly ${devLabel(f)}` : "Normal") }, { header: "Verified", value: (f) => (f.verified ? "Yes" : "No") },
  ];
  const exportVisible = () => { downloadCsv("transport-fuel-log.csv", csv, visible); toast(`Exported ${plural(visible.length, "fuel entry", "fuel entries")} to CSV`); };

  useDeepLink(({ id, isNew }) => {
    if (id) { const f = state.fuel.find((x) => x.id === id); if (f) { setFPeriod(ALL); setDrawerId(f.id); } }
    if (isNew) setForm({ mode: "add" });
  });

  const resetFilters = () => { setFVehicle(ALL); setFCheck(ALL); setFPeriod("month"); setFStation(ALL); setQuery(""); setApplied(""); setLimit(PAGE); };

  const submitForm = (v: FormValues) => {
    if (!form) return;
    const input = { vehicleId: v.vehicleId, date: v.date, litres: Number(v.litres), rate: Number(v.rate), odometer: Number(v.odometer), station: v.station };
    if (form.mode === "add") { dispatch({ type: "fuel/add", input }); toast(`Fuel logged for ${reg(v.vehicleId)}`); }
    else { dispatch({ type: "fuel/update", id: form.id, input }); toast("Fuel entry updated"); }
    setForm(null);
  };

  const runConfirm = () => {
    if (!confirm) return;
    const cf = confirm;
    setConfirm(null); setDrawerId(null);
    if (cf.kind === "delete") { dispatch({ type: "fuel/delete", ids: [cf.id] }); toast(`${cf.id} deleted`); }
    else { const n = selection.count; dispatch({ type: "fuel/delete", ids: selection.ids }); selection.clear(); toast(`${plural(n, "entry", "entries")} deleted`); }
  };
  const confirmText = !confirm ? null : confirm.kind === "bulkDelete"
    ? { title: `Delete ${plural(selection.count, "entry", "entries")}?`, message: "They are removed from spend and efficiency figures.", label: "Delete all" }
    : { title: `Delete ${confirm.id}?`, message: "The fill-up is removed from spend and efficiency figures.", label: "Delete entry" };

  const drawer = byId(drawerId);
  const formEntry = form?.mode === "edit" ? byId(form.id) : null;

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Cost" title="Fuel" accent="management"
        sub="Fill-ups, spend and efficiency for every vehicle. Sudden drops in km per litre are flagged so leaks, idling and pilferage get caught early."
        actions={<>
          <HeroSecondary onClick={exportVisible}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setForm({ mode: "add" })}>Log Fuel</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Litres MTD" value={num(litres)} sub={`${plural(mtd.length, "fill-up")} in October`} />
        <KpiCard loading={loading} label="Spend MTD" value={inr(spend)} sub={`Avg ₹${litres ? (spend / litres).toFixed(2) : "0.00"} per litre`} color={T.pu} />
        <KpiCard loading={loading} label="Avg km/L" value={avgKml.toFixed(1)} sub="Fleet-wide, all vehicle types" color={T.green} />
        <KpiCard loading={loading} label="Anomalies" value={anomalies} sub="km/L more than 20% below normal" color={T.red} />
      </KpiGrid>

      <SmartFilter chips={chips} onReset={resetFilters} fields={[
        { key: "vehicle", label: "Vehicle", value: fVehicle, onChange: setFVehicle, options: [{ value: ALL, label: "All vehicles" }, ...vehicles.map((v) => ({ value: v.id, label: v.reg }))] },
        { key: "check", label: "Check", value: fCheck, onChange: setFCheck, options: [{ value: ALL, label: "Any check" }, { value: "anomaly", label: "Anomalies only" }, { value: "normal", label: "Normal only" }] },
        { key: "period", label: "Period", value: fPeriod, onChange: setFPeriod, options: [{ value: "month", label: "This month" }, { value: ALL, label: "Any date" }] },
        { key: "station", label: "Station", value: fStation, onChange: setFStation, options: [{ value: ALL, label: "All stations" }, ...STATIONS.map((s) => ({ value: s, label: s }))] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={() => setApplied(query.trim())} placeholder="Search by vehicle, entry ID or station…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportVisible} />

      <div className="tp-split tp-split--charts" style={{ marginBottom: 12 }}>
        <SpendByVehicleChart data={spendByVehicle} />
        <EfficiencyTrendChart data={FLEET_KML_TREND} />
      </div>

      <div className="tp-card" style={{ overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${T.rowBd}` }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>Fuel log</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>Every fill-up · anomaly flagged when km/L drops more than 20% below the vehicle&apos;s average</div>
          </div>
          <OutlineButton onClick={() => { downloadCsv("transport-fuel-log-view.csv", csv, visible); toast("Current view exported"); }}>Export view</OutlineButton>
        </div>
        {visible.length === 0 ? (
          <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: T.muted }}>No fuel entries match these filters. Try clearing the search or resetting filters.</div>
        ) : (
          <div className="tp-scroll-x">
            <table className="tp-table" style={{ minWidth: 1100 }}>
              <thead>
                <tr>
                  <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                  <th>Date</th><th>Vehicle</th><th>Litres</th><th>Rate</th><th>Amount</th><th>Odometer</th><th>km/L</th><th>Check</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.slice(0, limit).map((f) => {
                  const sel = selection.isSelected(f.id);
                  const bad = isAnomaly(f);
                  return (
                    <tr key={f.id} className={sel ? "is-selected" : undefined}>
                      <td style={{ width: 42 }}><input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(f.id)} aria-label={`Select ${f.id}`} /></td>
                      <td style={{ whiteSpace: "nowrap" }}>{fmtDate(f.date)}</td>
                      <td>
                        <div className="tp-mono" style={{ fontSize: 12.5, fontWeight: 700, color: T.ink }}>{reg(f.vehicleId)}</div>
                        <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{f.id} · {f.station}</div>
                      </td>
                      <td>{f.litres} L</td>
                      <td>₹{f.rate.toFixed(2)}</td>
                      <td style={{ fontWeight: 700 }}>{inr(f.amount)}</td>
                      <td className="tp-mono" style={{ fontSize: 12.5 }}>{num(f.odometer)}</td>
                      <td style={{ fontWeight: 700, color: bad ? T.danger : T.ink }}>{f.kml.toFixed(1)}</td>
                      <td>{bad ? <Badge tone="red">Anomaly {devLabel(f)}</Badge> : <Badge tone="green">Normal</Badge>}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <RowIconButton label={`View ${f.id}`} onClick={() => setDrawerId(f.id)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                        <RowIconButton label={`Edit ${f.id}`} onClick={() => setForm({ mode: "edit", id: f.id })}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
                        <RowIconButton label={`Delete ${f.id}`} onClick={() => setConfirm({ kind: "delete", id: f.id })}><X size={15} strokeWidth={2} /></RowIconButton>
                      </td>
                    </tr>
                  );
                })}
                <ShowMoreRow colSpan={10} remaining={visible.length - limit} step={PAGE} noun="entries" onMore={() => setLimit((l) => l + PAGE)} />
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: "12px 16px", borderTop: `1px solid ${T.rowBd}`, fontSize: 12, color: T.muted }}>
          Showing {Math.min(limit, visible.length)} of {plural(visible.length, "fill-up")}
          <span style={{ color: T.label }}> · {num(visible.reduce((s, f) => s + f.litres, 0))} L · {inr(visible.reduce((s, f) => s + f.amount, 0))}</span>
        </div>
      </div>

      <BulkBar count={selection.count} onClear={selection.clear} actions={[
        { label: "Mark verified", onClick: () => { const n = selection.count; dispatch({ type: "fuel/verify", ids: selection.ids }); selection.clear(); toast(`${plural(n, "entry", "entries")} marked verified`); } },
        { label: "Message", onClick: () => { toast(`Drivers of ${plural(selection.count, "entry", "entries")} asked to explain`, "info"); selection.clear(); } },
        { label: "Export", onClick: () => {
          const list = state.fuel.filter((f) => selection.isSelected(f.id));
          downloadCsv("transport-fuel-selected.csv", csv, list); toast(`Exported ${plural(list.length, "entry", "entries")}`); selection.clear();
        } },
        { label: "Archive", onClick: () => setConfirm({ kind: "bulkDelete" }) },
      ]} />

      {drawer && (
        <Drawer open onClose={() => setDrawerId(null)} label={`Fuel entry ${drawer.id}`}>
          <DrawerHeader avatar="FL" title={reg(drawer.vehicleId)} titleMono sub={`${fmtDate(drawer.date)} · ${drawer.station}`} idLabel={drawer.id}
            badges={<>{isAnomaly(drawer) ? <Badge tone="red">Anomaly</Badge> : <Badge tone="green">Normal</Badge>}{drawer.verified && <Badge tone="purple">Verified</Badge>}</>} />
          <DrawerHighlight items={[{ label: "Amount", value: inr(drawer.amount) }, { label: "Efficiency", value: `${drawer.kml.toFixed(1)} km/L` }]} />
          <DrawerSection title="Fill-up">
            <InfoRow label="Litres">{drawer.litres} L</InfoRow>
            <InfoRow label="Rate">₹{drawer.rate.toFixed(2)} / L</InfoRow>
            <InfoRow label="Odometer"><span className="tp-mono">{num(drawer.odometer)} km</span></InfoRow>
            <InfoRow label="Receipt">[Receipt ref]</InfoRow>
          </DrawerSection>
          <DrawerSection title="Benchmark">
            <InfoRow label="Vehicle average">{drawer.baseKml.toFixed(1)} km/L</InfoRow>
            <InfoRow label="Deviation">{devLabel(drawer)}</InfoRow>
          </DrawerSection>
          <DrawerActions>
            <Button type="button" variant="soft" size="sm" onClick={() => setForm({ mode: "edit", id: drawer.id })}>Edit entry</Button>
            <Button type="button" variant="soft" size="sm" onClick={() => toast("Driver asked to explain the reading", "info")}>Ask driver</Button>
            <Button type="button" variant="red" size="sm" onClick={() => setConfirm({ kind: "delete", id: drawer.id })}>Delete entry</Button>
          </DrawerActions>
        </Drawer>
      )}

      {form && (
        <FuelForm key={form.mode === "edit" ? form.id : "add"} mode={form.mode} vehicles={vehicles}
          initial={formEntry
            ? { vehicleId: formEntry.vehicleId, date: formEntry.date, litres: String(formEntry.litres), rate: formEntry.rate.toFixed(2), odometer: String(formEntry.odometer), station: formEntry.station }
            : { vehicleId: vehicles[0]?.id ?? "", date: toISO(TODAY), litres: "", rate: "94.90", odometer: "", station: STATIONS[0] }}
          onClose={() => setForm(null)} onSubmit={submitForm} />
      )}

      <ConfirmDialog open={!!confirmText} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="danger"
        title={confirmText?.title ?? ""} message={confirmText?.message ?? ""} confirmLabel={confirmText?.label ?? ""} />
    </TransportPage>
  );
}

function FuelForm({ mode, vehicles, initial, onClose, onSubmit }: {
  mode: "add" | "edit"; vehicles: Vehicle[]; initial: FormValues; onClose: () => void; onSubmit: (v: FormValues) => void;
}) {
  const { toast } = useTpToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const set = (k: keyof FormValues, val: string) => { setV((p) => ({ ...p, [k]: val })); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })); };
  const submit = () => {
    const e: typeof errors = {};
    const positive = (s: string) => s.trim() !== "" && Number(s) > 0;
    if (!v.vehicleId) e.vehicleId = "This field is required.";
    if (!v.date) e.date = "This field is required.";
    if (!positive(v.litres)) e.litres = "This field is required.";
    if (!positive(v.rate)) e.rate = "This field is required.";
    if (!positive(v.odometer)) e.odometer = "This field is required.";
    setErrors(e);
    if (Object.keys(e).length) { toast("Fill in the required fields", "error"); return; }
    onSubmit(v);
  };
  return (
    <Modal open onClose={onClose} size="md" title={mode === "add" ? "Log fuel" : "Edit fuel entry"} subtitle="Litres, rate and odometer reading"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>{mode === "add" ? "Log fuel" : "Save changes"}</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Vehicle" required error={errors.vehicleId}>
          <Select value={v.vehicleId} onChange={(e) => set("vehicleId", e.target.value)}>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.reg}</option>)}</Select>
        </Field>
        <Field label="Date" required error={errors.date}><Input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Litres" required error={errors.litres}><Input type="number" min={0} step="0.1" value={v.litres} onChange={(e) => set("litres", e.target.value)} placeholder="e.g. 72" /></Field>
        <Field label="Rate (₹ / L)" required error={errors.rate}><Input type="number" min={0} step="0.01" value={v.rate} onChange={(e) => set("rate", e.target.value)} /></Field>
        <Field label="Odometer (km)" required error={errors.odometer}><Input type="number" min={0} value={v.odometer} onChange={(e) => set("odometer", e.target.value)} /></Field>
        <Field label="Station">
          <Select value={v.station} onChange={(e) => set("station", e.target.value)}>{STATIONS.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </Field>
      </div>
    </Modal>
  );
}

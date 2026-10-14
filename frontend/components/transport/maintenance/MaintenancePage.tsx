"use client";
/**
 * Maintenance — /transport/maintenance (Master Prompt §7.11). One accordion per
 * vehicle. Records come from transport-maintenance/; "Overdue" and "Due soon"
 * are worked out by the backend from the service date of jobs not yet done.
 * While any filter or search is active, vehicles with no matching record are
 * hidden and matching groups open automatically.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Eye, Pencil, X } from "lucide-react";
import { useTransport, useVehicles } from "@/lib/transport/store";
import { daysLeft, fmtDate, inr, num, plural, toISO, TODAY } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { ServiceRecord, ServiceStatus, Vehicle } from "@/lib/transport/types";
import {
  Badge, BulkBar, Button, Chip, ConfirmDialog, Drawer, DrawerActions, DrawerHeader, DrawerHighlight, DrawerSection, EmptyLine, Field,
  GroupCard, GroupedList, HeroPrimary, HeroSecondary, InfoRow, Input, KpiCard, KpiGrid, Modal, OutlineButton, PageHero, RowIconButton,
  SearchRow, Select, SmartFilter, T, TransportPage, useDeepLink, useGroupOpen, useMountSkeleton, useSelection, useTpToast,
  type FilterChip, type Tone,
} from "@/components/transport/ui";

const ALL = "all";
const STATUSES: ServiceStatus[] = ["Completed", "Scheduled", "Due soon", "Overdue", "In workshop"];
/** Statuses the desk sets; "Overdue" / "Due soon" follow from the date. */
const SETTABLE: ServiceStatus[] = ["Scheduled", "In workshop", "Completed"];
/** Common service types offered as suggestions (any type can be typed). */
const TYPES = [
  "Periodic service (10k km)", "Brake pads & shoes", "Tyre rotation", "Battery replacement", "AC servicing",
  "Clutch overhaul", "Coolant flush", "Speed governor calibration", "GPS & CCTV check",
];
const WORST: ServiceStatus[] = ["Overdue", "In workshop", "Due soon", "Scheduled"];
const STATUS_TONE: Record<ServiceStatus, Tone> = { Completed: "green", Scheduled: "blue", "Due soon": "amber", Overdue: "red", "In workshop": "amber" };
const MONTH = toISO(TODAY).slice(0, 7);
const isThisMonth = (iso: string) => iso.startsWith(MONTH);

type ConfirmState = { kind: "delete"; id: string } | { kind: "bulkDelete" };
interface FormValues { vehicleId: string; date: string; type: string; status: ServiceStatus; odometer: string; cost: string; vendor: string; workDone: string }

export function MaintenancePage() {
  const { state, dispatch } = useTransport();
  const vehicles = useVehicles();
  const records = state.maintenance;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [fStatus, setFStatus] = useState(ALL);
  const [fType, setFType] = useState(ALL);
  const [fVendor, setFVendor] = useState(ALL);
  const [fDate, setFDate] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const groups = useGroupOpen(vehicles[0]?.id ?? "");
  const [closedWhileFiltered, setClosedWhileFiltered] = useState<Set<string>>(new Set());
  const selection = useSelection();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: "add"; vehicleId: string } | { mode: "edit"; id: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const vehicleOf = useCallback((id: string) => state.vehicles.find((v) => v.id === id) ?? null, [state.vehicles]);
  const types = useMemo(() => [...new Set([...records.map((r) => r.type), ...TYPES])].filter(Boolean).sort(), [records]);
  const vendors = useMemo(() => [...new Set(records.map((r) => r.vendor).filter(Boolean))].sort(), [records]);
  const byId = useCallback((id: string | null) => records.find((r) => r.id === id) ?? null, [records]);

  const filtersActive = fStatus !== ALL || fType !== ALL || fVendor !== ALL || fDate !== ALL || applied !== "";
  useEffect(() => { setClosedWhileFiltered(new Set()); }, [fStatus, fType, fVendor, fDate, applied]);

  const matches = useCallback((r: ServiceRecord) => {
    const q = applied.toLowerCase();
    if (fStatus !== ALL && r.status !== fStatus) return false;
    if (fType !== ALL && r.type !== fType) return false;
    if (fVendor !== ALL && r.vendor !== fVendor) return false;
    if (fDate === "month" && !isThisMonth(r.date)) return false;
    if (fDate === "90" && !(daysLeft(r.date) >= -90 && daysLeft(r.date) <= 0)) return false;
    if (q) {
      const v = vehicleOf(r.vehicleId);
      if (![v?.reg ?? "", v?.model ?? "", r.type, r.vendor, r.id, r.workDone].join(" ").toLowerCase().includes(q)) return false;
    }
    return true;
  }, [applied, fStatus, fType, fVendor, fDate, vehicleOf]);

  const visible = useMemo(() => records.filter(matches), [records, matches]);
  const visibleIds = visible.map((r) => r.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));
  const DATE: Record<string, string> = { month: "This month", "90": "Last 90 days" };
  const chips: FilterChip[] = [
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus}`, tone: "purple" as const }] : []),
    ...(fType !== ALL ? [{ label: `Type: ${fType}`, tone: "purple" as const }] : []),
    ...(fVendor !== ALL ? [{ label: `Vendor: ${fVendor}`, tone: "purple" as const }] : []),
    ...(fDate !== ALL ? [{ label: `Date: ${DATE[fDate]}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  // KPIs
  const dueWeek = records.filter((r) => (r.status === "Due soon" || r.status === "Scheduled") && daysLeft(r.date) >= 0 && daysLeft(r.date) <= 7).length;
  const overdue = records.filter((r) => r.status === "Overdue").length;
  const workshop = records.filter((r) => r.status === "In workshop").length;
  const spendMtd = records.filter((r) => isThisMonth(r.date) && r.status === "Completed").reduce((s, r) => s + r.cost, 0);

  const csv: CsvColumn<ServiceRecord>[] = [
    { header: "Record ID", value: (r) => r.id }, { header: "Vehicle", value: (r) => vehicleOf(r.vehicleId)?.reg ?? "" },
    { header: "Date", value: (r) => fmtDate(r.date) }, { header: "Service type", value: (r) => r.type }, { header: "Work done", value: (r) => r.workDone },
    { header: "Odometer (km)", value: (r) => r.odometer }, { header: "Vendor", value: (r) => r.vendor }, { header: "Cost", value: (r) => r.cost },
    { header: "Status", value: (r) => r.status },
  ];
  const exportVisible = () => { downloadCsv("transport-maintenance.csv", csv, visible); toast(`Exported ${plural(visible.length, "service record")} to CSV`); };

  useDeepLink(({ id, isNew }) => {
    if (id) { const r = records.find((x) => x.id === id); if (r) { setDrawerId(r.id); groups.openOnly(r.vehicleId); } }
    if (isNew) setForm({ mode: "add", vehicleId: vehicles[0]?.id ?? "" });
  });

  const resetFilters = () => { setFStatus(ALL); setFType(ALL); setFVendor(ALL); setFDate(ALL); setQuery(""); setApplied(""); };
  const isOpen = (vid: string) => (filtersActive ? !closedWhileFiltered.has(vid) : groups.isOpen(vid));
  const toggle = (vid: string) => {
    if (filtersActive) setClosedWhileFiltered((s) => { const n = new Set(s); if (n.has(vid)) n.delete(vid); else n.add(vid); return n; });
    else groups.toggle(vid);
  };

  const complete = async (r: ServiceRecord) => {
    if (await dispatch({ type: "service/complete", ids: [r.id] })) toast(`${r.type} on ${vehicleOf(r.vehicleId)?.reg ?? ""} marked completed`);
  };

  const submitForm = async (v: FormValues) => {
    if (!form) return;
    const input = { vehicleId: v.vehicleId, date: v.date, type: v.type.trim(), status: v.status, odometer: Number(v.odometer), cost: Number(v.cost), vendor: v.vendor.trim(), workDone: v.workDone.trim() };
    const ok = form.mode === "add"
      ? await dispatch({ type: "service/add", input })
      : await dispatch({ type: "service/update", id: form.id, patch: input });
    if (!ok) { toast("Not saved — see the message above", "error"); return; }
    toast(form.mode === "add" ? `Service logged for ${vehicleOf(v.vehicleId)?.reg ?? ""}` : "Service record updated");
    groups.openOnly(v.vehicleId);
    setForm(null);
  };

  const runConfirm = () => {
    if (!confirm) return;
    const cf = confirm;
    setConfirm(null); setDrawerId(null);
    if (cf.kind === "delete") { dispatch({ type: "service/delete", ids: [cf.id] }); toast(`${cf.id} deleted`); }
    else { const n = selection.count; dispatch({ type: "service/delete", ids: selection.ids }); selection.clear(); toast(`${plural(n, "record")} deleted`); }
  };
  const confirmText = !confirm ? null : confirm.kind === "bulkDelete"
    ? { title: `Delete ${plural(selection.count, "record")}?`, message: "Their cost is removed from monthly spend.", label: "Delete all" }
    : { title: `Delete ${confirm.id}?`, message: "This removes the service record and its cost from monthly spend.", label: "Delete record" };

  const shownVehicles = vehicles.filter((v) => !filtersActive || visible.some((r) => r.vehicleId === v.id));
  const drawer = byId(drawerId);
  const formRecord = form?.mode === "edit" ? byId(form.id) : null;

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Upkeep" title="Maintenance" accent="& service"
        sub="Scheduled services, repairs and workshop visits for every vehicle — with odometer readings, vendors and cost, so nothing goes past its interval."
        actions={<>
          <HeroSecondary onClick={exportVisible}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setForm({ mode: "add", vehicleId: vehicles[0]?.id ?? "" })}>Log Service</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Due this week" value={dueWeek} sub="Scheduled or due within 7 days" color={T.amber} />
        <KpiCard loading={loading} label="Overdue" value={overdue} sub="Past interval — vehicle restricted" color={T.red} />
        <KpiCard loading={loading} label="In workshop" value={workshop} sub="Off the road today" />
        <KpiCard loading={loading} label="Spend MTD" value={inr(spendMtd)} sub="October 2026 · parts + labour" color={T.pu} />
      </KpiGrid>

      <SmartFilter chips={chips} groupingChip="Grouped by vehicle" onReset={resetFilters} fields={[
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus, options: [{ value: ALL, label: "All" }, ...STATUSES.map((s) => ({ value: s, label: s }))] },
        { key: "type", label: "Service type", value: fType, onChange: setFType, options: [{ value: ALL, label: "All types" }, ...[...new Set(records.map((r) => r.type))].sort().map((t) => ({ value: t, label: t }))] },
        { key: "vendor", label: "Vendor", value: fVendor, onChange: setFVendor, options: [{ value: ALL, label: "All vendors" }, ...vendors.map((t) => ({ value: t, label: t }))] },
        { key: "date", label: "Date", value: fDate, onChange: setFDate, options: [{ value: ALL, label: "Any date" }, { value: "month", label: "This month" }, { value: "90", label: "Last 90 days" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={() => setApplied(query.trim())} placeholder="Search by vehicle, service type, vendor or record ID…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportVisible} />

      <GroupedList title="Service log by vehicle" helper="One accordion per vehicle · donut shows how much of the 10,000 km service interval is used"
        onCollapseAll={() => { groups.collapseAll(); if (filtersActive) setClosedWhileFiltered(new Set(vehicles.map((v) => v.id))); }}
        onExpandAll={() => { groups.expandAll(vehicles.map((v) => v.id)); setClosedWhileFiltered(new Set()); }}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "4px 4px 0" }}>
            <span style={{ fontSize: 12, color: T.muted }}>
              Showing {plural(visible.length, "record")} across {plural(new Set(visible.map((r) => r.vehicleId)).size, "vehicle")}
              <span style={{ color: T.label }}> · spend shown {inr(visible.reduce((s, r) => s + r.cost, 0))}</span>
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <OutlineButton onClick={() => { groups.collapseAll(); if (filtersActive) setClosedWhileFiltered(new Set(vehicles.map((v) => v.id))); }}>Collapse all</OutlineButton>
              <OutlineButton onClick={() => { downloadCsv("transport-maintenance-view.csv", csv, visible); toast("Current view exported"); }}>Export view</OutlineButton>
            </div>
          </div>
        }>
        {shownVehicles.length === 0 ? (
          <EmptyLine>No service records match these filters. Try clearing the search or resetting filters.</EmptyLine>
        ) : shownVehicles.map((v) => {
          const all = records.filter((r) => r.vehicleId === v.id);
          const rows = visible.filter((r) => r.vehicleId === v.id).sort((a, b) => b.date.localeCompare(a.date));
          const worst = WORST.find((s) => all.some((r) => r.status === s));
          // Donut: share of a 10,000 km service interval used since the last completed service.
          const odo = v.odometer;
          const lastDone = all.filter((r) => r.status === "Completed" && r.odometer > 0).sort((a, b) => b.odometer - a.odometer)[0];
          const used = lastDone && odo ? Math.min(100, Math.max(0, (odo - lastDone.odometer) / 100)) : 0;
          const last60 = all.filter((r) => daysLeft(r.date) >= -60 && daysLeft(r.date) <= 0).reduce((s, r) => s + r.cost, 0);
          return (
            <GroupCard key={v.id} name={`${v.reg} · ${v.model}`}
              title={<><span className="tp-mono">{v.reg}</span> <span style={{ fontSize: 13, fontWeight: 500, color: T.muted }}>· {v.model}</span></>}
              open={isOpen(v.id)} onToggle={() => toggle(v.id)} pct={used}
              chips={<>
                <Chip tone="slate">{plural(all.length, "record")}</Chip>
                {worst ? <Chip tone={STATUS_TONE[worst]}>{worst}</Chip> : <Chip tone="green">Up to date</Chip>}
                <Chip tone="purple">{odo ? `${num(odo)} km` : "Odometer not recorded"}</Chip>
                <Chip tone="blue">{inr(last60)} last 60d</Chip>
              </>}
              extra={<OutlineButton onClick={() => setForm({ mode: "add", vehicleId: v.id })}>+ Log service</OutlineButton>}>
              {rows.length === 0 ? <EmptyLine>No service records for this vehicle yet.</EmptyLine> : (
                <div className="tp-scroll-x">
                  <table className="tp-table" style={{ minWidth: 1100 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                        <th>Date</th><th>Service type</th><th>Odometer</th><th>Vendor</th><th>Cost</th><th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const sel = selection.isSelected(r.id);
                        return (
                          <tr key={r.id} className={sel ? "is-selected" : undefined}>
                            <td style={{ width: 42 }}><input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(r.id)} aria-label={`Select ${r.id}`} /></td>
                            <td style={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</td>
                            <td>
                              <div style={{ fontWeight: 700, color: T.ink }}>{r.type}</div>
                              <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{r.id} · {r.workDone || "—"}</div>
                            </td>
                            <td className="tp-mono" style={{ fontSize: 12.5 }}>{num(r.odometer)} km</td>
                            <td>{r.vendor}</td>
                            <td style={{ fontWeight: 700 }}>{inr(r.cost)}</td>
                            <td><Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge></td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <RowIconButton label={`View ${r.id}`} onClick={() => setDrawerId(r.id)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label={`Edit ${r.id}`} onClick={() => setForm({ mode: "edit", id: r.id })}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
                              {r.status !== "Completed" && (
                                <RowIconButton label="Mark completed" onClick={() => complete(r)}><Check size={15} strokeWidth={2} /></RowIconButton>
                              )}
                              <RowIconButton label={`Delete ${r.id}`} onClick={() => setConfirm({ kind: "delete", id: r.id })}><X size={15} strokeWidth={2} /></RowIconButton>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </GroupCard>
          );
        })}
      </GroupedList>

      <BulkBar count={selection.count} onClear={selection.clear} actions={[
        { label: "Mark completed", onClick: () => { const n = selection.count; dispatch({ type: "service/complete", ids: selection.ids }); selection.clear(); toast(`${plural(n, "record")} marked completed`); } },
        { label: "Export", onClick: () => {
          const list = records.filter((r) => selection.isSelected(r.id));
          downloadCsv("transport-maintenance-selected.csv", csv, list); toast(`Exported ${plural(list.length, "record")}`); selection.clear();
        } },
        { label: "Archive", onClick: () => setConfirm({ kind: "bulkDelete" }) },
      ]} />

      {drawer && (() => {
        const v = vehicleOf(drawer.vehicleId);
        return (
          <Drawer open onClose={() => setDrawerId(null)} label={`Service record ${drawer.id}`}>
            <DrawerHeader avatar="SV" title={drawer.type} sub={`${v?.reg ?? ""} · ${fmtDate(drawer.date)}`} idLabel={drawer.id}
              badges={<><Badge tone={STATUS_TONE[drawer.status]}>{drawer.status}</Badge><Badge tone="purple">{drawer.vendor}</Badge></>} />
            <DrawerHighlight items={[{ label: "Cost", value: inr(drawer.cost) }, { label: "Odometer", value: `${num(drawer.odometer)} km` }]} />
            <DrawerSection title="Job">
              <InfoRow label="Vehicle"><span className="tp-mono">{v?.reg ?? "—"}</span></InfoRow>
              <InfoRow label="Service type">{drawer.type}</InfoRow>
              <InfoRow label="Work done">{drawer.workDone || "—"}</InfoRow>
              <InfoRow label="Vendor">{drawer.vendor}</InfoRow>
            </DrawerSection>
            <DrawerSection title="Billing">
              <InfoRow label="Cost">{inr(drawer.cost)}</InfoRow>
              <InfoRow label="Vendor">{drawer.vendor || "—"}</InfoRow>
            </DrawerSection>
            <DrawerActions>
              <Button type="button" variant="soft" size="sm" onClick={() => setForm({ mode: "edit", id: drawer.id })}>Edit record</Button>
              <Button type="button" variant="red" size="sm" onClick={() => setConfirm({ kind: "delete", id: drawer.id })}>Delete record</Button>
            </DrawerActions>
          </Drawer>
        );
      })()}

      {form && (
        <ServiceForm key={form.mode === "edit" ? form.id : `add-${form.vehicleId}`} mode={form.mode} vehicles={vehicles} types={types} vendors={vendors}
          initial={formRecord
            ? { vehicleId: formRecord.vehicleId, date: formRecord.date, type: formRecord.type, status: SETTABLE.includes(formRecord.status) ? formRecord.status : "Scheduled", odometer: formRecord.odometer ? String(formRecord.odometer) : "", cost: String(formRecord.cost), vendor: formRecord.vendor, workDone: formRecord.workDone }
            : { vehicleId: form.mode === "add" ? form.vehicleId : "", date: toISO(TODAY), type: "", status: "Scheduled", odometer: "", cost: "", vendor: "", workDone: "" }}
          onClose={() => setForm(null)} onSubmit={(values) => { void submitForm(values); }} />
      )}

      <ConfirmDialog open={!!confirmText} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="danger"
        title={confirmText?.title ?? ""} message={confirmText?.message ?? ""} confirmLabel={confirmText?.label ?? ""} />
    </TransportPage>
  );
}

function ServiceForm({ mode, vehicles, types, vendors, initial, onClose, onSubmit }: {
  mode: "add" | "edit"; vehicles: Vehicle[]; types: string[]; vendors: string[]; initial: FormValues; onClose: () => void; onSubmit: (v: FormValues) => void;
}) {
  const { toast } = useTpToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const set = (k: keyof FormValues, val: string) => { setV((p) => ({ ...p, [k]: val })); if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined })); };
  const submit = () => {
    const e: typeof errors = {};
    if (!v.vehicleId) e.vehicleId = "This field is required.";
    if (!v.date) e.date = "This field is required.";
    if (!v.type.trim()) e.type = "This field is required.";
    if (v.odometer.trim() && !(Number(v.odometer) >= 0)) e.odometer = "Enter a valid reading.";
    if (!v.cost.trim() || !(Number(v.cost) >= 0)) e.cost = "This field is required.";
    setErrors(e);
    if (Object.keys(e).length) { toast("Fill in the required fields", "error"); return; }
    onSubmit(v);
  };
  return (
    <Modal open onClose={onClose} size="lg" title={mode === "add" ? "Log service" : "Edit service record"} subtitle="Odometer, vendor, cost and status"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>{mode === "add" ? "Log service" : "Save changes"}</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Vehicle" required error={errors.vehicleId}>
          <Select value={v.vehicleId} onChange={(e) => set("vehicleId", e.target.value)}>{vehicles.map((x) => <option key={x.id} value={x.id}>{x.reg}</option>)}</Select>
        </Field>
        <Field label="Service date" required error={errors.date}><Input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} /></Field>
        <Field label="Service type" required error={errors.type}>
          <Input list="tp-service-types" value={v.type} onChange={(e) => set("type", e.target.value)} placeholder="e.g. Periodic service" />
          <datalist id="tp-service-types">{types.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Status" hint="Overdue and due-soon follow from the service date">
          <Select value={v.status} onChange={(e) => set("status", e.target.value)}>{SETTABLE.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Odometer (km)" error={errors.odometer}><Input type="number" min={0} value={v.odometer} onChange={(e) => set("odometer", e.target.value)} placeholder="e.g. 52,400" /></Field>
        <Field label="Cost (₹)" required error={errors.cost}><Input type="number" min={0} value={v.cost} onChange={(e) => set("cost", e.target.value)} placeholder="e.g. 8450" /></Field>
        <Field label="Vendor">
          <Input list="tp-service-vendors" value={v.vendor} onChange={(e) => set("vendor", e.target.value)} placeholder="Workshop or dealer" />
          <datalist id="tp-service-vendors">{vendors.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field label="Work done"><Input value={v.workDone} onChange={(e) => set("workDone", e.target.value)} placeholder="e.g. Engine oil, filters" /></Field>
      </div>
    </Modal>
  );
}

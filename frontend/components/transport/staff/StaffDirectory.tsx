"use client";
/**
 * Drivers (§7.3) and Attendants (§7.4) — one list-template screen driven by a
 * per-kind config, so both stay identical in layout and behaviour.
 */
import { useCallback, useMemo, useState } from "react";
import { Eye, FileText, Pencil } from "lucide-react";
import { nextId, useTransport, useVehicles } from "@/lib/transport/store";
import { SHIFT_LABELS } from "@/lib/transport/mock";
import { daysLeft, fmtDate, initials, last3, maskPhone, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { Attendant, Driver, ShiftGroup, StaffStatus } from "@/lib/transport/types";
import {
  Avatar, Badge, BulkBar, Button, CellStack, Chip, ConfirmDialog, Drawer, DrawerActions, DrawerHeader, DrawerHighlight,
  DrawerSection, EmptyLine, Field, GroupCard, GroupedList, HeroPrimary, HeroSecondary, IdPill, IdentityCell, InfoRow,
  Input, KpiCard, KpiGrid, ListFooter, Modal, MoreMenu, OutlineButton, PageHero, Plate, RowIconButton, SearchRow, Select,
  SmartFilter, StatusBadge, T, TransportPage, useDeepLink, useGroupOpen, useMountSkeleton, useSelection, useTpToast,
  type FilterChip, type Tone,
} from "@/components/transport/ui";

export type StaffKind = "driver" | "attendant";

const SHIFTS: ShiftGroup[] = ["Full day", "Morning only", "Relief & reserve"];
const STATUSES: StaffStatus[] = ["On duty", "On route", "Off duty", "On leave", "Inactive"];
const ALL = "all";

/** Common row shape for both kinds. */
interface Row {
  id: string; name: string; shift: ShiftGroup; status: StaffStatus; online: boolean; phone: string; experience: number;
  docNo: string; docValid: string; plate: string; route: string; trips: number; rating?: number; studentsOnBus?: number;
}

function toRow(kind: StaffKind, x: Driver | Attendant): Row {
  if (kind === "driver") {
    const d = x as Driver;
    return { id: d.id, name: d.name, shift: d.shift, status: d.status, online: d.online, phone: d.phone, experience: d.experience,
      docNo: d.licenceNo, docValid: d.licenceValidTill, plate: d.vehicleReg, route: d.routeLabel, trips: d.tripsThisMonth, rating: d.rating };
  }
  const a = x as Attendant;
  return { id: a.id, name: a.name, shift: a.shift, status: a.status, online: a.status === "On route" || a.status === "On duty",
    phone: a.phone, experience: a.experience, docNo: a.certificateNo, docValid: a.firstAidValidTill, plate: a.busReg,
    route: a.routeLabel, trips: a.trips, studentsOnBus: a.studentsOnBus };
}

const CFG = {
  driver: {
    noun: "driver", Noun: "Driver", idPrefix: "DR-",
    hero: { eyebrow: "Transport · Staff", title: "Drivers", accent: "on duty",
      sub: "Licences, assignments and duty status for every school bus driver. Licences expiring within 60 days are flagged automatically." },
    add: "Add Driver",
    docFilter: "Licence", docChip: "Licence", docAny: "Any licence", docAlert: "licence alerts", docKpi: "Licence expiring",
    docCol: "Licence no. & expiry", vehicleCol: "Assigned vehicle", vehicleField: "Assigned vehicle",
    search: "Search by name, staff ID, licence or vehicle…",
    listHelper: "Grouped by shift · donut shows drivers on duty right now",
    docToast: "Showing licence & documents",
    formSub: "Contact, licence and assignment", namePh: "e.g. Ravi Kumar",
    docField: "Licence number", docPh: "TS00 0000 0000000", validField: "Licence valid till", validDefault: "2028-01-01",
    assignTitle: "Assign vehicle", assignSub: "Assign the selected drivers to one vehicle", assignField: "Vehicle",
    addedAs: "added as a driver",
  },
  attendant: {
    noun: "attendant", Noun: "Attendant", idPrefix: "AT-",
    hero: { eyebrow: "Transport · Staff", title: "Bus", accent: "attendants",
      sub: "The attendants who ride with every child — assigned bus and route, duty status, and first-aid certification that must stay current." },
    add: "Add Attendant",
    docFilter: "First-aid cert.", docChip: "First-aid", docAny: "Any certificate", docAlert: "cert alerts", docKpi: "First-aid expiring",
    docCol: "First-aid certification", vehicleCol: "Assigned bus & route", vehicleField: "Assigned bus",
    search: "Search by name, staff ID, certificate or bus…",
    listHelper: "Grouped by shift · donut shows attendants on duty right now",
    docToast: "Showing first-aid certificate & documents",
    formSub: "Contact, certification and assignment", namePh: "e.g. Asha Kumari",
    docField: "First-aid certificate no.", docPh: "FA-0000-00000", validField: "Certificate valid till", validDefault: "2027-12-01",
    assignTitle: "Assign bus", assignSub: "Assign the selected attendants to one bus", assignField: "Bus",
    addedAs: "added as an attendant",
  },
} as const;

function docState(iso: string, window = 60): { tone: Tone; text: string } {
  const dl = daysLeft(iso);
  if (dl < 0) return { tone: "red", text: "Expired" };
  if (dl <= window) return { tone: "amber", text: `Expires in ${dl}d` };
  return { tone: "green", text: `Valid · ${fmtDate(iso)}` };
}

/** "+91 98765 43210" → "+91 98••• ••210" */
function maskInput(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length < 5) return raw.trim();
  return maskPhone(digits.slice(0, 2), last3(Number(digits.slice(-3))));
}

interface FormValues {
  name: string; phone: string; docNo: string; docValid: string; shift: ShiftGroup; status: StaffStatus; plate: string; experience: string;
}

type ConfirmState = { kind: "deactivate"; id: string } | { kind: "bulkArchive" };

export function StaffDirectory({ kind }: { kind: StaffKind }) {
  const c = CFG[kind];
  const { state, dispatch } = useTransport();
  const vehicles = useVehicles();
  const { toast } = useTpToast();
  const loading = useMountSkeleton();
  // Saved Settings → licence / first-aid reminder days (default 60).
  const docWindow = kind === "driver" ? state.settings.reminders.licenceDays : state.settings.reminders.firstAidDays;

  const source = kind === "driver" ? state.drivers : state.attendants;
  const rows = useMemo(() => source.filter((x) => !x.archived).map((x) => toRow(kind, x)), [source, kind]);
  const plates = vehicles.map((v) => v.reg);

  const [fShift, setFShift] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fDoc, setFDoc] = useState(ALL);
  const [fExp, setFExp] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const groups = useGroupOpen("Full day");
  const selection = useSelection();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: "add"; shift: ShiftGroup } | { mode: "edit"; id: string } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const byId = useCallback((id: string | null) => rows.find((r) => r.id === id) ?? null, [rows]);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return rows.filter((r) => {
      if (fShift !== ALL && r.shift !== fShift) return false;
      if (fStatus !== ALL && r.status !== fStatus) return false;
      if (fDoc === "expiring" && !(daysLeft(r.docValid) >= 0 && daysLeft(r.docValid) <= docWindow)) return false;
      if (fDoc === "expired" && daysLeft(r.docValid) >= 0) return false;
      if (fExp === "lt5" && r.experience >= 5) return false;
      if (fExp === "5to10" && (r.experience < 5 || r.experience > 10)) return false;
      if (fExp === "gt10" && r.experience <= 10) return false;
      if (q && ![r.name, r.id, r.docNo, r.plate, r.route].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, fShift, fStatus, fDoc, fExp, applied, docWindow]);

  const filtersActive = fShift !== ALL || fStatus !== ALL || fDoc !== ALL || fExp !== ALL || applied !== "";
  const visibleIds = visible.map((r) => r.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));
  const EXP_LABEL: Record<string, string> = { lt5: "Under 5 years", "5to10": "5–10 years", gt10: "Over 10 years" };
  const DOC_LABEL: Record<string, string> = { expiring: `Expiring ≤ ${docWindow} days`, expired: "Expired" };
  const chips: FilterChip[] = [
    ...(fShift !== ALL ? [{ label: `Shift: ${SHIFT_LABELS[fShift as ShiftGroup]}`, tone: "purple" as const }] : []),
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus}`, tone: "purple" as const }] : []),
    ...(fDoc !== ALL ? [{ label: `${c.docChip}: ${DOC_LABEL[fDoc]}`, tone: "purple" as const }] : []),
    ...(fExp !== ALL ? [{ label: `Experience: ${EXP_LABEL[fExp]}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  // ─── KPIs ───
  const activeRows = rows.filter((r) => r.status !== "Inactive");
  const online = rows.filter((r) => r.online);
  const onRoute = rows.filter((r) => r.status === "On route").length;
  const docAlerts = rows.filter((r) => daysLeft(r.docValid) <= docWindow).length;
  const avgRating = rows.length ? rows.reduce((s, r) => s + (r.rating ?? 0), 0) / rows.length : 0;
  const routesCovered = new Set(online.map((r) => r.route.match(/^R\d+/)?.[0]).filter(Boolean)).size;

  // ─── CSV ───
  const csv: CsvColumn<Row>[] = [
    { header: "ID", value: (r) => r.id }, { header: "Name", value: (r) => r.name }, { header: "Shift", value: (r) => SHIFT_LABELS[r.shift] },
    { header: "Mobile", value: (r) => r.phone }, { header: c.docField, value: (r) => r.docNo }, { header: c.validField, value: (r) => fmtDate(r.docValid) },
    { header: c.vehicleField, value: (r) => r.plate }, { header: "Route", value: (r) => r.route },
    { header: "Experience (yrs)", value: (r) => r.experience }, { header: "Status", value: (r) => r.status },
  ];
  const exportRows = (list: Row[]) => downloadCsv(`transport-${c.noun}s.csv`, csv, list);
  const exportVisible = () => { exportRows(visible); toast(`Exported ${plural(visible.length, c.noun)} to CSV`); };

  useDeepLink(({ id, isNew }) => {
    if (id) {
      const r = rows.find((x) => x.id === id);
      if (r) { setDrawerId(r.id); groups.openOnly(r.shift); }
    }
    if (isNew) setForm({ mode: "add", shift: "Full day" });
  });

  const runSearch = () => { const q = query.trim(); setApplied(q); if (q) groups.expandAll([...SHIFTS]); };
  const resetFilters = () => { setFShift(ALL); setFStatus(ALL); setFDoc(ALL); setFExp(ALL); setQuery(""); setApplied(""); };

  const markOnLeave = (r: Row) => {
    if (kind === "driver") dispatch({ type: "driver/update", id: r.id, patch: { status: "On leave" } });
    else dispatch({ type: "attendant/update", id: r.id, patch: { status: "On leave" } });
    toast(`${r.name} marked on leave`);
  };

  const submitForm = (v: FormValues) => {
    if (!form) return;
    const prev = form.mode === "edit" ? byId(form.id) : null;
    const phone = prev && v.phone === prev.phone ? prev.phone : maskInput(v.phone);
    const exp = Math.max(0, Number(v.experience) || 0);
    if (kind === "driver") {
      const input = { name: v.name, phone, licenceNo: v.docNo, licenceValidTill: v.docValid, shift: v.shift, status: v.status, vehicleReg: v.plate, experience: exp };
      if (form.mode === "add") dispatch({ type: "driver/add", id: nextId(state.drivers.map((d) => d.id), c.idPrefix, 3), input });
      else dispatch({ type: "driver/update", id: form.id, patch: input });
    } else {
      const input = { name: v.name, phone, certificateNo: v.docNo, firstAidValidTill: v.docValid, shift: v.shift, status: v.status, busReg: v.plate, experience: exp };
      if (form.mode === "add") dispatch({ type: "attendant/add", id: nextId(state.attendants.map((a) => a.id), c.idPrefix, 3), input });
      else dispatch({ type: "attendant/update", id: form.id, patch: input });
    }
    toast(form.mode === "add" ? `${v.name} ${c.addedAs}` : `${v.name} updated`);
    groups.openOnly(v.shift);
    setForm(null);
  };

  const runConfirm = () => {
    if (!confirm) return;
    const cf = confirm;
    setConfirm(null);
    setDrawerId(null);
    if (cf.kind === "deactivate") {
      const r = byId(cf.id);
      if (kind === "driver") dispatch({ type: "driver/deactivate", id: cf.id });
      else dispatch({ type: "attendant/update", id: cf.id, patch: { status: "Inactive", busReg: "Unassigned" } });
      if (r) toast(`${r.name} deactivated`);
    } else {
      const n = selection.count;
      dispatch(kind === "driver" ? { type: "driver/archive", ids: selection.ids } : { type: "attendant/archive", ids: selection.ids });
      selection.clear();
      toast(`${plural(n, c.noun)} archived`);
    }
  };

  const confirmText = (() => {
    if (!confirm) return null;
    if (confirm.kind === "bulkArchive") {
      return { title: `Archive ${plural(selection.count, c.noun)}?`, message: `Archived ${c.noun}s are removed from the duty roster and vehicle assignments.`, label: "Archive all" };
    }
    const r = byId(confirm.id);
    if (!r) return null;
    return {
      title: `Deactivate ${r.name}?`,
      message: `They will be unassigned from ${r.plate === "Unassigned" ? "their vehicle" : r.plate} and removed from the duty roster. Their records are kept.`,
      label: "Deactivate",
    };
  })();

  const drawerRow = byId(drawerId);
  const groupsShown = SHIFTS.filter((s) => !filtersActive || visible.some((r) => r.shift === s));
  const groupsWithRows = SHIFTS.filter((s) => visible.some((r) => r.shift === s)).length;

  return (
    <TransportPage>
      <PageHero eyebrow={c.hero.eyebrow} title={c.hero.title} accent={c.hero.accent} sub={c.hero.sub}
        actions={<>
          <HeroSecondary onClick={exportVisible}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setForm({ mode: "add", shift: "Full day" })}>{c.add}</HeroPrimary>
        </>} />

      <KpiGrid>
        {kind === "driver" ? (
          <>
            <KpiCard loading={loading} label="Drivers" value={activeRows.length} sub={`${activeRows.length} on the transport payroll`} />
            <KpiCard loading={loading} label="On duty today" value={online.length} sub={`${onRoute} currently on route`} color={T.green} />
            <KpiCard loading={loading} label={c.docKpi} value={docAlerts} sub={`Within ${docWindow} days or expired`} color={T.amber} />
            <KpiCard loading={loading} label="Avg rating" value={avgRating.toFixed(1)} sub="Parent feedback · last 90 days" color={T.pu} />
          </>
        ) : (
          <>
            <KpiCard loading={loading} label="Attendants" value={activeRows.length} sub="One per route plus relief pool" />
            <KpiCard loading={loading} label="On duty today" value={online.length} sub={`${onRoute} currently on route`} color={T.green} />
            <KpiCard loading={loading} label={c.docKpi} value={docAlerts} sub={`Within ${docWindow} days or expired`} color={T.amber} />
            <KpiCard loading={loading} label="Routes covered" value={`${routesCovered} / ${state.routes.length}`} sub="Routes with an attendant onboard" color={T.pu} />
          </>
        )}
      </KpiGrid>

      <SmartFilter chips={chips} groupingChip="Grouped by shift" onReset={resetFilters} fields={[
        { key: "shift", label: "Shift", value: fShift, onChange: setFShift,
          options: [{ value: ALL, label: "All shifts" }, ...SHIFTS.map((s) => ({ value: s, label: SHIFT_LABELS[s] }))] },
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus,
          options: [{ value: ALL, label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: s }))] },
        { key: "doc", label: c.docFilter, value: fDoc, onChange: setFDoc,
          options: [{ value: ALL, label: c.docAny }, { value: "expiring", label: DOC_LABEL.expiring }, { value: "expired", label: "Expired" }] },
        { key: "exp", label: "Experience", value: fExp, onChange: setFExp,
          options: [{ value: ALL, label: "Any experience" }, { value: "lt5", label: "Under 5 years" }, { value: "5to10", label: "5–10 years" }, { value: "gt10", label: "Over 10 years" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={runSearch} placeholder={c.search}
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportVisible} />

      <GroupedList title={`All ${c.noun}s`} helper={c.listHelper}
        onCollapseAll={groups.collapseAll} onExpandAll={() => groups.expandAll([...SHIFTS])}
        footer={visible.length > 0 && (
          <ListFooter summary={`Showing ${visible.length} of ${rows.length} ${c.noun}s`} counts={`across ${groupsWithRows} ${groupsWithRows === 1 ? "group" : "groups"}`}
            onCollapseAll={groups.collapseAll} onExportView={() => { exportRows(visible); toast("Current view exported"); }} />
        )}>
        {visible.length === 0 && filtersActive ? (
          <EmptyLine>No {c.noun}s match these filters. Try clearing the search or resetting filters.</EmptyLine>
        ) : groupsShown.map((shift) => {
          const list = visible.filter((r) => r.shift === shift);
          const on = list.filter((r) => r.online).length;
          return (
            <GroupCard key={shift} name={SHIFT_LABELS[shift]} open={groups.isOpen(shift)} onToggle={() => groups.toggle(shift)}
              pct={list.length ? (on / list.length) * 100 : 0}
              chips={<>
                <Chip tone="slate">{plural(list.length, c.noun)}</Chip>
                <Chip tone="green">{on} on duty</Chip>
                <Chip tone="purple">{list.filter((r) => r.status === "On leave").length} on leave</Chip>
                <Chip tone="blue">{list.filter((r) => daysLeft(r.docValid) <= docWindow).length} {c.docAlert}</Chip>
              </>}
              extra={<OutlineButton onClick={() => setForm({ mode: "add", shift })}>+ Add</OutlineButton>}>
              {list.length === 0 ? <EmptyLine>No {c.noun}s in this group yet.</EmptyLine> : (
                <div className="tp-scroll-x">
                  <table className="tp-table" style={{ minWidth: 1100 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                        <th>{c.Noun}</th><th>Staff ID</th><th>{c.docCol}</th><th>{c.vehicleCol}</th><th>Experience</th><th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => {
                        const sel = selection.isSelected(r.id);
                        const ds = docState(r.docValid, docWindow);
                        return (
                          <tr key={r.id} className={sel ? "is-selected" : undefined}>
                            <td style={{ width: 42 }}>
                              <input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(r.id)} aria-label={`Select ${r.name}`} />
                            </td>
                            <td><IdentityCell lead={<Avatar name={r.name} initials={initials(r.name)} online={r.online} />} title={r.name} sub={`${c.Noun} · ${r.phone}`} /></td>
                            <td><IdPill>{r.id}</IdPill></td>
                            <td>
                              <div className="tp-mono" style={{ fontSize: 12, color: T.ink }}>{r.docNo}</div>
                              <div style={{ marginTop: 4 }}><Badge tone={ds.tone}>{ds.text}</Badge></div>
                            </td>
                            <td>
                              <CellStack top={r.plate === "Unassigned" ? "Unassigned" : <span className="tp-mono" style={{ fontSize: 12, fontWeight: 600 }}>{r.plate}</span>} sub={r.route} />
                            </td>
                            <td>{r.experience} yrs</td>
                            <td><StatusBadge status={r.status} /></td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <RowIconButton label={`View ${r.name}`} onClick={() => setDrawerId(r.id)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label={`Edit ${r.name}`} onClick={() => setForm({ mode: "edit", id: r.id })}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label={`Documents for ${r.name}`} onClick={() => { setDrawerId(r.id); toast(c.docToast, "info"); }}><FileText size={14} strokeWidth={1.8} /></RowIconButton>
                              <MoreMenu label={`More actions for ${r.name}`} open={menuId === r.id}
                                onToggle={() => setMenuId((m) => (m === r.id ? null : r.id))} onClose={() => setMenuId(null)}
                                items={[
                                  { label: "Edit details", onClick: () => setForm({ mode: "edit", id: r.id }) },
                                  { label: "Mark on leave", color: T.warn, onClick: () => markOnLeave(r) },
                                  { label: "Deactivate", color: T.red, onClick: () => setConfirm({ kind: "deactivate", id: r.id }) },
                                ]} />
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
        { label: c.assignTitle, onClick: () => setAssignOpen(true) },
        { label: "Message", onClick: () => { toast(`Message sent to ${plural(selection.count, c.noun)}`, "info"); selection.clear(); } },
        { label: "Export", onClick: () => {
          const list = rows.filter((r) => selection.isSelected(r.id));
          exportRows(list); toast(`Exported ${plural(list.length, c.noun)}`); selection.clear();
        } },
        { label: "Archive", onClick: () => setConfirm({ kind: "bulkArchive" }) },
      ]} />

      {drawerRow && (
        <Drawer open onClose={() => setDrawerId(null)} label={`${c.Noun} ${drawerRow.name}`}>
          <DrawerHeader avatar={initials(drawerRow.name)} title={drawerRow.name} sub={`${c.Noun} · ${SHIFT_LABELS[drawerRow.shift]}`} idLabel={drawerRow.id}
            badges={<>
              <StatusBadge status={drawerRow.status} />
              {kind === "driver"
                ? <Badge tone="purple">★ {drawerRow.rating?.toFixed(1)} rating</Badge>
                : daysLeft(drawerRow.docValid) < 0 ? <Badge tone="red">First-aid expired</Badge> : <Badge tone="green">First-aid certified</Badge>}
            </>} />
          <DrawerHighlight items={kind === "driver"
            ? [{ label: "Trips this month", value: String(drawerRow.trips) }, { label: "Parent rating", value: `${drawerRow.rating?.toFixed(1)} / 5` }]
            : [{ label: "Trips this month", value: String(drawerRow.trips) }, { label: "Students on bus", value: String(drawerRow.studentsOnBus ?? 0) }]} />
          <DrawerSection title="Contact">
            <InfoRow label="Mobile">{drawerRow.phone}</InfoRow>
            <InfoRow label="Emergency contact">{kind === "driver" ? "+91 97••• ••208" : "+91 96••• ••714"}</InfoRow>
            <InfoRow label="Address">[Address on file]</InfoRow>
          </DrawerSection>
          {kind === "driver" ? (
            <DrawerSection title="Licence">
              <InfoRow label="Licence no."><span className="tp-mono">{drawerRow.docNo}</span></InfoRow>
              <InfoRow label="Class">HMV · Transport</InfoRow>
              <InfoRow label="Valid till">{fmtDate(drawerRow.docValid)} <Badge tone={docState(drawerRow.docValid, docWindow).tone}>{docState(drawerRow.docValid, docWindow).tone === "green" ? "Valid" : docState(drawerRow.docValid, docWindow).text}</Badge></InfoRow>
              <InfoRow label="Badge no.">{(state.drivers.find((d) => d.id === drawerRow.id)?.badgeNo) ?? "—"}</InfoRow>
            </DrawerSection>
          ) : (
            <DrawerSection title="First-aid certification">
              <InfoRow label="Certificate no."><span className="tp-mono">{drawerRow.docNo}</span></InfoRow>
              <InfoRow label="Issued by">[Certifying body]</InfoRow>
              <InfoRow label="Valid till">{fmtDate(drawerRow.docValid)} <Badge tone={docState(drawerRow.docValid, docWindow).tone}>{docState(drawerRow.docValid, docWindow).tone === "green" ? "Valid" : docState(drawerRow.docValid, docWindow).text}</Badge></InfoRow>
              <InfoRow label="Police verification">Completed</InfoRow>
            </DrawerSection>
          )}
          <DrawerSection title="Assignment">
            <InfoRow label={kind === "driver" ? "Vehicle" : "Bus"}>{drawerRow.plate}</InfoRow>
            <InfoRow label="Route">{drawerRow.route}</InfoRow>
            <InfoRow label="Shift">{SHIFT_LABELS[drawerRow.shift]}</InfoRow>
            <InfoRow label="Experience">{plural(drawerRow.experience, "year")}</InfoRow>
          </DrawerSection>
          <DrawerActions>
            <Button type="button" variant="soft" size="sm" onClick={() => setForm({ mode: "edit", id: drawerRow.id })}>Edit profile</Button>
            <Button type="button" variant="soft" size="sm" onClick={() => toast(`Message sent to ${drawerRow.name}`, "info")}>Message</Button>
            <Button type="button" variant="red" size="sm" onClick={() => setConfirm({ kind: "deactivate", id: drawerRow.id })}>Deactivate</Button>
          </DrawerActions>
        </Drawer>
      )}

      {form && (
        <StaffForm key={form.mode === "edit" ? form.id : `add-${form.shift}`} kind={kind} plates={plates}
          mode={form.mode}
          initial={form.mode === "edit"
            ? (() => { const r = byId(form.id)!; return { name: r.name, phone: r.phone, docNo: r.docNo, docValid: r.docValid, shift: r.shift, status: r.status, plate: r.plate, experience: String(r.experience) }; })()
            : { name: "", phone: "", docNo: "", docValid: c.validDefault, shift: form.shift, status: "On duty", plate: "Unassigned", experience: "1" }}
          onClose={() => setForm(null)} onSubmit={submitForm} />
      )}

      {assignOpen && (
        <AssignPlateModal kind={kind} count={selection.count} plates={plates} onClose={() => setAssignOpen(false)}
          onSubmit={(reg) => {
            const n = selection.count;
            dispatch(kind === "driver" ? { type: "driver/assignVehicle", ids: selection.ids, reg } : { type: "attendant/assignBus", ids: selection.ids, reg });
            selection.clear();
            setAssignOpen(false);
            toast(`${plural(n, c.noun)} assigned to ${reg}`);
          }} />
      )}

      <ConfirmDialog open={!!confirmText} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="danger"
        title={confirmText?.title ?? ""} message={confirmText?.message ?? ""} confirmLabel={confirmText?.label ?? ""} />
    </TransportPage>
  );
}

function StaffForm({
  kind, mode, initial, plates, onClose, onSubmit,
}: {
  kind: StaffKind; mode: "add" | "edit"; initial: FormValues; plates: string[]; onClose: () => void; onSubmit: (v: FormValues) => void;
}) {
  const c = CFG[kind];
  const { toast } = useTpToast();
  const [v, setV] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const set = <K extends keyof FormValues>(k: K, val: FormValues[K]) => {
    setV((p) => ({ ...p, [k]: val }));
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const submit = () => {
    const next: typeof errors = {};
    if (!v.name.trim()) next.name = "This field is required.";
    if (!v.phone.trim()) next.phone = "This field is required.";
    if (!v.docNo.trim()) next.docNo = "This field is required.";
    setErrors(next);
    if (Object.keys(next).length) { toast("Fill in the required fields", "error"); return; }
    onSubmit({ ...v, name: v.name.trim(), docNo: v.docNo.trim() });
  };
  return (
    <Modal open onClose={onClose} size="lg" title={mode === "add" ? `Add ${c.noun}` : `Edit ${c.noun}`} subtitle={c.formSub}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>{mode === "add" ? `Add ${c.noun}` : "Save changes"}</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Full name" required error={errors.name}><Input value={v.name} onChange={(e) => set("name", e.target.value)} placeholder={c.namePh} /></Field>
        <Field label="Mobile number" required error={errors.phone}><Input value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+91" inputMode="tel" /></Field>
        <Field label={c.docField} required error={errors.docNo}><Input value={v.docNo} onChange={(e) => set("docNo", e.target.value)} placeholder={c.docPh} className="tp-mono" /></Field>
        <Field label={c.validField}><Input type="date" value={v.docValid} onChange={(e) => set("docValid", e.target.value)} /></Field>
        <Field label="Shift">
          <Select value={v.shift} onChange={(e) => set("shift", e.target.value as ShiftGroup)}>
            {SHIFTS.map((s) => <option key={s} value={s}>{SHIFT_LABELS[s]}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={v.status} onChange={(e) => set("status", e.target.value as StaffStatus)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label={c.vehicleField}>
          <Select value={v.plate} onChange={(e) => set("plate", e.target.value)}>
            <option value="Unassigned">Unassigned</option>
            {plates.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Experience (years)"><Input type="number" min={0} value={v.experience} onChange={(e) => set("experience", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function AssignPlateModal({
  kind, count, plates, onClose, onSubmit,
}: { kind: StaffKind; count: number; plates: string[]; onClose: () => void; onSubmit: (reg: string) => void }) {
  const c = CFG[kind];
  const { toast } = useTpToast();
  const [reg, setReg] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    if (!reg) { setError("This field is required."); toast("Fill in the required fields", "error"); return; }
    onSubmit(reg);
  };
  return (
    <Modal open onClose={onClose} size="sm" title={c.assignTitle} subtitle={c.assignSub}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Assign</Button>
      </>}>
      <Field label={c.assignField} required error={error} hint={`Applies to ${plural(count, `selected ${c.noun}`)}.`}>
        <Select value={reg} onChange={(e) => { setReg(e.target.value); setError(undefined); }}>
          <option value="">Choose a {c.assignField.toLowerCase()}</option>
          {plates.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}

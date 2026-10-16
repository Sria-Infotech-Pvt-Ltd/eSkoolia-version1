"use client";
/**
 * Drivers (§7.3) and Attendants (§7.4) — one list-template screen driven by a
 * per-kind config, so both stay identical in layout and behaviour. Every driver /
 * attendant is an existing HR staff member with a transport profile
 * (transport-staff/); name and phone come from HR, the licence number is HR's.
 */
import { useCallback, useMemo, useState } from "react";
import { Eye, FileText, Pencil } from "lucide-react";
import { useTransport, useVehicles } from "@/lib/transport/store";
import { SHIFT_LABELS } from "@/lib/transport/catalog";
import { daysLeft, fmtDate, initials, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { Attendant, Driver, ShiftGroup, StaffStatus } from "@/lib/transport/types";
import {
  Avatar, Badge, BulkBar, Button, SaveButton, CellStack, Chip, ConfirmDialog, Drawer, DrawerActions, DrawerHeader, DrawerHighlight,
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
  docNo: string; docValid: string; plate: string; route: string; trips: number | null; rating?: number; studentsOnBus?: number;
  emergency: string;
}

function toRow(kind: StaffKind, x: Driver | Attendant): Row {
  if (kind === "driver") {
    const d = x as Driver;
    return { id: d.id, name: d.name, shift: d.shift, status: d.status, online: d.online, phone: d.phone, experience: d.experience,
      docNo: d.licenceNo, docValid: d.licenceValidTill, plate: d.vehicleReg, route: d.routeLabel, trips: d.tripsThisMonth, rating: d.rating,
      emergency: d.emergencyContact };
  }
  const a = x as Attendant;
  return { id: a.id, name: a.name, shift: a.shift, status: a.status, online: a.status === "On route" || a.status === "On duty",
    phone: a.phone, experience: a.experience, docNo: a.certificateNo, docValid: a.firstAidValidTill, plate: a.busReg,
    route: a.routeLabel, trips: a.trips, studentsOnBus: a.studentsOnBus, emergency: a.emergencyContact };
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
    formSub: "Pick an HR staff member, then licence and assignment",
    docField: "Licence number", docPh: "TS00 0000 0000000", validField: "Licence valid till",
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
    formSub: "Pick an HR staff member, then certification and assignment",
    docField: "First-aid certificate no.", docPh: "FA-0000-00000", validField: "Certificate valid till",
    assignTitle: "Assign bus", assignSub: "Assign the selected attendants to one bus", assignField: "Bus",
    addedAs: "added as an attendant",
  },
} as const;

function docState(iso: string, window = 60): { tone: Tone; text: string } {
  if (!iso) return { tone: "grey", text: "Not recorded" };
  const dl = daysLeft(iso);
  if (dl < 0) return { tone: "red", text: "Expired" };
  if (dl <= window) return { tone: "amber", text: `Expires in ${dl}d` };
  return { tone: "green", text: `Valid · ${fmtDate(iso)}` };
}

interface FormValues {
  /** hr.Staff pk (add only). */
  staffPk: string; docNo: string; docValid: string; shift: ShiftGroup; status: StaffStatus; plate: string; experience: string;
}

type ConfirmState = { kind: "deactivate"; id: string } | { kind: "bulkArchive" };

export function StaffDirectory({ kind }: { kind: StaffKind }) {
  const c = CFG[kind];
  const { state, dispatch, errorText } = useTransport();
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
  // Unrated drivers are left out of the average rather than counted as 0.
  const rated = rows.filter((r) => (r.rating ?? 0) > 0);
  const avgRating = rated.length ? rated.reduce((s, r) => s + (r.rating ?? 0), 0) / rated.length : null;
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

  const markOnLeave = async (r: Row) => {
    const ok = kind === "driver"
      ? await dispatch({ type: "driver/update", id: r.id, patch: { status: "On leave" } })
      : await dispatch({ type: "attendant/update", id: r.id, patch: { status: "On leave" } });
    if (ok) toast(`${r.name} marked on leave`);
    else toast(`Not saved: ${errorText()}`, "error");
  };

  const submitForm = async (v: FormValues) => {
    if (!form) return;
    const exp = Math.max(0, Number(v.experience) || 0);
    const name = form.mode === "edit" ? byId(form.id)?.name ?? "" : state.staffPool.find((s) => String(s.pk) === v.staffPk)?.name ?? "";
    let ok: boolean;
    if (kind === "driver") {
      const input = { licenceNo: v.docNo, licenceValidTill: v.docValid, shift: v.shift, status: v.status, vehicleReg: v.plate, experience: exp };
      ok = form.mode === "add"
        ? await dispatch({ type: "driver/add", staffPk: Number(v.staffPk), input })
        : await dispatch({ type: "driver/update", id: form.id, patch: input });
    } else {
      const input = { certificateNo: v.docNo, firstAidValidTill: v.docValid, shift: v.shift, status: v.status, busReg: v.plate, experience: exp };
      ok = form.mode === "add"
        ? await dispatch({ type: "attendant/add", staffPk: Number(v.staffPk), input })
        : await dispatch({ type: "attendant/update", id: form.id, patch: input });
    }
    if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
    toast(form.mode === "add" ? `${name} ${c.addedAs}` : `${name} updated`);
    groups.openOnly(v.shift);
    setForm(null);
  };

  // The dialog stays open (showing progress) until the save finishes; a failure keeps it open to retry.
  const runConfirm = async () => {
    if (!confirm) return;
    const cf = confirm;
    const r = cf.kind === "deactivate" ? byId(cf.id) : null;
    const n = selection.count;
    const ok = cf.kind === "deactivate"
      ? await dispatch(kind === "driver"
        ? { type: "driver/deactivate", id: cf.id }
        : { type: "attendant/update", id: cf.id, patch: { status: "Inactive", busReg: "Unassigned" } })
      : await dispatch(kind === "driver" ? { type: "driver/archive", ids: selection.ids } : { type: "attendant/archive", ids: selection.ids });
    if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
    setConfirm(null);
    setDrawerId(null);
    if (cf.kind === "deactivate") toast(`${r?.name ?? "Staff member"} deactivated`);
    else { selection.clear(); toast(`${plural(n, c.noun)} archived`); }
  };

  const confirmText = (() => {
    if (!confirm) return null;
    if (confirm.kind === "bulkArchive") {
      return { title: `Archive ${plural(selection.count, c.noun)}?`, message: `Their transport profiles are removed from the duty roster and vehicle assignments. Their HR staff records are kept.`, label: "Archive all" };
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
    <TransportPage compact>
      <PageHero compact eyebrow={c.hero.eyebrow} title={c.hero.title} accent={c.hero.accent} sub={c.hero.sub}
        actions={<>
          <HeroSecondary onClick={exportVisible}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setForm({ mode: "add", shift: "Full day" })}>{c.add}</HeroPrimary>
        </>} />

      <KpiGrid>
        {kind === "driver" ? (
          <>
            <KpiCard loading={loading} compact label="Drivers" value={activeRows.length} sub={`${activeRows.length} on the transport payroll`} />
            <KpiCard loading={loading} compact label="On duty today" value={online.length} sub={`${onRoute} currently on route`} color={T.green} />
            <KpiCard loading={loading} compact label={c.docKpi} value={docAlerts} sub={`Within ${docWindow} days or expired`} color={T.amber} />
            <KpiCard loading={loading} compact label="Avg rating" value={avgRating === null ? "—" : avgRating.toFixed(1)}
              sub={rated.length ? `From ${plural(rated.length, "rated driver profile")}` : "No ratings recorded yet"} color={T.pu} />
          </>
        ) : (
          <>
            <KpiCard loading={loading} compact label="Attendants" value={activeRows.length} sub="With a transport profile" />
            <KpiCard loading={loading} compact label="On duty today" value={online.length} sub={`${onRoute} currently on route`} color={T.green} />
            <KpiCard loading={loading} compact label={c.docKpi} value={docAlerts} sub={`Within ${docWindow} days or expired`} color={T.amber} />
            <KpiCard loading={loading} compact label="Routes covered" value={`${routesCovered} / ${state.routes.length}`} sub="Routes with an attendant onboard" color={T.pu} />
          </>
        )}
      </KpiGrid>

      <SmartFilter compact chips={chips} groupingChip="Grouped by shift" onReset={resetFilters} fields={[
        { key: "shift", label: "Shift", value: fShift, onChange: setFShift,
          options: [{ value: ALL, label: "All shifts" }, ...SHIFTS.map((s) => ({ value: s, label: SHIFT_LABELS[s] }))] },
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus,
          options: [{ value: ALL, label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: s }))] },
        { key: "doc", label: c.docFilter, value: fDoc, onChange: setFDoc,
          options: [{ value: ALL, label: c.docAny }, { value: "expiring", label: DOC_LABEL.expiring }, { value: "expired", label: "Expired" }] },
        { key: "exp", label: "Experience", value: fExp, onChange: setFExp,
          options: [{ value: ALL, label: "Any experience" }, { value: "lt5", label: "Under 5 years" }, { value: "5to10", label: "5–10 years" }, { value: "gt10", label: "Over 10 years" }] },
      ]} />

      <SearchRow compact value={query} onChange={setQuery} onSubmit={runSearch} placeholder={c.search}
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportVisible} />

      <GroupedList compact title={`All ${c.noun}s`} helper={c.listHelper}
        onCollapseAll={groups.collapseAll} onExpandAll={() => groups.expandAll([...SHIFTS])}
        footer={visible.length > 0 && (
          <ListFooter summary={`Showing ${visible.length} of ${rows.length} ${c.noun}s`} counts={`across ${groupsWithRows} ${groupsWithRows === 1 ? "group" : "groups"}`}
            onCollapseAll={groups.collapseAll} onExportView={() => { exportRows(visible); toast("Current view exported"); }} />
        )}>
        {visible.length === 0 && filtersActive ? (
          <EmptyLine compact>No {c.noun}s match these filters. Try clearing the search or resetting filters.</EmptyLine>
        ) : groupsShown.map((shift) => {
          const list = visible.filter((r) => r.shift === shift);
          const on = list.filter((r) => r.online).length;
          return (
            <GroupCard compact key={shift} name={SHIFT_LABELS[shift]} open={groups.isOpen(shift)} onToggle={() => groups.toggle(shift)}
              pct={list.length ? (on / list.length) * 100 : 0}
              chips={<>
                <Chip tone="slate">{plural(list.length, c.noun)}</Chip>
                <Chip tone="green">{on} on duty</Chip>
                <Chip tone="purple">{list.filter((r) => r.status === "On leave").length} on leave</Chip>
                <Chip tone="blue">{list.filter((r) => daysLeft(r.docValid) <= docWindow).length} {c.docAlert}</Chip>
              </>}
              extra={<OutlineButton onClick={() => setForm({ mode: "add", shift })}>+ Add</OutlineButton>}>
              {list.length === 0 ? <EmptyLine compact>No {c.noun}s in this group yet.</EmptyLine> : (
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
        { label: c.assignTitle, onClick: () => {
          // A vehicle has one driver, so assigning several drivers to it would keep only the last one.
          if (kind === "driver" && selection.count > 1) { toast("A vehicle has one driver - select a single driver to assign", "error"); return; }
          setAssignOpen(true);
        } },
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
                ? (drawerRow.rating ? <Badge tone="purple">★ {drawerRow.rating.toFixed(1)} rating</Badge> : null)
                : !drawerRow.docValid ? <Badge tone="grey">First-aid not recorded</Badge>
                  : daysLeft(drawerRow.docValid) < 0 ? <Badge tone="red">First-aid expired</Badge> : <Badge tone="green">First-aid certified</Badge>}
            </>} />
          <DrawerHighlight items={kind === "driver"
            ? [{ label: "Experience", value: plural(drawerRow.experience, "year") }, { label: "Rating", value: drawerRow.rating ? `${drawerRow.rating.toFixed(1)} / 5` : "—" }]
            : [{ label: "Experience", value: plural(drawerRow.experience, "year") }, { label: "Students on bus", value: String(drawerRow.studentsOnBus ?? 0) }]} />
          <DrawerSection title="Contact (from HR)">
            <InfoRow label="Mobile">{drawerRow.phone || "—"}</InfoRow>
            <InfoRow label="Emergency contact">{drawerRow.emergency || "—"}</InfoRow>
          </DrawerSection>
          {kind === "driver" ? (
            <DrawerSection title="Licence">
              <InfoRow label="Licence no."><span className="tp-mono">{drawerRow.docNo || "—"}</span></InfoRow>
              <InfoRow label="Valid till">{fmtDate(drawerRow.docValid)} <Badge tone={docState(drawerRow.docValid, docWindow).tone}>{docState(drawerRow.docValid, docWindow).tone === "green" ? "Valid" : docState(drawerRow.docValid, docWindow).text}</Badge></InfoRow>
              <InfoRow label="Badge no.">{state.drivers.find((d) => d.id === drawerRow.id)?.badgeNo || "—"}</InfoRow>
            </DrawerSection>
          ) : (
            <DrawerSection title="First-aid certification">
              <InfoRow label="Certificate no."><span className="tp-mono">{drawerRow.docNo || "—"}</span></InfoRow>
              <InfoRow label="Valid till">{fmtDate(drawerRow.docValid)} <Badge tone={docState(drawerRow.docValid, docWindow).tone}>{docState(drawerRow.docValid, docWindow).tone === "green" ? "Valid" : docState(drawerRow.docValid, docWindow).text}</Badge></InfoRow>
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
            {drawerRow.phone && <a className="tp-btn-outline" href={`tel:${drawerRow.phone.replace(/\s/g, "")}`}>Call</a>}
            <Button type="button" variant="red" size="sm" onClick={() => setConfirm({ kind: "deactivate", id: drawerRow.id })}>Deactivate</Button>
          </DrawerActions>
        </Drawer>
      )}

      {form && (
        <StaffForm key={form.mode === "edit" ? form.id : `add-${form.shift}`} kind={kind} plates={plates}
          mode={form.mode} candidates={state.staffPool.filter((s) => s.roles.includes(kind))} editing={form.mode === "edit" ? byId(form.id) : null}
          initial={form.mode === "edit"
            ? (() => { const r = byId(form.id)!; return { staffPk: "", docNo: r.docNo, docValid: r.docValid, shift: r.shift, status: r.status, plate: r.plate, experience: String(r.experience) }; })()
            : { staffPk: "", docNo: "", docValid: "", shift: form.shift, status: "On duty", plate: "Unassigned", experience: "0" }}
          onClose={() => setForm(null)} onSubmit={(values) => { void submitForm(values); }} />
      )}

      {assignOpen && (
        <AssignPlateModal kind={kind} count={selection.count} plates={plates} onClose={() => setAssignOpen(false)}
          onSubmit={async (reg) => {
            const n = selection.count;
            const ok = await dispatch(kind === "driver" ? { type: "driver/assignVehicle", ids: selection.ids, reg } : { type: "attendant/assignBus", ids: selection.ids, reg });
            if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
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
  kind, mode, initial, plates, candidates, editing, onClose, onSubmit,
}: {
  kind: StaffKind; mode: "add" | "edit"; initial: FormValues; plates: string[];
  candidates: { pk: number; name: string; staffNo: string; role: string | null; licence: string }[]; editing: Row | null;
  onClose: () => void; onSubmit: (v: FormValues) => void;
}) {
  // On a slow connection the form can open before the staff list has loaded; don't claim the list is empty yet.
  const loadingStaff = useTransport().status === "loading";
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
    if (mode === "add" && !v.staffPk) next.staffPk = "This field is required.";
    if (!v.docNo.trim()) next.docNo = "This field is required.";
    setErrors(next);
    if (Object.keys(next).length) { toast("Fill in the required fields", "error"); return; }
    onSubmit({ ...v, docNo: v.docNo.trim() });
  };
  return (
    <Modal open onClose={onClose} size="lg" title={mode === "add" ? `Add ${c.noun}` : `Edit ${c.noun}`} subtitle={c.formSub}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <SaveButton onClick={submit}>{mode === "add" ? `Add ${c.noun}` : "Save changes"}</SaveButton>
      </>}>
      <div className="tp-form-grid">
        {mode === "add" ? (
          <Field label="HR staff member" required error={errors.staffPk}
            hint={candidates.length ? "Name and phone come from the HR record"
              : loadingStaff ? "Loading HR staff…"
              : `No eligible staff. Only active HR staff in the "Transport" department with a ${c.noun} designation (or none) can be added - set this up in HR.`}>
            <Select value={v.staffPk} onChange={(e) => {
              const pick = candidates.find((s) => String(s.pk) === e.target.value);
              setV((p) => ({ ...p, staffPk: e.target.value, docNo: kind === "driver" && pick?.licence && !p.docNo ? pick.licence : p.docNo }));
              if (errors.staffPk) setErrors((er) => ({ ...er, staffPk: undefined }));
            }}>
              <option value="">{candidates.length || loadingStaff ? "Choose a staff member" : `No eligible Transport ${c.noun}s`}</option>
              {candidates.map((s) => <option key={s.pk} value={s.pk}>{s.name}{s.staffNo ? ` · ${s.staffNo}` : ""}{s.role ? ` · ${s.role}` : ""}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Staff member" hint="Name and phone are edited in HR">
            <Input value={`${editing?.name ?? ""}${editing?.phone ? ` · ${editing.phone}` : ""}`} disabled readOnly />
          </Field>
        )}
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
        <SaveButton onClick={submit}>Assign</SaveButton>
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

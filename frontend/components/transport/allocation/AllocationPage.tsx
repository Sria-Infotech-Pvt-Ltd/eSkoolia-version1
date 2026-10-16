"use client";
/** Student Allocation — /transport/allocation (Master Prompt §7.7). */
import { useCallback, useMemo, useState } from "react";
import { Eye, Pencil, Users, X } from "lucide-react";
import { classLabel, classLine, sortClasses } from "@/lib/transport/catalog";
import { useTransport, useVehicles } from "@/lib/transport/store";
import { fmtTime, initials, inr, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { AllocationStatus, Student } from "@/lib/transport/types";
import {
  Avatar, Badge, BulkBar, Button, Chip, ConfirmDialog, ContextBar, Drawer, DrawerActions, DrawerHeader, DrawerHighlight,
  DrawerSection, EmptyLine, GroupCard, GroupedList, HeroPrimary, HeroSecondary, IdPill, IdentityCell, InfoRow, KpiCard,
  KpiGrid, ListFooter, OutlineButton, PageHero, RowIconButton, SearchRow, ShowMoreRow, SmartFilter, SoftButton, StatusBadge,
  T, TransportPage, useDeepLink, useGroupOpen, useMountSkeleton, useSelection, useTpToast, type FilterChip,
} from "@/components/transport/ui";
import { MoveStopsModal } from "../routes/RouteModals";
import { BulkAllocateWizard, EditAllocationModal } from "./AllocationModals";

const ALL = "all";
const PAGE = 40;

type ConfirmState = { kind: "remove"; id: string } | { kind: "bulkRemove" };

export function AllocationPage() {
  const { state, dispatch, errorText, saving } = useTransport();
  const vehicles = useVehicles();
  const { routes, students, studentPool } = state;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();
  // Class / section groups come from the school's own class names (Students module).
  const CLASSES = useMemo(() => sortClasses([...new Set(students.map((s) => s.cls))]), [students]);
  const SECTIONS = useMemo(() => sortClasses([...new Set([...students, ...studentPool].map((s) => s.section).filter(Boolean))]), [students, studentPool]);

  const [ctxClass, setCtxClass] = useState(ALL);
  const [ctxSection, setCtxSection] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fRoute, setFRoute] = useState(ALL);
  const [fBus, setFBus] = useState(ALL);
  const [fFare, setFFare] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const groups = useGroupOpen(CLASSES[0] ?? null);
  const selection = useSelection();
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [wizard, setWizard] = useState<{ preselect: string[] } | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const stopOf = useCallback((s: Student) => {
    if (!s.stopId) return null;
    for (const r of routes) { const st = r.stops.find((x) => x.id === s.stopId); if (st) return st; }
    return null;
  }, [routes]);
  const routeName = useCallback((code: string | null) => {
    const r = routes.find((x) => x.code === code);
    return r ? `${r.code} · ${r.name}` : "—";
  }, [routes]);
  const byId = useCallback((id: string | null) => students.find((s) => s.id === id) ?? null, [students]);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return students.filter((s) => {
      if (ctxClass !== ALL && String(s.cls) !== ctxClass) return false;
      if (ctxSection !== ALL && s.section !== ctxSection) return false;
      if (fStatus !== ALL && s.status !== fStatus) return false;
      if (fRoute !== ALL && s.routeCode !== fRoute) return false;
      if (fBus !== ALL && s.busReg !== fBus) return false;
      if (fFare === "upto1800" && !(s.fare > 0 && s.fare <= 1800)) return false;
      if (fFare === "above1800" && !(s.fare > 1800)) return false;
      if (q && ![s.name, s.admission, stopOf(s)?.name ?? ""].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [students, ctxClass, ctxSection, fStatus, fRoute, fBus, fFare, applied, stopOf]);

  const filtersActive = ctxClass !== ALL || ctxSection !== ALL || fStatus !== ALL || fRoute !== ALL || fBus !== ALL || fFare !== ALL || applied !== "";
  const visibleIds = visible.map((s) => s.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));
  const FARE: Record<string, string> = { upto1800: "Up to ₹1,800", above1800: "Above ₹1,800" };
  const chips: FilterChip[] = [
    ...(ctxClass !== ALL ? [{ label: `Class ${ctxClass}`, tone: "purple" as const }] : []),
    ...(ctxSection !== ALL ? [{ label: `Section ${ctxSection}`, tone: "purple" as const }] : []),
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus}`, tone: "purple" as const }] : []),
    ...(fRoute !== ALL ? [{ label: `Route: ${fRoute}`, tone: "purple" as const }] : []),
    ...(fBus !== ALL ? [{ label: `Bus: ${fBus}`, tone: "purple" as const }] : []),
    ...(fFare !== ALL ? [{ label: `Fare: ${FARE[fFare]}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  const allocated = students.filter((s) => s.status === "Allocated");
  const pending = students.filter((s) => s.status === "Pending").length;
  const waitlisted = students.filter((s) => s.status === "Waitlisted").length;
  const fees = allocated.reduce((s, x) => s + x.fare, 0);
  const unallocated = students.filter((s) => s.status !== "Allocated");
  // Bulk Allocate offers pending / waitlisted students plus school students not on transport yet.
  const candidates = useMemo(() => [...unallocated, ...studentPool], [unallocated, studentPool]);

  const csv: CsvColumn<Student>[] = [
    { header: "Student ID", value: (s) => s.id }, { header: "Admission no.", value: (s) => s.admission }, { header: "Name", value: (s) => s.name },
    { header: "Class", value: (s) => `${s.cls}${s.section ? `-${s.section}` : ""}` }, { header: "Roll", value: (s) => s.roll }, { header: "Route", value: (s) => routeName(s.routeCode) },
    { header: "Pickup point", value: (s) => stopOf(s)?.name ?? "—" }, { header: "Bus", value: (s) => s.busReg ?? "—" },
    { header: "Fare / month", value: (s) => s.fare }, { header: "Status", value: (s) => s.status },
  ];
  const exportVisible = () => { downloadCsv("transport-allocation.csv", csv, visible); toast(`Exported ${plural(visible.length, "student")} to CSV`); };

  const openWizard = (cls?: string) => {
    const pool = cls !== undefined ? unallocated.filter((s) => s.cls === cls) : [];
    setWizard({ preselect: (pool.length ? pool : unallocated).map((s) => s.id) });
  };

  useDeepLink(({ id, isNew }) => {
    if (id) {
      const s = students.find((x) => x.id === id || x.admission === id);
      if (s) { setDrawerId(s.id); groups.openOnly(s.cls); }
    }
    if (isNew) setWizard({ preselect: [] });
  });

  const runSearch = () => { const q = query.trim(); setApplied(q); if (q) groups.expandAll(CLASSES); };
  const resetFilters = () => {
    setCtxClass(ALL); setCtxSection(ALL); setFStatus(ALL); setFRoute(ALL); setFBus(ALL); setFFare(ALL); setQuery(""); setApplied("");
  };

  // The dialog stays open (showing progress) until the save finishes; a failure keeps it open to retry.
  const runConfirm = async () => {
    if (!confirm) return;
    const cf = confirm;
    const s = cf.kind === "remove" ? byId(cf.id) : null;
    const n = selection.count;
    const ok = await dispatch({ type: "student/remove", ids: cf.kind === "remove" ? [cf.id] : selection.ids });
    if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
    setConfirm(null);
    setDrawerId(null);
    if (cf.kind === "remove") toast(`${s?.name ?? "Student"} moved to Pending`);
    else { selection.clear(); toast(`${plural(n, "student")} moved to Pending`); }
  };

  const confirmText = (() => {
    if (!confirm) return null;
    if (confirm.kind === "bulkRemove") {
      return { title: `Remove ${plural(selection.count, "student")} from transport?`, message: "Their seats are released and their monthly transport fare is cleared. They stay listed as Pending.", label: "Remove all" };
    }
    const s = byId(confirm.id);
    if (!s) return null;
    return { title: `Remove ${s.name} from transport?`, message: `Their seat on ${s.routeCode ? routeName(s.routeCode) : "their route"} is released and their monthly transport fare is cleared. They stay listed as Pending.`, label: "Remove" };
  })();

  const drawer = byId(drawerId);
  const editStudent = byId(editId);
  const groupsShown = CLASSES.filter((c) => !filtersActive || visible.some((s) => s.cls === c));
  const groupsWithRows = CLASSES.filter((c) => visible.some((s) => s.cls === c)).length;
  const busOptions = [...new Set(routes.map((r) => r.busReg))];

  return (
    <TransportPage>
      <ContextBar icon={Users} note="Current academic year allocations" selects={[
        { label: "Class", value: ctxClass, onChange: (v) => { setCtxClass(v); if (v !== ALL) groups.openOnly(v); },
          options: [{ value: ALL, label: "All classes" }, ...CLASSES.map((c) => ({ value: c, label: classLabel(c) }))] },
        { label: "Section", value: ctxSection, onChange: setCtxSection,
          options: [{ value: ALL, label: "All sections" }, ...SECTIONS.map((s) => ({ value: s, label: `Section ${s}` }))] },
      ]} />

      <PageHero eyebrow="Transport · Students" title="Student" accent="allocation"
        sub="Who rides which bus, from which stop, at what fare. Resolve pending requests and the waitlist before the term fee run."
        actions={<>
          <HeroSecondary onClick={exportVisible}>Export CSV</HeroSecondary>
          <HeroPrimary icon={false} onClick={() => openWizard()}>Bulk Allocate</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Allocated" value={allocated.length} sub="Students with a seat this term" color={T.green} />
        <KpiCard loading={loading} label="Pending" value={pending} sub="Awaiting a pickup point" color={T.amber} />
        <KpiCard loading={loading} label="Waitlisted" value={waitlisted} sub="Routes at full capacity" />
        <KpiCard loading={loading} label="Monthly fees" value={inr(fees)} sub="Sum of allocated monthly fares" color={T.pu} />
      </KpiGrid>

      <SmartFilter chips={chips} groupingChip="Grouped by class" onReset={resetFilters} fields={[
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus,
          options: [{ value: ALL, label: "All statuses" }, ...(["Allocated", "Pending", "Waitlisted"] as AllocationStatus[]).map((s) => ({ value: s, label: s }))] },
        { key: "route", label: "Route", value: fRoute, onChange: setFRoute,
          options: [{ value: ALL, label: "All routes" }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))] },
        { key: "bus", label: "Bus", value: fBus, onChange: setFBus,
          options: [{ value: ALL, label: "All buses" }, ...busOptions.map((b) => ({ value: b, label: b }))] },
        { key: "fare", label: "Fare", value: fFare, onChange: setFFare,
          options: [{ value: ALL, label: "Any fare" }, { value: "upto1800", label: "Up to ₹1,800" }, { value: "above1800", label: "Above ₹1,800" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={runSearch} placeholder="Search by student, admission no. or stop…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportVisible} />

      <GroupedList title="All students on transport" helper="Grouped by class · donut shows the share of each class that is allocated"
        actions={<SoftButton onClick={() => openWizard()}>Bulk Allocate</SoftButton>}
        onCollapseAll={groups.collapseAll} onExpandAll={() => groups.expandAll(CLASSES)}
        footer={visible.length > 0 && (
          <ListFooter summary={`Showing ${visible.length} of ${students.length} students`} counts={`across ${plural(groupsWithRows, "class", "classes")}`}
            onCollapseAll={groups.collapseAll} onExportView={() => { downloadCsv("transport-allocation-view.csv", csv, visible); toast("Current view exported"); }} />
        )}>
        {visible.length === 0 && filtersActive ? (
          <EmptyLine>No students match these filters. Try clearing the search or resetting filters.</EmptyLine>
        ) : groupsShown.map((cls) => {
          const key = cls;
          const rows = visible.filter((s) => s.cls === cls);
          const alloc = rows.filter((s) => s.status === "Allocated").length;
          const limit = limits[key] ?? PAGE;
          return (
            <GroupCard key={key} name={classLabel(cls)} open={groups.isOpen(key)} onToggle={() => groups.toggle(key)}
              pct={rows.length ? (alloc / rows.length) * 100 : 0}
              chips={<>
                <Chip tone="slate">{plural(rows.length, "student")}</Chip>
                <Chip tone="green">{alloc} allocated</Chip>
                <Chip tone="purple">{rows.filter((s) => s.status === "Pending").length} pending</Chip>
                <Chip tone="blue">{rows.filter((s) => s.status === "Waitlisted").length} waitlisted</Chip>
              </>}
              extra={<OutlineButton onClick={() => openWizard(cls)}>+ Allocate</OutlineButton>}>
              {rows.length === 0 ? <EmptyLine>No students in this class yet.</EmptyLine> : (
                <div className="tp-scroll-x">
                  <table className="tp-table" style={{ minWidth: 1100 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                        <th>Student</th><th>Admission no.</th><th>Route</th><th>Pickup point</th><th>Bus</th><th>Fare / month</th><th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, limit).map((s) => {
                        const sel = selection.isSelected(s.id);
                        return (
                          <tr key={s.id} className={sel ? "is-selected" : undefined}>
                            <td style={{ width: 42 }}><input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(s.id)} aria-label={`Select ${s.name}`} /></td>
                            <td><IdentityCell lead={<Avatar name={s.name} initials={initials(s.name)} />} title={s.name} sub={classLine(s)} /></td>
                            <td><IdPill mono>{s.admission}</IdPill></td>
                            <td>{routeName(s.routeCode)}</td>
                            <td>{stopOf(s)?.name ?? "—"}</td>
                            <td className="tp-mono" style={{ fontSize: 12 }}>{s.busReg ?? "—"}</td>
                            <td style={{ fontWeight: 700 }}>{s.fare ? inr(s.fare) : "—"}</td>
                            <td><StatusBadge status={s.status} /></td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <RowIconButton label={`View ${s.name}`} onClick={() => setDrawerId(s.id)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label="Edit allocation" onClick={() => setEditId(s.id)}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label="Remove from transport" onClick={() => setConfirm({ kind: "remove", id: s.id })}><X size={15} strokeWidth={2} /></RowIconButton>
                            </td>
                          </tr>
                        );
                      })}
                      <ShowMoreRow colSpan={9} remaining={rows.length - limit} step={PAGE} noun="students"
                        onMore={() => setLimits((l) => ({ ...l, [key]: limit + PAGE }))} />
                    </tbody>
                  </table>
                </div>
              )}
            </GroupCard>
          );
        })}
      </GroupedList>

      <BulkBar count={selection.count} onClear={selection.clear} actions={[
        { label: "Assign route", onClick: () => setAssignOpen(true) },
        { label: "Export", onClick: () => {
          const list = students.filter((s) => selection.isSelected(s.id));
          downloadCsv("transport-allocation-selected.csv", csv, list); toast(`Exported ${plural(list.length, "student")}`); selection.clear();
        } },
        { label: "Archive", onClick: () => setConfirm({ kind: "bulkRemove" }) },
      ]} />

      {drawer && (() => {
        const st = stopOf(drawer);
        return (
          <Drawer open onClose={() => setDrawerId(null)} label={`Student ${drawer.name}`}>
            <DrawerHeader avatar={initials(drawer.name)} title={drawer.name} sub={classLine(drawer)} idLabel={drawer.admission}
              badges={<><StatusBadge status={drawer.status} /><Badge tone="purple">{drawer.routeCode ?? "No route"}</Badge></>} />
            <DrawerHighlight items={[{ label: "Monthly fare", value: drawer.fare ? inr(drawer.fare) : "—" }, { label: "Boarded (30d)", value: drawer.attendance30d === null ? "—" : `${drawer.attendance30d}%` }]} />
            <DrawerSection title="Allocation">
              <InfoRow label="Route">{routeName(drawer.routeCode)}</InfoRow>
              <InfoRow label="Pickup point">{st?.name ?? "—"}</InfoRow>
              <InfoRow label="Bus"><span className="tp-mono">{drawer.busReg ?? "—"}</span></InfoRow>
              <InfoRow label="Pickup time">{st ? fmtTime(st.pickupTime) : "—"}</InfoRow>
            </DrawerSection>
            <DrawerSection title="Parent / guardian">
              <InfoRow label="Name">{drawer.parentName}</InfoRow>
              <InfoRow label="Mobile">{drawer.mobile}</InfoRow>
            </DrawerSection>
            <DrawerActions>
              <Button type="button" variant="soft" size="sm" onClick={() => setEditId(drawer.id)}>Edit allocation</Button>
              {drawer.mobile && drawer.mobile !== "—" && (
                <a className="tp-btn-outline" href={`tel:${drawer.mobile.replace(/\s/g, "")}`}>Call parent</a>
              )}
              <Button type="button" variant="red" size="sm" onClick={() => setConfirm({ kind: "remove", id: drawer.id })}>Remove from transport</Button>
            </DrawerActions>
          </Drawer>
        );
      })()}

      {editStudent && (
        <EditAllocationModal key={editStudent.id} student={editStudent} routes={routes} onClose={() => setEditId(null)}
          onSubmit={async (routeCode, stopId, status) => {
            if (!(await dispatch({ type: "student/update", id: editStudent.id, routeCode, stopId, status }))) { toast(`Not saved: ${errorText()}`, "error"); return; }
            setEditId(null);
            groups.openOnly(editStudent.cls);
            toast("Allocation updated");
          }} />
      )}

      {wizard && (
        <BulkAllocateWizard candidates={candidates} preselect={wizard.preselect} routes={routes} vehicles={vehicles}
          onClose={() => setWizard(null)}
          onAllocate={async (ids, routeCode, stopId) => {
            const r = routes.find((x) => x.code === routeCode);
            const st = r?.stops.find((x) => x.id === stopId);
            if (!(await dispatch({ type: "student/allocate", ids, routeCode, stopId }))) { toast(`Not saved: ${errorText()}`, "error"); return; }
            setWizard(null);
            toast(`${plural(ids.length, "student")} allocated to ${routeCode} · ${st?.name ?? ""}`);
          }} />
      )}

      {assignOpen && (
        <MoveStopsModal title="Assign route" subtitle="Students get the first stop on the route; refine per student afterwards" fieldLabel="Route"
          cta="Assign route" routes={routes} onClose={() => setAssignOpen(false)}
          onSubmit={async (code) => {
            const r = routes.find((x) => x.code === code);
            const first = r?.stops[0];
            // Students need a pickup point: a route without stops can't take them.
            if (!r || !first) { toast(`${r ? `${r.code} · ${r.name}` : code} has no pickup points yet - add stops first`, "error"); return; }
            const n = selection.count;
            const ids = selection.ids;
            selection.clear(); setAssignOpen(false);
            if (await dispatch({ type: "student/allocate", ids, routeCode: code, stopId: first.id })) toast(`${plural(n, "student")} assigned to ${r.code} · ${r.name}`);
          }} />
      )}

      <ConfirmDialog open={!!confirmText} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="danger"
        title={confirmText?.title ?? ""} message={confirmText?.message ?? ""} confirmLabel={confirmText?.label ?? ""} />
    </TransportPage>
  );
}

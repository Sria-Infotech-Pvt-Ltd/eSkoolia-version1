"use client";
/**
 * Transport Attendance — /transport/attendance (Master Prompt §7.8). One
 * register per (shift, date): untouched lines are generated deterministically,
 * edits are stored in the shared store so switching back keeps them. The
 * register is built from the students currently allocated in the store.
 */
import { useCallback, useMemo, useState } from "react";
import { ClipboardCheck, Clock, Eye, FileText } from "lucide-react";
import { useTransport } from "@/lib/transport/store";
import { REGISTER_DATES, entryFor } from "@/lib/transport/ops3";
import { fmtTime, initials, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { AttendanceEntry, AttendanceShift, RouteStop, Student, TransportRoute } from "@/lib/transport/types";
import {
  AttendanceKpi, Avatar, Badge, BulkBar, Button, Chip, ConfirmDialog, ContextBar, Drawer, DrawerActions, DrawerHeader,
  DrawerHighlight, DrawerSection, EmptyLine, Field, GroupCard, GroupedList, HeroPrimary, HeroSecondary, IdentityCell, InfoRow,
  Input, KpiGrid, ListFooter, Modal, OutlineButton, PageHero, RowIconButton, SearchRow, Select, ShowMoreRow, SmartFilter,
  Switch, T, TransportPage, useDeepLink, useGroupOpen, useMountSkeleton, useSelection, useTpToast, type FilterChip,
} from "@/components/transport/ui";

const ALL = "all";
const PAGE = 25;
const REASONS = ["Parent informed", "Sick", "Picked up early", "Other"];

interface Line { student: Student; route: TransportRoute; stop: RouteStop | null; entry: AttendanceEntry }

function Tag({ color, bg, children, title }: { color: string; bg: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.04em", color, background: bg, borderRadius: 6, padding: "2px 6px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function AttendancePage() {
  const { state, dispatch } = useTransport();
  const { routes, students } = state;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [shift, setShift] = useState<AttendanceShift>("morning");
  const [dateIdx, setDateIdx] = useState(0);
  const [fClass, setFClass] = useState(ALL);
  const [fBoard, setFBoard] = useState(ALL);
  const [fFlag, setFFlag] = useState(ALL);
  const [fStop, setFStop] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const groups = useGroupOpen("R3");
  const selection = useSelection();
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [notifyOpen, setNotifyOpen] = useState(false);

  // Register lines from the students allocated right now.
  const lines: Line[] = useMemo(() => {
    const out: Line[] = [];
    routes.forEach((route) => {
      students.forEach((s) => {
        if (s.status !== "Allocated" || s.routeCode !== route.code) return;
        out.push({ student: s, route, stop: route.stops.find((x) => x.id === s.stopId) ?? null, entry: entryFor(state, s, shift, dateIdx) });
      });
    });
    return out;
  }, [routes, students, state, shift, dateIdx]);

  const byId = useCallback((id: string | null) => lines.find((l) => l.student.id === id) ?? null, [lines]);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return lines.filter(({ student: s, stop, route, entry }) => {
      if (fClass !== ALL && String(s.cls) !== fClass) return false;
      if (fBoard === "boarded" && !entry.boarded) return false;
      if (fBoard === "not" && entry.boarded) return false;
      if (fFlag === "late" && !entry.late) return false;
      if (fFlag === "note" && !entry.note) return false;
      if (fStop !== ALL && stop?.id !== fStop) return false;
      if (q && ![s.name, s.admission, stop?.name ?? "", route.busReg].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [lines, fClass, fBoard, fFlag, fStop, applied]);

  const filtersActive = fClass !== ALL || fBoard !== ALL || fFlag !== ALL || fStop !== ALL || applied !== "";
  const visibleIds = visible.map((l) => l.student.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));
  const allStops = routes.flatMap((r) => r.stops.map((s) => ({ s, r })));
  const BOARD: Record<string, string> = { boarded: "Boarded", not: "Not boarded" };
  const FLAG: Record<string, string> = { late: "Late", note: "Has note" };
  const chips: FilterChip[] = [
    ...(fClass !== ALL ? [{ label: `Class ${fClass}`, tone: "purple" as const }] : []),
    ...(fBoard !== ALL ? [{ label: `Status: ${BOARD[fBoard]}`, tone: "purple" as const }] : []),
    ...(fFlag !== ALL ? [{ label: `Flag: ${FLAG[fFlag]}`, tone: "purple" as const }] : []),
    ...(fStop !== ALL ? [{ label: `Stop: ${allStops.find((x) => x.s.id === fStop)?.s.name ?? ""}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  // KPIs over the whole register for this shift/date.
  const boarded = lines.filter((l) => l.entry.boarded).length;
  const noShow = lines.length - boarded;
  const late = lines.filter((l) => l.entry.boarded && l.entry.late).length;
  const dropped = shift === "afternoon" ? boarded : 0;

  const isToday = dateIdx === 0;
  const dateLabel = REGISTER_DATES[dateIdx].date;
  const shiftLabel = shift === "morning" ? "Morning pickup" : "Afternoon drop";
  const note = !isToday ? "Read-only history — edits are logged" : shift === "morning" ? "Live · buses still arriving, register auto-fills from RFID scans" : "Afternoon drop starts 3:20 PM";

  const write = (ids: string[], patch: (e: AttendanceEntry) => AttendanceEntry, change: string) => {
    const entries: Record<string, AttendanceEntry> = {};
    ids.forEach((id) => { const l = byId(id); if (l) entries[id] = patch(l.entry); });
    dispatch({ type: "attendance/set", shift, dateIdx, entries, change });
  };

  const scheduled = (l: Line) => (l.stop ? fmtTime(shift === "morning" ? l.stop.pickupTime : l.stop.dropTime) : "—");
  const scan = (l: Line) => (!l.entry.boarded ? { text: "—", color: T.ink3 } : l.entry.late ? { text: `+${4 + (l.student.roll % 9)} min`, color: "#B4721B" } : { text: "On time", color: T.ok });

  const csv: CsvColumn<Line>[] = [
    { header: "Bus", value: (l) => l.route.busReg }, { header: "Route", value: (l) => `${l.route.code} · ${l.route.name}` },
    { header: "Admission no.", value: (l) => l.student.admission }, { header: "Student", value: (l) => l.student.name },
    { header: "Class", value: (l) => `${l.student.cls}-${l.student.section}` }, { header: "Pickup point", value: (l) => l.stop?.name ?? "—" },
    { header: "Scheduled", value: scheduled }, { header: "Scanned at", value: (l) => scan(l).text },
    { header: shift === "morning" ? "Boarded" : "Dropped", value: (l) => (l.entry.boarded ? "Yes" : "No") },
    { header: "Late", value: (l) => (l.entry.late ? "Yes" : "No") }, { header: "Note", value: (l) => l.entry.note ?? "" },
  ];
  const exportRegister = () => { downloadCsv(`boarding-register-${shift}-${dateIdx}.csv`, csv, visible); toast("Boarding register exported"); };

  const changeContext = (nextShift: AttendanceShift, nextDate: number) => {
    setShift(nextShift); setDateIdx(nextDate); selection.clear(); setLimits({});
  };

  useDeepLink(({ id }) => {
    if (!id) return;
    const l = lines.find((x) => x.student.id === id || x.student.admission === id);
    if (l) { setDrawerId(l.student.id); groups.openOnly(l.route.code); }
  });

  const runSearch = () => { const q = query.trim(); setApplied(q); if (q) groups.expandAll(routes.map((r) => r.code)); };
  const resetFilters = () => { setFClass(ALL); setFBoard(ALL); setFFlag(ALL); setFStop(ALL); setQuery(""); setApplied(""); };

  const toggleBoarded = (l: Line) => {
    const next = !l.entry.boarded;
    write([l.student.id], (e) => ({ ...e, boarded: next, late: next ? e.late : false }), next ? "marked boarded" : "marked not boarded");
    toast(next ? `${l.student.name} marked boarded` : `${l.student.name} marked not boarded`);
  };
  const toggleLate = (l: Line) => {
    const next = !l.entry.late;
    write([l.student.id], (e) => ({ ...e, late: next, boarded: true }), next ? "flagged late" : "late flag cleared");
    toast(next ? `${l.student.name} flagged late` : "Late flag cleared");
  };

  const notBoardedNow = lines.filter((l) => !l.entry.boarded).length;
  const drawer = byId(drawerId);
  const noteLine = byId(noteId);
  const groupsShown = routes.filter((r) => (filtersActive ? visible.some((l) => l.route.code === r.code) : true));

  return (
    <TransportPage>
      <ContextBar icon={ClipboardCheck} note={note} selects={[
        { label: "Shift", value: shift, onChange: (v) => changeContext(v as AttendanceShift, dateIdx),
          options: [{ value: "morning", label: "Morning pickup" }, { value: "afternoon", label: "Afternoon drop" }] },
        { label: "Date", value: String(dateIdx), onChange: (v) => changeContext(shift, Number(v)),
          options: REGISTER_DATES.map((d) => ({ value: String(d.idx), label: d.label })) },
      ]} />

      <PageHero eyebrow="Transport · Daily" title="Transport" accent="attendance"
        sub="The boarding register for every bus. RFID scans fill it automatically; attendants correct it here and parents of absent children can be notified in one step."
        actions={<>
          <HeroSecondary onClick={exportRegister}>Export CSV</HeroSecondary>
          <HeroPrimary icon={false} onClick={() => setNotifyOpen(true)}>Notify absent parents</HeroPrimary>
        </>} />

      <KpiGrid>
        <AttendanceKpi loading={loading} code="BD" label="Boarded" value={boarded} trend="+3 vs yesterday" trendColor="#16A34A" />
        <AttendanceKpi loading={loading} code="NS" label="No-show" value={noShow}
          trend={noShow > 20 ? "+4 vs yesterday" : "−2 vs yesterday"} trendColor={noShow > 20 ? "#E11D48" : "#16A34A"} />
        <AttendanceKpi loading={loading} code="LT" label="Late" value={late} trend="Avg +6 min" trendColor="#D97706" />
        <AttendanceKpi loading={loading} code="DR" label="Dropped" value={dropped} trend={shift === "afternoon" ? "Afternoon drop" : "Starts 3:20 PM"} trendColor="#2563EB" />
      </KpiGrid>

      <SmartFilter chips={chips} groupingChip="Grouped by bus" onReset={resetFilters} fields={[
        { key: "class", label: "Class", value: fClass, onChange: setFClass,
          options: [{ value: ALL, label: "All classes" }, ...Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: `Class ${i + 1}` }))] },
        { key: "board", label: "Boarding status", value: fBoard, onChange: setFBoard,
          options: [{ value: ALL, label: "All" }, { value: "boarded", label: "Boarded" }, { value: "not", label: "Not boarded" }] },
        { key: "flag", label: "Flag", value: fFlag, onChange: setFFlag,
          options: [{ value: ALL, label: "Any flag" }, { value: "late", label: "Late" }, { value: "note", label: "Has note" }] },
        { key: "stop", label: "Pickup point", value: fStop, onChange: setFStop,
          options: [{ value: ALL, label: "All stops" }, ...allStops.map(({ s, r }) => ({ value: s.id, label: `${s.name} (${r.code})` }))] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={runSearch} placeholder="Search by student, admission no., stop or bus…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportRegister} />

      <GroupedList title={`Boarding register · ${shiftLabel} · ${dateLabel}`}
        helper="One accordion per bus · flip the switch as each child boards · donut shows boarded share"
        onCollapseAll={groups.collapseAll} onExpandAll={() => groups.expandAll(routes.map((r) => r.code))}
        footer={visible.length > 0 && (
          <ListFooter summary={`Showing ${visible.length} of ${lines.length} students`} counts={`across ${plural(groupsShown.length, "bus", "buses")}`}
            onCollapseAll={groups.collapseAll} onExportView={() => { downloadCsv("boarding-register-view.csv", csv, visible); toast("Current view exported"); }} />
        )}>
        {visible.length === 0 && filtersActive ? (
          <EmptyLine>No students match these filters. Try clearing the search or resetting filters.</EmptyLine>
        ) : groupsShown.map((route) => {
          const rows = visible.filter((l) => l.route.code === route.code);
          const on = rows.filter((l) => l.entry.boarded).length;
          const off = rows.length - on;
          const limit = limits[route.code] ?? PAGE;
          return (
            <GroupCard key={route.code} name={`${route.busReg} · ${route.code} · ${route.name}`}
              title={<><span className="tp-mono">{route.busReg}</span> · {route.code} · {route.name}</>}
              open={groups.isOpen(route.code)} onToggle={() => groups.toggle(route.code)} pct={rows.length ? (on / rows.length) * 100 : 0}
              chips={<>
                <Chip tone="slate">{plural(rows.length, "student")}</Chip>
                <Chip tone="green">{on} boarded</Chip>
                <Chip tone={off > 0 ? "red" : "grey"}>{off} not boarded</Chip>
                <Chip tone="purple">{rows.filter((l) => l.entry.late).length} late</Chip>
              </>}
              extra={<OutlineButton onClick={() => {
                const all = lines.filter((l) => l.route.code === route.code);
                write(all.map((l) => l.student.id), (e) => ({ ...e, boarded: true }), "marked all boarded");
                toast(`All ${all.length} students on ${route.busReg} marked boarded`);
              }}>Mark all boarded</OutlineButton>}>
              {rows.length === 0 ? <EmptyLine>No students on this bus yet.</EmptyLine> : (
                <div className="tp-scroll-x">
                  <table className="tp-table" style={{ minWidth: 1100 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                        <th>Student</th><th>Pickup point</th><th>Scheduled</th><th>Scanned at</th><th>Boarded</th><th>Flags</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, limit).map((l) => {
                        const s = l.student;
                        const sel = selection.isSelected(s.id);
                        const sc = scan(l);
                        const cls = [!l.entry.boarded ? "is-absent" : "", sel ? "is-selected" : ""].filter(Boolean).join(" ");
                        return (
                          <tr key={s.id} className={cls || undefined}>
                            <td style={{ width: 42 }}><input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(s.id)} aria-label={`Select ${s.name}`} /></td>
                            <td><IdentityCell lead={<Avatar name={s.name} initials={initials(s.name)} />} title={s.name} sub={`Class ${s.cls}-${s.section} · ${s.admission}`} /></td>
                            <td>{l.stop?.name ?? "—"}</td>
                            <td className="tp-mono" style={{ fontSize: 12.5 }}>{scheduled(l)}</td>
                            <td className="tp-mono" style={{ fontSize: 12.5, color: sc.color }}>{sc.text}</td>
                            <td><Switch checked={l.entry.boarded} onChange={() => toggleBoarded(l)} label={`Boarded: ${s.name}`} /></td>
                            <td>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {l.entry.late && <Tag color="#B4721B" bg="#FDF1DC">LATE</Tag>}
                                {l.entry.note && <Tag color={T.pu} bg={T.puSoft} title={l.entry.note}>NOTE</Tag>}
                                {!l.entry.boarded && <Tag color="#C2264E" bg="#FFF1F2">NO-SHOW</Tag>}
                              </div>
                            </td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <RowIconButton label={`View ${s.name}`} onClick={() => setDrawerId(s.id)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label="Toggle late" onClick={() => toggleLate(l)}><Clock size={14} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label="Add note" onClick={() => setNoteId(s.id)}><FileText size={14} strokeWidth={1.8} /></RowIconButton>
                            </td>
                          </tr>
                        );
                      })}
                      <ShowMoreRow colSpan={8} remaining={rows.length - limit} step={PAGE} noun="students"
                        onMore={() => setLimits((m) => ({ ...m, [route.code]: limit + PAGE }))} />
                    </tbody>
                  </table>
                </div>
              )}
            </GroupCard>
          );
        })}
      </GroupedList>

      <BulkBar count={selection.count} onClear={selection.clear} actions={[
        { label: "Mark boarded", onClick: () => { const n = selection.count; write(selection.ids, (e) => ({ ...e, boarded: true }), "bulk marked boarded"); selection.clear(); toast(`${plural(n, "student")} marked boarded`); } },
        { label: "Mark absent", onClick: () => { const n = selection.count; write(selection.ids, (e) => ({ ...e, boarded: false, late: false }), "bulk marked absent"); selection.clear(); toast(`${plural(n, "student")} marked absent`); } },
        { label: "Notify parents", onClick: () => { toast(`Parents of ${plural(selection.count, "student")} notified`, "info"); selection.clear(); } },
        { label: "Export", onClick: () => {
          const list = lines.filter((l) => selection.isSelected(l.student.id));
          downloadCsv("boarding-register-selected.csv", csv, list); toast(`Exported ${plural(list.length, "student")}`); selection.clear();
        } },
      ]} />

      {drawer && (() => {
        const s = drawer.student;
        const sc = scan(drawer);
        return (
          <Drawer open onClose={() => setDrawerId(null)} label={`Attendance for ${s.name}`}>
            <DrawerHeader avatar={initials(s.name)} title={s.name} sub={`Class ${s.cls}-${s.section} · ${drawer.route.busReg}`} idLabel={s.admission}
              badges={<>
                {drawer.entry.boarded ? <Badge tone="green">Boarded</Badge> : <Badge tone="red">Not boarded</Badge>}
                {drawer.entry.late && <Badge tone="amber">Late</Badge>}
              </>} />
            <DrawerHighlight items={[{ label: "This month", value: `${18 + (s.roll % 3)} / 20 days` }, { label: "Late arrivals", value: String(s.roll % 4) }]} />
            <DrawerSection title="Today">
              <InfoRow label="Shift">{shiftLabel}</InfoRow>
              <InfoRow label="Pickup point">{drawer.stop?.name ?? "—"}</InfoRow>
              <InfoRow label="Scheduled"><span className="tp-mono">{scheduled(drawer)}</span></InfoRow>
              <InfoRow label="Scan">{!drawer.entry.boarded ? "No scan" : drawer.entry.late ? `Late (${sc.text})` : "On time"}</InfoRow>
              <InfoRow label="Note">{drawer.entry.note ?? "—"}</InfoRow>
            </DrawerSection>
            <DrawerSection title="Parent">
              <InfoRow label="Name">{s.parentName}</InfoRow>
              <InfoRow label="Mobile">{s.mobile}</InfoRow>
            </DrawerSection>
            <DrawerActions>
              <Button type="button" variant="soft" size="sm" onClick={() => toggleBoarded(drawer)}>{drawer.entry.boarded ? "Mark not boarded" : "Mark boarded"}</Button>
              <Button type="button" variant="soft" size="sm" onClick={() => toast(`Parent of ${s.name} notified`, "info")}>Notify parent</Button>
              <Button type="button" variant="red" size="sm" onClick={() => toggleLate(drawer)}>Flag late</Button>
            </DrawerActions>
          </Drawer>
        );
      })()}

      {noteLine && (
        <NoteModal key={noteLine.student.id} onClose={() => setNoteId(null)}
          onSave={(text, reason) => {
            write([noteLine.student.id], (e) => ({ ...e, note: `${text} (${reason})` }), "note added");
            setNoteId(null);
            toast("Note saved");
          }} />
      )}

      <ConfirmDialog open={notifyOpen} onClose={() => setNotifyOpen(false)} tone="safe"
        title={`Notify ${plural(notBoardedNow, "parent")}?`}
        message={`Parents of children not boarded on the ${shift === "morning" ? "morning pickup" : "afternoon drop"} get an app notification and SMS.`}
        confirmLabel="Send notifications"
        onConfirm={() => { setNotifyOpen(false); setDrawerId(null); toast(`Notifications sent to ${plural(notBoardedNow, "parent")}`, "info"); }} />
    </TransportPage>
  );
}

function NoteModal({ onClose, onSave }: { onClose: () => void; onSave: (text: string, reason: string) => void }) {
  const { toast } = useTpToast();
  const [text, setText] = useState("");
  const [reason, setReason] = useState(REASONS[0]);
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    if (!text.trim()) { setError("This field is required."); toast("Fill in the required fields", "error"); return; }
    onSave(text.trim(), reason);
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Add note" subtitle="Visible to the attendant and the class teacher"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Save note</Button>
      </>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <Field label="Note" required error={error}>
          <Input value={text} onChange={(e) => { setText(e.target.value); setError(undefined); }} placeholder="e.g. Parent will drop directly" />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</Select>
        </Field>
      </div>
    </Modal>
  );
}

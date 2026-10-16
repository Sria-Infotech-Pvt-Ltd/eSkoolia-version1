"use client";
/**
 * Vehicles — /transport/vehicles (Master Prompt §7.2). Reference implementation
 * of the list template: Hero → KPIs → Smart Filter → Search → grouped accordion
 * table → bulk bar / drawer / modals / confirms. Deep links: ?id=VH-001, ?new=1.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bus, Car, Eye, FileText, Pencil } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { useTransport, useVehicles } from "@/lib/transport/store";
import { VEHICLE_STATUSES, VEHICLE_TYPES, capacityOf, routeLabel } from "@/lib/transport/catalog";
import { fmtDate, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { Vehicle, VehicleType } from "@/lib/transport/types";
import {
  BulkBar, CellStack, Chip, ConfirmDialog, EmptyLine, GroupCard, GroupedList, HeroPrimary, HeroSecondary, IconTile,
  IdentityCell, KpiCard, KpiGrid, ListFooter, MoreMenu, OutlineButton, PageHero, Plate, RowIconButton, SearchRow,
  SmartFilter, StatusBadge, T, TransportPage, useGroupOpen, useMountSkeleton, useSelection, useTpToast,
  type FilterChip,
} from "@/components/transport/ui";
import { ComplianceBadge, complianceBucket, isActive, isInService, useVehicleDocWindow } from "./shared";
import { AssignRouteModal, UploadDocModal, VehicleFormModal, type VehicleFormValues } from "./VehicleModals";
import { VehicleDrawer } from "./VehicleDrawer";

type FormState = { mode: "add"; presetType: VehicleType } | { mode: "edit"; id: string };
type ConfirmState = { kind: "breakdown" | "archive"; id: string } | { kind: "bulkArchive" };

const ALL = "all";

export function VehiclesPage() {
  const { state, dispatch, errorText } = useTransport();
  const vehicles = useVehicles();
  const { routes, drivers } = state;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();
  const { me } = usePermissions();
  const docWindow = useVehicleDocWindow();
  const COMPLIANCE_LABEL: Record<string, string> = { expiring: `Expiring ≤ ${docWindow} days`, expired: "Expired" };
  const ownerName = `${me?.first_name ?? ""} ${me?.last_name ?? ""}`.trim() || me?.username || "Transport desk";

  // ─── filters & search ───
  const [fType, setFType] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fRoute, setFRoute] = useState(ALL);
  const [fCompliance, setFCompliance] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const groups = useGroupOpen(VEHICLE_TYPES[0]);
  const selection = useSelection();
  const [menuId, setMenuId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const driverName = useCallback((id: string | null) => drivers.find((d) => d.id === id)?.name ?? "Unassigned", [drivers]);
  const byId = useCallback((id: string | null) => vehicles.find((v) => v.id === id) ?? null, [vehicles]);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return vehicles.filter((v) => {
      if (fType !== ALL && v.type !== fType) return false;
      if (fStatus !== ALL && v.status !== fStatus) return false;
      if (fRoute !== ALL && (fRoute === "unassigned" ? v.routeCode !== null : v.routeCode !== fRoute)) return false;
      if (fCompliance !== ALL && complianceBucket(v, docWindow) !== fCompliance) return false;
      if (q) {
        const hay = [v.reg, v.model, routeLabel(routes, v.routeCode), driverName(v.driverId), v.id].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [vehicles, fType, fStatus, fRoute, fCompliance, applied, routes, driverName, docWindow]);

  const filtersActive = fType !== ALL || fStatus !== ALL || fRoute !== ALL || fCompliance !== ALL || applied !== "";
  const visibleIds = visible.map((v) => v.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));

  const chips: FilterChip[] = [
    ...(fType !== ALL ? [{ label: `Type: ${fType}`, tone: "purple" as const }] : []),
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus}`, tone: "purple" as const }] : []),
    ...(fRoute !== ALL ? [{ label: `Route: ${fRoute === "unassigned" ? "Unassigned" : fRoute}`, tone: "purple" as const }] : []),
    ...(fCompliance !== ALL ? [{ label: COMPLIANCE_LABEL[fCompliance], tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  // ─── KPIs ───
  const active = vehicles.filter(isActive);
  const onRoute = vehicles.filter((v) => v.status === "On route").length;
  const breakdowns = vehicles.filter((v) => v.status === "Breakdown").length;
  const maint = vehicles.filter((v) => v.status === "Under maintenance").length;
  const seatsFree = active.reduce((s, v) => s + (capacityOf(v) - v.occupied), 0);
  const typeCount = new Set(vehicles.map((v) => v.type)).size;

  // ─── CSV ───
  const csvColumns: CsvColumn<Vehicle>[] = [
    { header: "ID", value: (v) => v.id },
    { header: "Registration", value: (v) => v.reg },
    { header: "Model", value: (v) => v.model },
    { header: "Type", value: (v) => v.type },
    { header: "Capacity", value: (v) => capacityOf(v) },
    { header: "Occupied", value: (v) => v.occupied },
    { header: "Route", value: (v) => routeLabel(routes, v.routeCode) },
    { header: "Driver", value: (v) => driverName(v.driverId) },
    { header: "Fitness expiry", value: (v) => fmtDate(v.fitness) },
    { header: "Insurance expiry", value: (v) => fmtDate(v.insurance) },
    { header: "Status", value: (v) => v.status },
  ];
  const exportRows = (rows: Vehicle[]) => downloadCsv("transport-vehicles.csv", csvColumns, rows);
  const exportVisible = () => { exportRows(visible); toast(`Exported ${plural(visible.length, "vehicle")} to CSV`); };

  // ─── deep links (?id=VH-001 opens the drawer, ?new=1 opens Add) ───
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    const id = params.get("id");
    const isNew = params.get("new") === "1";
    if (!id && !isNew) return;
    if (id) {
      const v = vehicles.find((x) => x.id === id);
      if (v) { setDrawerId(v.id); groups.openOnly(v.type); }
    }
    if (isNew) setForm({ mode: "add", presetType: VEHICLE_TYPES[0] });
    router.replace(pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  // ─── actions ───
  const runSearch = () => {
    const q = query.trim();
    setApplied(q);
    if (q) groups.expandAll([...VEHICLE_TYPES]);
  };
  const resetFilters = () => {
    setFType(ALL); setFStatus(ALL); setFRoute(ALL); setFCompliance(ALL); setQuery(""); setApplied("");
  };

  const formInitial = (f: FormState): VehicleFormValues => {
    if (f.mode === "edit") {
      const v = byId(f.id)!;
      return { reg: v.reg, model: v.model, type: v.type, status: v.status, routeCode: v.routeCode ?? "", driverId: v.driverId ?? "", fitness: v.fitness, insurance: v.insurance };
    }
    return { reg: "", model: "", type: f.presetType, status: "Active", routeCode: "", driverId: "", fitness: "", insurance: "" };
  };

  const submitForm = async (values: VehicleFormValues) => {
    if (!form) return;
    const payload = {
      reg: values.reg, model: values.model, type: values.type, status: values.status,
      routeCode: values.routeCode || null, driverId: values.driverId || null, fitness: values.fitness, insurance: values.insurance,
    };
    const ok = form.mode === "add"
      ? await dispatch({ type: "vehicle/add", vehicle: payload })
      : await dispatch({ type: "vehicle/update", id: form.id, patch: payload });
    if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
    toast(form.mode === "add" ? `${values.reg} added to the fleet` : `${values.reg} updated`);
    groups.openOnly(values.type);
    setForm(null);
  };

  // The dialog stays open (showing progress) until the save finishes; a failure keeps it open to retry.
  const runConfirm = async () => {
    if (!confirm) return;
    const c = confirm;
    const v = c.kind === "bulkArchive" ? null : byId(c.id);
    const n = selection.count;
    const ok = c.kind === "breakdown"
      ? await dispatch({ type: "vehicle/breakdown", id: c.id })
      : await dispatch({ type: "vehicle/archive", ids: c.kind === "archive" ? [c.id] : selection.ids });
    if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
    setConfirm(null);
    setDrawerId(null);
    if (c.kind !== "breakdown") selection.clear();
    toast(c.kind === "breakdown" ? `${v?.reg ?? "Vehicle"} marked as breakdown`
      : c.kind === "archive" ? `${v?.reg ?? "Vehicle"} archived` : `${plural(n, "vehicle")} archived`);
  };

  const confirmProps = (() => {
    if (!confirm) return null;
    if (confirm.kind === "bulkArchive") {
      return { title: `Archive ${plural(selection.count, "vehicle")}?`, message: "They will be removed from routes, live tracking and reports.", label: "Archive all" };
    }
    const v = byId(confirm.id);
    if (!v) return null;
    if (confirm.kind === "breakdown") {
      return {
        title: `Mark ${v.reg} as breakdown?`,
        message: `The vehicle is pulled from its route and the transport in-charge is alerted. Students on ${routeLabel(routes, v.routeCode)} will need a substitute bus.`,
        label: "Mark breakdown",
      };
    }
    return { title: `Archive ${v.reg}?`, message: "Archived vehicles are hidden from routes and reports. You can restore them from Settings.", label: "Archive" };
  })();

  const uploadVehicle = byId(uploadId);
  const drawerVehicle = byId(drawerId);
  const groupsShown = VEHICLE_TYPES.filter((t) => !filtersActive || visible.some((v) => v.type === t));
  const groupsWithRows = VEHICLE_TYPES.filter((t) => visible.some((v) => v.type === t)).length;

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Fleet" title="Fleet" accent="& vehicles"
        sub="Every bus, mini-bus and van in the school fleet — capacity, assigned route and driver, and the compliance documents that keep them on the road."
        actions={<>
          <HeroSecondary onClick={exportVisible}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setForm({ mode: "add", presetType: VEHICLE_TYPES[0] })}>Add Vehicle</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Total fleet" value={vehicles.length} sub={`Across ${typeCount} vehicle types`} />
        <KpiCard loading={loading} label="Active" value={active.length} sub={`${onRoute} on route right now`} color={T.green} />
        <KpiCard loading={loading} label="Under maintenance" value={breakdowns + maint} sub={`${breakdowns} breakdown · ${maint} scheduled service`} color={T.amber} />
        <KpiCard loading={loading} label="Seats available" value={seatsFree} sub="Free seats on active vehicles" color={T.pu} />
      </KpiGrid>

      <SmartFilter
        chips={chips}
        groupingChip="Grouped by type"
        onReset={resetFilters}
        fields={[
          { key: "type", label: "Vehicle type", value: fType, onChange: setFType,
            options: [{ value: ALL, label: "All types" }, ...VEHICLE_TYPES.map((t) => ({ value: t, label: t }))] },
          { key: "status", label: "Status", value: fStatus, onChange: setFStatus,
            options: [{ value: ALL, label: "All statuses" }, ...VEHICLE_STATUSES.map((s) => ({ value: s, label: s }))] },
          { key: "route", label: "Route", value: fRoute, onChange: setFRoute,
            options: [{ value: ALL, label: "All routes" }, { value: "unassigned", label: "Unassigned" }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))] },
          { key: "compliance", label: "Compliance", value: fCompliance, onChange: setFCompliance,
            options: [{ value: ALL, label: "Any compliance" }, { value: "expiring", label: COMPLIANCE_LABEL.expiring }, { value: "expired", label: "Expired" }] },
        ]}
      />

      <SearchRow value={query} onChange={setQuery} onSubmit={runSearch} placeholder="Search by registration, model, route or driver…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportVisible} />

      <GroupedList title="All vehicles" helper="Grouped by vehicle type · donut shows seat occupancy for the morning shift"
        onCollapseAll={groups.collapseAll} onExpandAll={() => groups.expandAll([...VEHICLE_TYPES])}
        footer={visible.length > 0 && (
          <ListFooter summary={`Showing ${visible.length} of ${vehicles.length} vehicles`} counts={`across ${groupsWithRows} ${groupsWithRows === 1 ? "group" : "groups"}`}
            onCollapseAll={groups.collapseAll}
            onExportView={() => { exportRows(visible); toast("Current view exported"); }} />
        )}>
        {visible.length === 0 && filtersActive ? (
          <EmptyLine>No vehicles match these filters. Try clearing the search or resetting filters.</EmptyLine>
        ) : groupsShown.map((type) => {
          const rows = visible.filter((v) => v.type === type);
          const cap = rows.reduce((s, v) => s + capacityOf(v), 0);
          const occ = rows.reduce((s, v) => s + v.occupied, 0);
          const groupFree = rows.filter(isActive).reduce((s, v) => s + (capacityOf(v) - v.occupied), 0);
          return (
            <GroupCard key={type} name={type} open={groups.isOpen(type)} onToggle={() => groups.toggle(type)}
              pct={cap ? (occ / cap) * 100 : 0}
              chips={<>
                <Chip tone="slate">{plural(rows.length, "vehicle")}</Chip>
                <Chip tone="green">{rows.filter(isActive).length} active</Chip>
                <Chip tone="purple">{rows.filter(isInService).length} in service</Chip>
                <Chip tone="blue">{groupFree} seats free</Chip>
              </>}
              extra={<OutlineButton onClick={() => setForm({ mode: "add", presetType: type })}>+ Add</OutlineButton>}>
              {rows.length === 0 ? (
                <EmptyLine>No vehicles in this group yet.</EmptyLine>
              ) : (
                <div className="tp-scroll-x">
                  <table className="tp-table" style={{ minWidth: 1100 }}>
                    <thead>
                      <tr>
                        <th style={{ width: 42 }}><span className="sr-only">Select</span></th>
                        <th>Vehicle</th><th>Capacity</th><th>Route</th><th>Driver</th><th>Fitness / Insurance</th><th>Status</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((v) => {
                        const sel = selection.isSelected(v.id);
                        return (
                          <tr key={v.id} className={sel ? "is-selected" : undefined}>
                            <td style={{ width: 42 }}>
                              <input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(v.id)} aria-label={`Select ${v.reg}`} />
                            </td>
                            <td>
                              <IdentityCell lead={<IconTile icon={v.type.startsWith("Van") ? Car : Bus} />}
                                title={<Plate>{v.reg}</Plate>} sub={`${v.model} · ${v.id}`} />
                            </td>
                            <td><CellStack top={`${capacityOf(v)} seats`} sub={`${v.occupied} occupied`} /></td>
                            <td>{routeLabel(routes, v.routeCode)}</td>
                            <td>{driverName(v.driverId)}</td>
                            <td>
                              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4 }}>
                                <ComplianceBadge label="Fitness" iso={v.fitness} />
                                <ComplianceBadge label="Insurance" iso={v.insurance} />
                              </div>
                            </td>
                            <td><StatusBadge status={v.status} /></td>
                            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                              <RowIconButton label={`View ${v.reg}`} onClick={() => setDrawerId(v.id)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label={`Edit ${v.reg}`} onClick={() => setForm({ mode: "edit", id: v.id })}><Pencil size={14} strokeWidth={1.8} /></RowIconButton>
                              <RowIconButton label={`Renew document for ${v.reg}`} onClick={() => setUploadId(v.id)}><FileText size={14} strokeWidth={1.8} /></RowIconButton>
                              <MoreMenu label={`More actions for ${v.reg}`} open={menuId === v.id}
                                onToggle={() => setMenuId((m) => (m === v.id ? null : v.id))} onClose={() => setMenuId(null)}
                                items={[
                                  { label: "Edit details", onClick: () => setForm({ mode: "edit", id: v.id }) },
                                  { label: "Mark breakdown", color: T.warn, onClick: () => setConfirm({ kind: "breakdown", id: v.id }) },
                                  { label: "Archive vehicle", color: T.red, onClick: () => setConfirm({ kind: "archive", id: v.id }) },
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
        { label: "Assign route", onClick: () => setAssignOpen(true) },
        { label: "Export", onClick: () => {
          const rows = vehicles.filter((v) => selection.isSelected(v.id));
          exportRows(rows);
          toast(`Exported ${plural(rows.length, "vehicle")}`);
          selection.clear();
        } },
        { label: "Archive", onClick: () => setConfirm({ kind: "bulkArchive" }) },
      ]} />

      <VehicleDrawer vehicle={drawerVehicle} routes={routes} drivers={drivers} onClose={() => setDrawerId(null)}
        onEdit={() => drawerVehicle && setForm({ mode: "edit", id: drawerVehicle.id })}
        onUpload={() => drawerVehicle && setUploadId(drawerVehicle.id)}
        onBreakdown={() => drawerVehicle && setConfirm({ kind: "breakdown", id: drawerVehicle.id })} />

      {form && (
        <VehicleFormModal key={form.mode === "edit" ? form.id : `add-${form.presetType}`} mode={form.mode} initial={formInitial(form)}
          routes={routes} drivers={drivers.filter((d) => !d.archived)} onClose={() => setForm(null)} onSubmit={(values) => { void submitForm(values); }} />
      )}

      {uploadVehicle && (
        <UploadDocModal key={uploadVehicle.id} vehicle={uploadVehicle} onClose={() => setUploadId(null)}
          onSubmit={async (doc, validTill) => {
            if (!(await dispatch({ type: "vehicle/renewDoc", id: uploadVehicle.id, doc, validTill, owner: ownerName }))) { toast(`Not saved: ${errorText()}`, "error"); return; }
            toast(`${doc} for ${uploadVehicle.reg} updated · valid till ${fmtDate(validTill)}`);
            setUploadId(null);
          }} />
      )}

      {assignOpen && (
        <AssignRouteModal count={selection.count} routes={routes} onClose={() => setAssignOpen(false)}
          onSubmit={async (code) => {
            const n = selection.count;
            if (!(await dispatch({ type: "vehicle/assignRoute", ids: selection.ids, routeCode: code }))) { toast(`Not saved: ${errorText()}`, "error"); return; }
            selection.clear();
            setAssignOpen(false);
            toast(`${plural(n, "vehicle")} assigned to ${routeLabel(routes, code)}`);
          }} />
      )}

      <ConfirmDialog open={!!confirmProps} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="danger"
        title={confirmProps?.title ?? ""} message={confirmProps?.message ?? ""} confirmLabel={confirmProps?.label ?? ""} />
    </TransportPage>
  );
}

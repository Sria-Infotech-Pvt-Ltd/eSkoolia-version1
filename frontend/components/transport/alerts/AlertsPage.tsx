"use client";
/**
 * Alerts — /transport/alerts (Master Prompt §7.10). Severity groups toggle
 * independently. Alerts raised from Live Tracking land here through the store.
 */
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Clock, Eye, Gauge, Route as RouteIcon, ShieldCheck, Wrench } from "lucide-react";
import { useOwnerName, useTransport } from "@/lib/transport/store";
import { ageLabel, plural } from "@/lib/transport/format";
import { downloadCsv, type CsvColumn } from "@/lib/transport/csv";
import type { AlertSeverity, AlertType, TransportAlert } from "@/lib/transport/types";
import {
  Badge, BulkBar, Button, SaveButton, Chip, ConfirmDialog, Drawer, DrawerActions, DrawerHeader, DrawerHighlight, DrawerSection, EmptyLine,
  Field, GroupCard, GroupedList, HeroPrimary, HeroSecondary, InfoRow, Input, KpiCard, KpiGrid, Modal, OutlineButton, PageHero,
  RowIconButton, SearchRow, Select, SmartFilter, T, TransportPage, useDeepLink, useMountSkeleton, useSelection, useTpToast,
  type FilterChip, type Tone,
} from "@/components/transport/ui";

const ALL = "all";
const SEVERITIES: AlertSeverity[] = ["Critical", "Warning", "Info"];
const TYPES: AlertType[] = ["Overspeed", "Route deviation", "Breakdown", "SOS", "Late arrival", "Document expiry"];
const TYPE_ICON: Record<AlertType, React.ElementType> = {
  Overspeed: Gauge, "Route deviation": RouteIcon, Breakdown: Wrench, SOS: AlertTriangle, "Late arrival": Clock, "Document expiry": ShieldCheck,
};
const SEV: Record<AlertSeverity, { color: string; bg: string; tone: Tone }> = {
  Critical: { color: T.danger, bg: T.dangerSoft, tone: "red" },
  Warning: { color: T.warn, bg: T.warnSoft, tone: "amber" },
  Info: { color: T.info, bg: T.infoSoft, tone: "blue" },
};

type ConfirmState = { kind: "resolve"; id: string } | { kind: "bulkResolve" };

export function AlertsPage() {
  const { state, dispatch, errorText, saving } = useTransport();
  const { alerts, routes } = state;
  const owner = useOwnerName();
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [fType, setFType] = useState(ALL);
  const [fRoute, setFRoute] = useState(ALL);
  const [fState, setFState] = useState("open");
  const [fRaised, setFRaised] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [open, setOpen] = useState<Set<AlertSeverity>>(() => new Set<AlertSeverity>(["Critical", "Warning"]));

  const selection = useSelection();
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const byId = useCallback((id: string | null) => alerts.find((a) => a.id === id) ?? null, [alerts]);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return alerts.filter((a) => {
      if (fType !== ALL && a.type !== fType) return false;
      if (fRoute !== ALL && a.routeCode !== fRoute) return false;
      if (fState === "open" && a.state === "resolved") return false;
      if (fState === "resolved" && a.state !== "resolved") return false;
      if (fRaised === "30" && a.ageMin > 30) return false;
      if (fRaised === "120" && a.ageMin > 120) return false;
      if (q && ![a.id, a.title, a.detail, a.type, a.routeCode].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [alerts, fType, fRoute, fState, fRaised, applied]);

  const visibleIds = visible.map((a) => a.id);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selection.isSelected(id));
  const STATE_LABEL: Record<string, string> = { open: "Open alerts only", resolved: "Resolved only", all: "All states" };
  const RAISED: Record<string, string> = { "30": "Last 30 min", "120": "Last 2 hours" };
  const chips: FilterChip[] = [
    { label: STATE_LABEL[fState], tone: "purple" },
    ...(fType !== ALL ? [{ label: `Type: ${fType}`, tone: "purple" as const }] : []),
    ...(fRoute !== ALL ? [{ label: `Route: ${fRoute}`, tone: "purple" as const }] : []),
    ...(fRaised !== ALL ? [{ label: `Raised: ${RAISED[fRaised]}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  const notResolved = alerts.filter((a) => a.state !== "resolved");
  const acked = alerts.filter((a) => a.state === "acknowledged").length;
  const critical = notResolved.filter((a) => a.severity === "Critical").length;
  // Resolved today = resolved on today's local date (not every resolved alert ever loaded).
  const sameDay = (iso: string | null | undefined) => !!iso && new Date(iso).toDateString() === new Date().toDateString();
  const resolved = alerts.filter((a) => a.state === "resolved" && sameDay(a.resolvedAt)).length;
  // Average time to acknowledge over the last 7 days, from the stored timestamps.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const responseMins = alerts
    .filter((a) => a.raisedAt && a.acknowledgedAt && new Date(a.raisedAt).getTime() >= weekAgo)
    .map((a) => (new Date(a.acknowledgedAt!).getTime() - new Date(a.raisedAt!).getTime()) / 60000)
    .filter((m) => m >= 0);
  const avgResponse = responseMins.length ? `${(responseMins.reduce((x, y) => x + y, 0) / responseMins.length).toFixed(1)} min` : "—";

  const csv: CsvColumn<TransportAlert>[] = [
    { header: "ID", value: (a) => a.id }, { header: "Severity", value: (a) => a.severity }, { header: "Type", value: (a) => a.type },
    { header: "Title", value: (a) => a.title }, { header: "Detail", value: (a) => a.detail }, { header: "Route", value: (a) => a.routeCode },
    { header: "Raised", value: (a) => ageLabel(a.ageMin) }, { header: "State", value: (a) => a.state }, { header: "Owner", value: (a) => a.owner ?? "" },
  ];
  const exportLog = () => { downloadCsv("transport-alert-log.csv", csv, visible); toast("Alert log exported"); };

  useDeepLink(({ id, isNew }) => {
    if (id) {
      const a = alerts.find((x) => x.id === id);
      if (a) { setDrawerId(a.id); setOpen((o) => new Set(o).add(a.severity)); }
    }
    if (isNew) setRaiseOpen(true);
  });

  const toggleGroup = (s: AlertSeverity) => setOpen((o) => { const n = new Set(o); if (n.has(s)) n.delete(s); else n.add(s); return n; });
  const acknowledge = async (a: TransportAlert) => {
    if (await dispatch({ type: "alert/ack", ids: [a.id], owner })) toast(`${a.id} acknowledged`);
    else toast(`Not saved: ${errorText()}`, "error");
  };
  const resetFilters = () => { setFType(ALL); setFRoute(ALL); setFState("open"); setFRaised(ALL); setQuery(""); setApplied(""); };
  const runSearch = () => { const q = query.trim(); setApplied(q); if (q) setOpen(new Set(SEVERITIES)); };

  // Confirm only after the backend has saved; the dialog shows progress and stays open to retry on failure.
  const runConfirm = async () => {
    if (!confirm) return;
    const cf = confirm;
    const n = selection.count;
    const ok = await dispatch({ type: "alert/resolve", ids: cf.kind === "resolve" ? [cf.id] : selection.ids, owner });
    if (!ok) { toast(`Not saved: ${errorText()}`, "error"); return; }
    setConfirm(null);
    setDrawerId(null);
    if (cf.kind === "resolve") toast(`${cf.id} resolved`);
    else { selection.clear(); toast(`${plural(n, "alert")} resolved`); }
  };

  const confirmText = (() => {
    if (!confirm) return null;
    if (confirm.kind === "bulkResolve") return { title: `Resolve ${plural(selection.count, "alert")}?`, message: "They will be closed and logged with your name.", label: "Resolve all" };
    const a = byId(confirm.id);
    if (!a) return null;
    return {
      title: `Resolve ${a.id}?`,
      message: `“${a.title}” will be closed and logged with your name.`,
      label: "Resolve alert",
    };
  })();

  const drawer = byId(drawerId);
  const routeName = (code: string) => { const r = routes.find((x) => x.code === code); return r ? `${r.code} · ${r.name}` : code; };

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Safety" title="Alerts" accent="& incidents"
        sub="Overspeed, route deviations, breakdowns, SOS calls, late arrivals and expiring documents — triaged by severity so the critical ones never wait."
        actions={<>
          <HeroSecondary onClick={exportLog}>Export CSV</HeroSecondary>
          <HeroPrimary onClick={() => setRaiseOpen(true)}>Raise alert</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Open" value={notResolved.length} sub={`${acked} acknowledged`} />
        <KpiCard loading={loading} label="Critical" value={critical} sub="SOS, overspeed, breakdown" color={T.red} />
        <KpiCard loading={loading} label="Resolved today" value={resolved} sub="Closed by the transport desk" color={T.green} />
        <KpiCard loading={loading} label="Avg response" value={avgResponse}
          sub={responseMins.length ? `Time to acknowledge · ${plural(responseMins.length, "alert")}, 7 days` : "No acknowledged alerts in 7 days"} color={T.pu} />
      </KpiGrid>

      <SmartFilter chips={chips} groupingChip="Grouped by severity" onReset={resetFilters} fields={[
        { key: "type", label: "Type", value: fType, onChange: setFType, options: [{ value: ALL, label: "All types" }, ...TYPES.map((t) => ({ value: t, label: t }))] },
        { key: "route", label: "Route", value: fRoute, onChange: setFRoute,
          options: [{ value: ALL, label: "All routes" }, ...routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))] },
        { key: "state", label: "State", value: fState, onChange: setFState,
          options: [{ value: "open", label: "Open only" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }] },
        { key: "raised", label: "Raised", value: fRaised, onChange: setFRaised,
          options: [{ value: ALL, label: "Any time" }, { value: "30", label: "Last 30 min" }, { value: "120", label: "Last 2 hours" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={runSearch} placeholder="Search alerts by bus, route, type or ID…"
        allSelected={allSelected} onToggleAll={() => selection.toggleAll(visibleIds)} onExport={exportLog} />

      <GroupedList title="Alert queue" helper="Grouped by severity · acknowledge to claim, resolve to close"
        onCollapseAll={() => setOpen(new Set())} onExpandAll={() => setOpen(new Set(SEVERITIES))}
        footer={
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "4px 4px 0" }}>
            <span style={{ fontSize: 12, color: T.muted }}>Showing {visible.length} of {alerts.length} alerts</span>
            <OutlineButton onClick={exportLog}>Export log</OutlineButton>
          </div>
        }>
        {SEVERITIES.map((sev) => {
          const all = alerts.filter((a) => a.severity === sev);
          const rows = visible.filter((a) => a.severity === sev);
          const openN = all.filter((a) => a.state === "open").length;
          const ackN = all.filter((a) => a.state === "acknowledged").length;
          const resN = all.filter((a) => a.state === "resolved").length;
          const live = openN + ackN;
          return (
            <GroupCard key={sev} name={sev} open={open.has(sev)} onToggle={() => toggleGroup(sev)} pct={live ? (ackN / live) * 100 : 100}
              chips={<>
                <Chip tone={SEV[sev].tone}>{openN} open</Chip>
                <Chip tone="purple">{ackN} acknowledged</Chip>
                <Chip tone="green">{resN} resolved</Chip>
              </>}
              extra={openN > 0 ? (
                <OutlineButton disabled={saving} aria-busy={saving || undefined} onClick={async () => {
                  if (await dispatch({ type: "alert/ack", ids: all.filter((a) => a.state === "open").map((a) => a.id), owner })) toast(`All ${sev.toLowerCase()} alerts acknowledged`);
                  else toast(`Not saved: ${errorText()}`, "error");
                }}>{saving ? "Acknowledging…" : "Acknowledge all"}</OutlineButton>
              ) : undefined}>
              {rows.length === 0 ? <EmptyLine>No {sev.toLowerCase()} alerts match these filters.</EmptyLine> : (
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {rows.map((a) => {
                    const done = a.state === "resolved";
                    const color = done ? T.muted : SEV[sev].color;
                    const bg = done ? T.surface2 : SEV[sev].bg;
                    const Icon = TYPE_ICON[a.type];
                    const sel = selection.isSelected(a.id);
                    return (
                      <div key={a.id} style={{
                        display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10, padding: "10px 12px", borderRadius: 10,
                        borderLeft: `3px solid ${color}`, background: sel ? T.rowSel : bg,
                      }}>
                        <input type="checkbox" className="tp-check" checked={sel} onChange={() => selection.toggle(a.id)} aria-label={`Select ${a.id}`} />
                        <Icon size={15} color={color} strokeWidth={1.8} style={{ flexShrink: 0 }} />
                        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 600, color: T.exInk1 }}>{a.title}</span>
                            <span style={{ fontSize: 11, fontWeight: 800, color, background: "#fff", borderRadius: 999, padding: "2px 8px" }}>{a.type}</span>
                            {a.state === "acknowledged" && <Badge tone="purple">Acknowledged · {a.owner}</Badge>}
                            {done && <Badge tone="green">Resolved</Badge>}
                          </div>
                          <div style={{ fontSize: 11, color: T.exInk2, marginTop: 2 }}>{a.id} · {a.detail} · {ageLabel(a.ageMin)}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <RowIconButton label={`View ${a.id}`} onClick={() => setDrawerId(a.id)}><Eye size={15} strokeWidth={1.8} /></RowIconButton>
                          {a.state === "open" && (
                            <button type="button" onClick={() => acknowledge(a)} style={{ height: 30, padding: "0 12px", borderRadius: 10, border: `1px solid ${T.softBd}`, background: "#fff", color: T.pu, fontSize: 12, fontWeight: 750, cursor: "pointer" }}>
                              Acknowledge
                            </button>
                          )}
                          {!done && (
                            <button type="button" onClick={() => setConfirm({ kind: "resolve", id: a.id })} style={{ height: 30, padding: "0 12px", borderRadius: 10, border: `1px solid ${T.pu}`, background: T.pu, color: "#fff", fontSize: 12, fontWeight: 750, cursor: "pointer" }}>
                              Resolve
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </GroupCard>
          );
        })}
      </GroupedList>

      <BulkBar count={selection.count} onClear={selection.clear} actions={[
        { label: "Acknowledge", onClick: async () => { const n = selection.count; const ids = selection.ids; if (await dispatch({ type: "alert/ack", ids, owner })) { selection.clear(); toast(`${plural(n, "alert")} acknowledged`) } else toast(`Not saved: ${errorText()}`, "error"); } },
        { label: "Message", onClick: () => { toast("Messaging drivers isn't connected yet - no message was sent", "info"); } },
        { label: "Export", onClick: () => {
          const list = alerts.filter((a) => selection.isSelected(a.id));
          downloadCsv("transport-alerts-selected.csv", csv, list); toast(`Exported ${plural(list.length, "alert")}`); selection.clear();
        } },
        { label: "Resolve", onClick: () => setConfirm({ kind: "bulkResolve" }) },
      ]} />

      {drawer && (
        <Drawer open onClose={() => setDrawerId(null)} label={`Alert ${drawer.id}`}>
          <DrawerHeader avatar={drawer.severity[0]} title={drawer.type} sub={`${routeName(drawer.routeCode)} · ${drawer.severity}`} idLabel={drawer.id}
            badges={<>
              {drawer.state === "open" ? <Badge tone="red">Open</Badge> : drawer.state === "acknowledged" ? <Badge tone="purple">Acknowledged</Badge> : <Badge tone="green">Resolved</Badge>}
              <Badge tone={SEV[drawer.severity].tone}>{drawer.severity}</Badge>
            </>} />
          <DrawerHighlight items={[{ label: "Raised", value: ageLabel(drawer.ageMin) }, { label: "Owner", value: drawer.owner ?? "Unclaimed" }]} />
          <DrawerSection title="Incident">
            <InfoRow label="Summary">{drawer.title}</InfoRow>
            <InfoRow label="Detail">{drawer.detail}</InfoRow>
            <InfoRow label="Route">{routeName(drawer.routeCode)}</InfoRow>
          </DrawerSection>
          <DrawerSection title="Timeline">
            <InfoRow label="Raised">{ageLabel(drawer.ageMin)}</InfoRow>
            <InfoRow label="Acknowledged">{drawer.state !== "open" && drawer.owner ? `by ${drawer.owner}` : "—"}</InfoRow>
            <InfoRow label="Parents notified">Not recorded</InfoRow>
          </DrawerSection>
          <DrawerActions>
            <Button type="button" variant="soft" size="sm" disabled={drawer.state === "resolved"}
              onClick={() => (drawer.state === "open" ? acknowledge(drawer) : toast("Re-assigning alerts isn't connected yet - the owner is unchanged", "info"))}>
              {drawer.state === "open" ? "Acknowledge" : "Re-assign"}
            </Button>
            <Button type="button" variant="soft" size="sm" onClick={() => toast("Calling isn't connected yet - no call was placed", "info")}>Call driver</Button>
            <Button type="button" variant="red" size="sm" disabled={drawer.state === "resolved"} onClick={() => setConfirm({ kind: "resolve", id: drawer.id })}>Resolve</Button>
          </DrawerActions>
        </Drawer>
      )}

      {raiseOpen && (
        <RaiseAlertModal routes={routes.map((r) => ({ code: r.code, label: `${r.code} · ${r.name}` }))} onClose={() => setRaiseOpen(false)}
          onSubmit={async (v) => {
            if (!(await dispatch({ type: "alert/raise", input: { ...v, state: "acknowledged", owner, detail: `Raised manually by ${owner}` } }))) {
              toast(`Not raised: ${errorText()}`, "error"); return;
            }
            setOpen((o) => new Set(o).add(v.severity));
            setRaiseOpen(false);
            toast("Alert raised");
          }} />
      )}

      <ConfirmDialog open={!!confirmText} onClose={() => setConfirm(null)} onConfirm={runConfirm} tone="safe"
        title={confirmText?.title ?? ""} message={confirmText?.message ?? ""} confirmLabel={confirmText?.label ?? ""} />
    </TransportPage>
  );
}

function RaiseAlertModal({
  routes, onClose, onSubmit,
}: {
  routes: { code: string; label: string }[]; onClose: () => void;
  onSubmit: (v: { title: string; type: AlertType; severity: AlertSeverity; routeCode: string }) => void;
}) {
  const { toast } = useTpToast();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<AlertType>("Late arrival");
  const [severity, setSeverity] = useState<AlertSeverity>("Warning");
  const [routeCode, setRouteCode] = useState(routes[0]?.code ?? "");
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    if (!title.trim()) { setError("This field is required."); toast("Fill in the required fields", "error"); return; }
    onSubmit({ title: title.trim(), type, severity, routeCode });
  };
  return (
    <Modal open onClose={onClose} size="md" title="Raise alert" subtitle="Log a manual incident for the transport desk"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <SaveButton onClick={submit}>Raise alert</SaveButton>
      </>}>
      <div className="tp-form-grid">
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="What happened" required error={error}>
            <Input value={title} onChange={(e) => { setTitle(e.target.value); setError(undefined); }} placeholder="e.g. Bus stuck at level crossing" />
          </Field>
        </div>
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as AlertType)}>{TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        <Field label="Severity"><Select value={severity} onChange={(e) => setSeverity(e.target.value as AlertSeverity)}>{SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
        <Field label="Route"><Select value={routeCode} onChange={(e) => setRouteCode(e.target.value)}>{routes.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}</Select></Field>
      </div>
    </Modal>
  );
}

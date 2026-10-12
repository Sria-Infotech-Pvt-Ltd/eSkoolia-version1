"use client";
/** Reports — /transport/reports (Master Prompt §7.13). Preview tables are computed from the shared store. */
import { useMemo, useState } from "react";
import { Car, ClipboardCheck, Download, Eye, FileBarChart, FileText, Fuel, IdCard, Users } from "lucide-react";
import { useTransport } from "@/lib/transport/store";
import { fmtDate } from "@/lib/transport/format";
import { downloadCsv } from "@/lib/transport/csv";
import { buildPreview, downloadPdf, downloadXlsx, type ReportPreview, type ReportScope } from "@/lib/transport/reports";
import type { ReportDef } from "@/lib/transport/types";
import {
  Badge, Button, Field, HeroPrimary, HeroSecondary, Input, KpiCard, KpiGrid, LAYER, Modal, PageHero, RhythmPill, SearchRow, Select,
  SimpleAccordion, SmartFilter, T, TransportPage, useDeepLink, useMountSkeleton, useTpToast, type FilterChip,
} from "@/components/transport/ui";

const ALL = "all";
const ICONS: Record<ReportDef["icon"], React.ElementType> = { Users, Car, FileBarChart, IdCard, ClipboardCheck, Fuel };
const DOT: Record<ReportDef["dot"], string> = { ok: T.dotOk, warn: T.dotWarn, danger: T.dotDanger };
const SCHEDULED_REPORT = "Daily boarding register";

interface GenValues { from: string; to: string; route: string; shift: string; format: "PDF" | "Excel" }
type GenState = { report: string; schedule: boolean; initial: GenValues };
type PreviewState = { report: string; scope: ReportScope; time: string };

function nowLabel(): string {
  return new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toUpperCase()}`);
}

export function ReportsPage() {
  const { state, dispatch } = useTransport();
  const { reports, recentReports, routes } = state;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [fCat, setFCat] = useState(ALL);
  const [fFreq, setFFreq] = useState(ALL);
  const [fStatus, setFStatus] = useState(ALL);
  const [fFormat, setFFormat] = useState(ALL);
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");
  const [recentOpen, setRecentOpen] = useState(true);
  const [gen, setGen] = useState<GenState | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const defaultFormat: "PDF" | "Excel" = fFormat === "Excel" ? "Excel" : "PDF";
  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return reports.filter((r) => {
      if (fCat !== ALL && r.category !== fCat) return false;
      if (fFreq !== ALL && r.rhythm !== fFreq) return false;
      if (fStatus === "attention" && r.dot === "ok") return false;
      if (fStatus === "ok" && r.dot !== "ok") return false;
      if (q && !`${r.name} ${r.description}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [reports, fCat, fFreq, fStatus, applied]);

  const chips: FilterChip[] = [
    ...(fCat !== ALL ? [{ label: `Category: ${fCat}`, tone: "purple" as const }] : []),
    ...(fFreq !== ALL ? [{ label: `Frequency: ${fFreq}`, tone: "purple" as const }] : []),
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus === "attention" ? "Needs attention" : "Up to date"}`, tone: "purple" as const }] : []),
    ...(fFormat !== ALL ? [{ label: `Format: ${fFormat}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  const scheduledRows = recentReports.filter((r) => r.generated.startsWith("Scheduled")).length;
  const attention = reports.filter((r) => r.dot !== "ok").length;
  const categories = new Set(reports.map((r) => r.category)).size;

  const routeLabel = (code: string) => (code === ALL ? "All routes" : routes.find((r) => r.code === code) ? `${code} · ${routes.find((r) => r.code === code)!.name}` : code);
  const openGenerate = (report: string) => setGen({ report, schedule: false, initial: { from: "2026-10-01", to: "2026-10-06", route: ALL, shift: "Both shifts", format: defaultFormat } });
  const openSchedule = () => setGen({ report: SCHEDULED_REPORT, schedule: true, initial: { from: "2026-10-07", to: "2026-12-31", route: ALL, shift: "Morning pickup", format: defaultFormat } });
  const openPreview = (report: string, scope?: ReportScope) => setPreview({ report, scope: scope ?? { routeCode: null, shift: "Both shifts", label: "All routes" }, time: nowLabel() });

  const resetFilters = () => { setFCat(ALL); setFFreq(ALL); setFStatus(ALL); setFFormat(ALL); setQuery(""); setApplied(""); };

  useDeepLink(({ id, isNew }) => {
    if (id) { const r = reports.find((x) => x.name.toLowerCase() === id.toLowerCase()); if (r) openPreview(r.name); }
    if (isNew) openSchedule();
  });

  const submitGenerate = (g: GenState, v: GenValues) => {
    const period = `${fmtDate(v.from)} – ${fmtDate(v.to)}`;
    const scopeText = `${routeLabel(v.route)} · ${v.shift}`;
    if (g.schedule) {
      dispatch({ type: "report/add", scheduled: true, row: { report: g.report, period, scope: scopeText, format: v.format, generated: "Scheduled · daily 8:15 AM" } });
      setGen(null);
      toast("Report scheduled · first run tomorrow 8:15 AM");
      return;
    }
    dispatch({ type: "report/add", scheduled: false, row: { report: g.report, period, scope: scopeText, format: v.format, generated: "Just now" } });
    setGen(null);
    openPreview(g.report, { routeCode: v.route === ALL ? null : v.route, shift: v.shift, label: `${routeLabel(v.route)} · ${fmtDate(v.from)} – ${fmtDate(v.to)}` });
    toast(`${g.report} generated as ${v.format}`);
  };

  const download = async (report: string, p: ReportPreview, format: "PDF" | "Excel") => {
    try {
      if (format === "PDF") await downloadPdf(report, p); else await downloadXlsx(report, p);
    } catch {
      // Library unavailable in this environment — fall back to CSV of the same table.
      downloadCsv(`${report}.csv`, p.columns.map((col, i) => ({ header: col.header, value: (row: string[]) => row[i] })),
        [...p.rows.map((r) => r.map((x) => x.text)), p.totals]);
    }
  };

  const previewData = preview ? buildPreview(preview.report, state, preview.scope) : null;

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Insights" title="Transport" accent="reports"
        sub="Ready-made reports for operations, fleet, staff and finance. Pick a period and scope, then download as PDF or Excel."
        actions={<>
          <HeroSecondary onClick={() => {
            downloadCsv("transport-report-catalogue.csv", [
              { header: "Report", value: (r: ReportDef) => r.name }, { header: "Category", value: (r) => r.category },
              { header: "Frequency", value: (r) => r.rhythm }, { header: "Last generated", value: (r) => fmtDate(r.lastGenerated) },
              { header: "Description", value: (r) => r.description },
            ], visible);
            toast("Report catalogue exported");
          }}>Export CSV</HeroSecondary>
          <HeroPrimary icon={false} onClick={openSchedule}>Schedule a report</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Reports available" value={reports.length} sub={`Across ${categories} categories`} />
        <KpiCard loading={loading} label="Generated this month" value={recentReports.length - scheduledRows + 14} sub="By 3 staff members" color={T.pu} />
        <KpiCard loading={loading} label="Scheduled" value={2 + scheduledRows} sub="Daily register 8:15 AM · Weekly roster Sat" color={T.green} />
        <KpiCard loading={loading} label="Needs attention" value={attention} sub="Fee defaulters · today's no-shows" color={T.amber} />
      </KpiGrid>

      <SmartFilter chips={chips} onReset={resetFilters} fields={[
        { key: "cat", label: "Category", value: fCat, onChange: setFCat, options: [{ value: ALL, label: "All categories" }, ...["Operations", "Fleet", "Staff", "Finance"].map((x) => ({ value: x, label: x }))] },
        { key: "freq", label: "Frequency", value: fFreq, onChange: setFFreq, options: [{ value: ALL, label: "Any" }, ...["Daily", "Weekly", "Monthly", "Per term"].map((x) => ({ value: x, label: x }))] },
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus, options: [{ value: ALL, label: "Any status" }, { value: "attention", label: "Needs attention" }, { value: "ok", label: "Up to date" }] },
        { key: "format", label: "Default format", value: fFormat, onChange: setFFormat, options: [{ value: ALL, label: "Any format" }, { value: "PDF", label: "PDF" }, { value: "Excel", label: "Excel" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={() => setApplied(query.trim())} placeholder="Search reports…"
        allSelected={false} onToggleAll={() => toast("Generate reports one at a time from their cards", "info")}
        onExport={() => { downloadCsv("transport-report-catalogue.csv", [{ header: "Report", value: (r: ReportDef) => r.name }, { header: "Category", value: (r) => r.category }], visible); toast("Report catalogue exported"); }} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16, marginBottom: 16 }}>
        {visible.length === 0 && (
          <div style={{ gridColumn: "1 / -1", background: "#fff", border: `1px solid ${T.exBd}`, borderRadius: 16, padding: 22, textAlign: "center", fontSize: 13, color: T.muted }}>
            No reports match these filters.
          </div>
        )}
        {visible.map((r) => {
          const Icon = ICONS[r.icon];
          return (
            <div key={r.name} style={{ background: "#fff", border: `1px solid ${T.exBd}`, borderRadius: 16, padding: 22, display: "flex", flexDirection: "column", gap: 14, boxShadow: T.shadow1 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                <span style={{ width: 36, height: 36, borderRadius: 10, background: T.exPuSoft, display: "grid", placeItems: "center" }}><Icon size={17} color={T.exPu} strokeWidth={1.8} /></span>
                <RhythmPill>{r.rhythm}</RhythmPill>
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.exInk1, marginBottom: 6 }}>{r.name}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.exInk2 }}><span aria-hidden style={{ color: DOT[r.dot], marginRight: 6 }}>●</span>{r.description}</div>
                <div style={{ fontSize: 11.5, color: T.exInk3, marginTop: 8 }}>Last generated {fmtDate(r.lastGenerated)}</div>
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: "auto" }}>
                <button type="button" className="tp-cta tp-cta--outline" style={{ cursor: "pointer" }} onClick={() => openPreview(r.name)}>Preview</button>
                <button type="button" className="tp-cta tp-cta--outline" style={{ cursor: "pointer" }} onClick={() => openGenerate(r.name)}>Generate</button>
              </div>
            </div>
          );
        })}
      </div>

      <SimpleAccordion icon={FileText} title="Recently generated" open={recentOpen} onToggle={() => setRecentOpen((o) => !o)}
        right={<span style={{ fontSize: 11.5, color: T.exInk2 }}>{recentReports.length} files</span>}>
        <div className="tp-scroll-x">
          <table className="tp-table" style={{ minWidth: 760 }}>
            <thead><tr><th>Report</th><th>Period</th><th>Scope</th><th>Format</th><th>Generated</th><th style={{ textAlign: "right" }}>File</th></tr></thead>
            <tbody>
              {recentReports.map((row, i) => (
                <tr key={`${row.report}-${i}`}>
                  <td style={{ fontWeight: 700 }}>{row.report}</td>
                  <td>{row.period}</td>
                  <td>{row.scope}</td>
                  <td><Badge tone={row.format === "PDF" ? "red" : "green"}>{row.format}</Badge></td>
                  <td style={{ color: T.muted }}>{row.generated}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="tp-btn-row" aria-label={`Preview ${row.report}`} title="Preview" onClick={() => openPreview(row.report, { routeCode: null, shift: "Both shifts", label: row.scope })}><Eye size={15} strokeWidth={1.8} /></button>
                    <button type="button" className="tp-btn-row" aria-label={`Download ${row.report}`} title="Download"
                      onClick={async () => { await download(row.report, buildPreview(row.report, state, { routeCode: null, shift: "Both shifts", label: row.scope }), row.format); toast(`${row.report} (${row.format}) downloaded`); }}>
                      <Download size={15} strokeWidth={1.8} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SimpleAccordion>

      {gen && (
        <GenerateModal key={`${gen.report}-${gen.schedule}`} title="Generate report" subtitle={gen.schedule ? `Scheduled: ${gen.report}` : gen.report}
          routes={routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))} initial={gen.initial}
          onClose={() => setGen(null)} onSubmit={(v) => submitGenerate(gen, v)} />
      )}

      {preview && previewData && (
        <Modal open size="xl" priority={LAYER.preview} onClose={() => setPreview(null)} title={preview.report}
          subtitle={`${previewData.sub} · generated ${preview.time}`}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setPreview(null)}>Close</Button>
            <span style={{ flex: 1 }} />
            <Button type="button" variant="ghost" onClick={() => { const r = preview.report; setPreview(null); openGenerate(r); }}>Change filters</Button>
            <Button type="button" variant="soft" onClick={async () => { await download(preview.report, previewData, "Excel"); toast(`${preview.report} downloaded as Excel`); }}>Download Excel</Button>
            <Button type="button" variant="primary" onClick={async () => { await download(preview.report, previewData, "PDF"); toast(`${preview.report} downloaded as PDF`); }}>Download PDF</Button>
          </>}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 16 }}>
            {previewData.stats.map((s) => (
              <div key={s.label} style={{ background: T.hlBg, border: `1px solid ${T.hlBd}`, borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: T.pu, marginTop: 4 }}>{s.value}</div>
              </div>
            ))}
          </div>
          <div className="tp-scroll-x" style={{ border: `1px solid ${T.cardBd}`, borderRadius: 12 }}>
            <table className="tp-table" style={{ minWidth: 720 }}>
              <thead><tr>{previewData.columns.map((col) => <th key={col.header} style={{ textAlign: col.numeric ? "right" : "left" }}>{col.header}</th>)}</tr></thead>
              <tbody>
                {previewData.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} style={{ textAlign: previewData.columns[ci]?.numeric ? "right" : "left", color: cell.color ?? T.ink, fontWeight: cell.bold ? 700 : undefined, whiteSpace: "nowrap" }}>{cell.text}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#FBFCFE", borderTop: `1px solid ${T.rowBd}` }}>
                  {previewData.totals.map((t, i) => (
                    <td key={i} style={{ fontWeight: 800, textAlign: previewData.columns[i]?.numeric ? "right" : "left", whiteSpace: "nowrap" }}>{t}</td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 11, color: T.label }}>
            Figures come from the Transport module&apos;s live records. Download for the full register with student-level rows.
          </p>
        </Modal>
      )}
    </TransportPage>
  );
}

function GenerateModal({ title, subtitle, routes, initial, onClose, onSubmit }: {
  title: string; subtitle: string; routes: { value: string; label: string }[]; initial: GenValues;
  onClose: () => void; onSubmit: (v: GenValues) => void;
}) {
  const { toast } = useTpToast();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const set = <K extends keyof GenValues>(k: K, val: GenValues[K]) => { setV((p) => ({ ...p, [k]: val })); setError(undefined); };
  const submit = () => {
    if (!v.from || !v.to) { toast("Fill in the required fields", "error"); return; }
    if (v.to < v.from) { setError("End date is before start date"); toast("End date is before start date", "error"); return; }
    onSubmit(v);
  };
  return (
    <Modal open onClose={onClose} size="md" title={title} subtitle={subtitle}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Generate</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="From" required><Input type="date" value={v.from} onChange={(e) => set("from", e.target.value)} /></Field>
        <Field label="To" required error={error}><Input type="date" value={v.to} onChange={(e) => set("to", e.target.value)} /></Field>
        <Field label="Route">
          <Select value={v.route} onChange={(e) => set("route", e.target.value)}>
            <option value={ALL}>All routes</option>
            {routes.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        <Field label="Shift">
          <Select value={v.shift} onChange={(e) => set("shift", e.target.value)}>{["Both shifts", "Morning pickup", "Afternoon drop"].map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        </Field>
        <Field label="Format">
          <Select value={v.format} onChange={(e) => set("format", e.target.value as GenValues["format"])}><option value="PDF">PDF</option><option value="Excel">Excel</option></Select>
        </Field>
      </div>
    </Modal>
  );
}

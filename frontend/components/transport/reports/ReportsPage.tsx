"use client";
/**
 * Reports — /transport/reports (Master Prompt §7.13). Every preview is calculated
 * by the backend from stored records (GET transport-reports/<key>/) for the chosen
 * month / day, shift and route; downloads are logged as "Recently generated".
 */
import { useEffect, useMemo, useState } from "react";
import { Car, ClipboardCheck, Download, Eye, FileBarChart, FileText, Fuel, IdCard, Users } from "lucide-react";
import { useTransport } from "@/lib/transport/store";
import { fetchReport } from "@/lib/transport/api";
import { TODAY, fmtDate, toISO } from "@/lib/transport/format";
import { downloadCsv } from "@/lib/transport/csv";
import { downloadPdf, downloadXlsx, toPreview, type ReportPreview } from "@/lib/transport/reports";
import type { AttendanceShift, ReportDef } from "@/lib/transport/types";
import {
  Badge, Button, Field, HeroPrimary, HeroSecondary, Input, KpiCard, KpiGrid, LAYER, Modal, PageHero, RhythmPill, SearchRow, Select,
  SimpleAccordion, SmartFilter, T, TransportPage, useDeepLink, useMountSkeleton, useTpToast, type FilterChip,
} from "@/components/transport/ui";

const ALL = "all";
const ICONS: Record<ReportDef["icon"], React.ElementType> = { Users, Car, FileBarChart, IdCard, ClipboardCheck, Fuel };
const DOT: Record<ReportDef["dot"], string> = { ok: T.dotOk, warn: T.dotWarn, danger: T.dotDanger };
const BOARDING = "boarding-register";

/** Report scope: a month (monthly reports) or a day + shift (boarding register), optionally one route. */
interface Scope { month: string; date: string; shift: AttendanceShift; route: string }
interface GenValues extends Scope { format: "PDF" | "Excel" }
type GenState = { report: string; initial: GenValues };
type PreviewState = { report: string; scope: Scope; time: string };

const DEFAULT_SCOPE: Scope = { month: toISO(TODAY).slice(0, 7), date: toISO(TODAY), shift: "morning", route: ALL };

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
  const [previewData, setPreviewData] = useState<ReportPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

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
    ...(fStatus !== ALL ? [{ label: `Status: ${fStatus === "attention" ? "Never generated" : "Generated before"}`, tone: "purple" as const }] : []),
    ...(fFormat !== ALL ? [{ label: `Format: ${fFormat}`, tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  const neverGenerated = reports.filter((r) => !r.lastGenerated).length;
  const categoryList = [...new Set(reports.map((r) => r.category))];
  const frequencyList = [...new Set(reports.map((r) => r.rhythm))];
  const keyOf = (name: string) => reports.find((r) => r.name === name)?.key ?? "";

  const routeLabel = (code: string) => (code === ALL ? "All routes" : routes.find((r) => r.code === code) ? `${code} · ${routes.find((r) => r.code === code)!.name}` : code);
  const periodLabel = (report: string, s: Scope) => (keyOf(report) === BOARDING
    ? `${fmtDate(s.date)} · ${s.shift === "morning" ? "Morning pickup" : "Afternoon drop"}`
    : new Date(Number(s.month.slice(0, 4)), Number(s.month.slice(5, 7)) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" }));
  const openGenerate = (report: string) => setGen({ report, initial: { ...DEFAULT_SCOPE, format: defaultFormat } });
  const openPreview = (report: string, scope?: Scope) => setPreview({ report, scope: scope ?? DEFAULT_SCOPE, time: nowLabel() });

  // Fetch the preview table whenever a preview is opened.
  useEffect(() => {
    if (!preview) { setPreviewData(null); setPreviewError(null); return; }
    let live = true;
    setPreviewData(null); setPreviewError(null);
    const s = preview.scope;
    const route = s.route === ALL ? null : routes.find((r) => r.code === s.route)?.pk ?? null;
    fetchReport(keyOf(preview.report), { route, month: s.month, date: s.date, shift: s.shift })
      .then((data) => { if (live) setPreviewData(toPreview(data)); })
      .catch((e: unknown) => { if (live) setPreviewError(e instanceof Error ? e.message : "Couldn't load the report"); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview]);

  const resetFilters = () => { setFCat(ALL); setFFreq(ALL); setFStatus(ALL); setFFormat(ALL); setQuery(""); setApplied(""); };

  useDeepLink(({ id, isNew }) => {
    if (id) { const r = reports.find((x) => x.name.toLowerCase() === id.toLowerCase()); if (r) openPreview(r.name); }
  });

  const submitGenerate = (g: GenState, v: GenValues) => {
    setGen(null);
    openPreview(g.report, { month: v.month, date: v.date, shift: v.shift, route: v.route });
  };

  /** Downloads the previewed table and logs it under "Recently generated". */
  const download = async (report: string, p: ReportPreview, format: "PDF" | "Excel", scope: Scope) => {
    try {
      if (format === "PDF") await downloadPdf(report, p); else await downloadXlsx(report, p);
    } catch {
      // Library unavailable in this environment — fall back to CSV of the same table.
      downloadCsv(`${report}.csv`, p.columns.map((col, i) => ({ header: col.header, value: (row: string[]) => row[i] })),
        [...p.rows.map((r) => r.map((x) => x.text)), p.totals]);
    }
    void dispatch({ type: "report/add", scheduled: false, row: {
      report, period: periodLabel(report, scope), scope: routeLabel(scope.route), format, generated: "Just now",
    } });
    toast(`${report} downloaded as ${format}`);
  };

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
          <HeroPrimary icon={false} onClick={() => reports[0] && openGenerate(reports[0].name)}>Generate a report</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Reports available" value={reports.length} sub={`Across ${categoryList.length} categories`} />
        <KpiCard loading={loading} label="Recent downloads" value={recentReports.length} sub="Latest 20 logged" color={T.pu} />
        <KpiCard loading={loading} label="Categories" value={categoryList.length} sub={categoryList.join(" · ") || "—"} color={T.green} />
        <KpiCard loading={loading} label="Never generated" value={neverGenerated} sub="Reports not downloaded yet" color={T.amber} />
      </KpiGrid>

      <SmartFilter chips={chips} onReset={resetFilters} fields={[
        { key: "cat", label: "Category", value: fCat, onChange: setFCat, options: [{ value: ALL, label: "All categories" }, ...categoryList.map((x) => ({ value: x, label: x }))] },
        { key: "freq", label: "Frequency", value: fFreq, onChange: setFFreq, options: [{ value: ALL, label: "Any" }, ...frequencyList.map((x) => ({ value: x, label: x }))] },
        { key: "status", label: "Status", value: fStatus, onChange: setFStatus, options: [{ value: ALL, label: "Any status" }, { value: "attention", label: "Never generated" }, { value: "ok", label: "Generated before" }] },
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
                <div style={{ fontSize: 11.5, color: T.exInk3, marginTop: 8 }}>{r.lastGenerated ? `Last generated ${fmtDate(r.lastGenerated)}` : "Not generated yet"}</div>
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
              {recentReports.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: "center", color: T.muted, padding: "18px 0" }}>No reports downloaded yet.</td></tr>
              )}
              {recentReports.map((row, i) => (
                <tr key={`${row.report}-${i}`}>
                  <td style={{ fontWeight: 700 }}>{row.report}</td>
                  <td>{row.period}</td>
                  <td>{row.scope}</td>
                  <td><Badge tone={row.format === "PDF" ? "red" : "green"}>{row.format}</Badge></td>
                  <td style={{ color: T.muted }}>{row.generated}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button type="button" className="tp-btn-row" aria-label={`Open ${row.report} with current data`} title="Open with current data" onClick={() => openPreview(row.report)}><Eye size={15} strokeWidth={1.8} /></button>
                    <button type="button" className="tp-btn-row" aria-label={`Generate ${row.report} again`} title="Generate again" onClick={() => openGenerate(row.report)}>
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
        <GenerateModal key={gen.report} title="Generate report" subtitle={gen.report} daily={keyOf(gen.report) === BOARDING}
          reportNames={reports.map((r) => r.name)} onPick={(name) => setGen({ ...gen, report: name })}
          routes={routes.map((r) => ({ value: r.code, label: `${r.code} · ${r.name}` }))} initial={gen.initial}
          onClose={() => setGen(null)} onSubmit={(v) => submitGenerate(gen, v)} />
      )}

      {preview && !previewData && (
        <Modal open size="md" priority={LAYER.preview} onClose={() => setPreview(null)} title={preview.report}
          subtitle={periodLabel(preview.report, preview.scope)}
          footer={<Button type="button" variant="ghost" onClick={() => setPreview(null)}>Close</Button>}>
          <div style={{ padding: "18px 0", textAlign: "center", fontSize: 13, color: previewError ? T.danger : T.muted }}>
            {previewError ?? "Calculating from stored records…"}
          </div>
        </Modal>
      )}

      {preview && previewData && (
        <Modal open size="xl" priority={LAYER.preview} onClose={() => setPreview(null)} title={preview.report}
          subtitle={`${previewData.sub} · generated ${preview.time}`}
          footer={<>
            <Button type="button" variant="ghost" onClick={() => setPreview(null)}>Close</Button>
            <span style={{ flex: 1 }} />
            <Button type="button" variant="ghost" onClick={() => { const r = preview.report; setPreview(null); openGenerate(r); }}>Change filters</Button>
            <Button type="button" variant="soft" onClick={() => { void download(preview.report, previewData, "Excel", preview.scope); }}>Download Excel</Button>
            <Button type="button" variant="primary" onClick={() => { void download(preview.report, previewData, "PDF", preview.scope); }}>Download PDF</Button>
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
                {previewData.rows.length === 0 && (
                  <tr><td colSpan={previewData.columns.length} style={{ textAlign: "center", color: T.muted, padding: "18px 0" }}>No records for this period and scope.</td></tr>
                )}
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
          {previewData.notes.map((note) => (
            <p key={note} style={{ margin: "10px 0 0", fontSize: 11.5, color: T.muted }}>{note}</p>
          ))}
          <p style={{ margin: "12px 0 0", fontSize: 11, color: T.label }}>
            Figures are calculated from the Transport module&apos;s stored records.
          </p>
        </Modal>
      )}
    </TransportPage>
  );
}

function GenerateModal({ title, subtitle, daily, reportNames, onPick, routes, initial, onClose, onSubmit }: {
  title: string; subtitle: string; daily: boolean; reportNames: string[]; onPick: (name: string) => void;
  routes: { value: string; label: string }[]; initial: GenValues;
  onClose: () => void; onSubmit: (v: GenValues) => void;
}) {
  const { toast } = useTpToast();
  const [v, setV] = useState(initial);
  const set = <K extends keyof GenValues>(k: K, val: GenValues[K]) => setV((p) => ({ ...p, [k]: val }));
  const submit = () => {
    if (daily ? !v.date : !v.month) { toast("Fill in the required fields", "error"); return; }
    onSubmit(v);
  };
  return (
    <Modal open onClose={onClose} size="md" title={title} subtitle={subtitle}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Generate</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Report">
          <Select value={subtitle} onChange={(e) => onPick(e.target.value)}>{reportNames.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
        </Field>
        {daily
          ? <Field label="Date" required><Input type="date" value={v.date} onChange={(e) => set("date", e.target.value)} /></Field>
          : <Field label="Month" required><Input type="month" value={v.month} onChange={(e) => set("month", e.target.value)} /></Field>}
        <Field label="Route">
          <Select value={v.route} onChange={(e) => set("route", e.target.value)}>
            <option value={ALL}>All routes</option>
            {routes.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
        </Field>
        {daily && (
          <Field label="Shift">
            <Select value={v.shift} onChange={(e) => set("shift", e.target.value as AttendanceShift)}>
              <option value="morning">Morning pickup</option><option value="afternoon">Afternoon drop</option>
            </Select>
          </Field>
        )}
        <Field label="Format">
          <Select value={v.format} onChange={(e) => set("format", e.target.value as GenValues["format"])}><option value="PDF">PDF</option><option value="Excel">Excel</option></Select>
        </Field>
      </div>
    </Modal>
  );
}

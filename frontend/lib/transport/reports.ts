/**
 * Report previews (Master Prompt §7.13). The figures are calculated by the
 * backend from stored records (GET transport-reports/<key>/); this module turns
 * that table into preview cells and builds the PDF / Excel downloads.
 */
import { type ApiReport } from "./api";
import { fmtDate, inr, num } from "./format";
import { T } from "@/components/transport/ui/tokens";

export interface Cell { text: string; color?: string; bold?: boolean }
export interface PreviewColumn { header: string; numeric?: boolean }
export interface ReportPreview {
  sub: string;
  stats: { label: string; value: string }[];
  columns: PreviewColumn[];
  rows: Cell[][];
  totals: string[];
  notes: string[];
}

const TONE_COLOR: Record<string, string> = { ok: T.green, warn: T.warn, danger: T.red };
const NUMERIC = new Set(["int", "money", "percent", "km"]);

/** Formats one value by the column kind the API sends ("—" when there is no value). */
export function formatValue(value: unknown, kind: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  switch (kind) {
    case "money": return inr(n);
    case "percent": return `${Math.round(n)}%`;
    case "km": return `${num(n)} km`;
    case "int": return num(n);
    case "date": return fmtDate(String(value));
    default: return String(value);
  }
}

export function toPreview(report: ApiReport): ReportPreview {
  // A row's tone colours its last numeric column (utilisation, outstanding, on-time …).
  const reversed = [...report.columns].reverse().findIndex((c) => NUMERIC.has(c.kind));
  const toneCol = reversed < 0 ? 0 : report.columns.length - 1 - reversed;
  return {
    sub: `${report.period} · ${report.scope}`,
    stats: report.stats.map((s) => ({ label: s.label, value: formatValue(s.value, s.kind) })),
    columns: report.columns.map((c) => ({ header: c.header, numeric: NUMERIC.has(c.kind) })),
    rows: report.rows.map((row) => {
      const tone = typeof row._tone === "string" ? TONE_COLOR[row._tone] : undefined;
      return report.columns.map((c, i) => ({
        text: formatValue(row[c.key], c.kind),
        ...(tone && i === toneCol ? { color: tone, bold: true } : {}),
      }));
    }),
    totals: report.columns.map((c) => {
      const v = report.totals[c.key];
      if (v === undefined) return "";
      return typeof v === "string" && !NUMERIC.has(c.kind) ? v : formatValue(v, c.kind);
    }),
    notes: report.notes ?? [],
  };
}

// ─── Files ───────────────────────────────────────────────────────────────────

function matrix(p: ReportPreview): string[][] {
  return [p.columns.map((col) => col.header), ...p.rows.map((r) => r.map((x) => x.text)), p.totals];
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/** Real XLSX via the repo's `xlsx` package (loaded on demand). */
export async function downloadXlsx(name: string, p: ReportPreview) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.aoa_to_sheet([[name], [p.sub], [], ...matrix(p)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, `${slug(name)}.xlsx`);
}

/** Real PDF via the repo's `jspdf` package (loaded on demand); plain text table. */
export async function downloadPdf(name: string, p: ReportPreview) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const left = 36;
  let y = 44;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(name, left, y);
  // jsPDF's base fonts lack ₹ and en dash glyphs; substitute readable equivalents.
  const clean = (s: string) => s.replace(/₹/g, "Rs ").replace(/[–—]/g, "-").replace(/[−]/g, "-").replace(/•/g, "*");
  y += 18; doc.setFont("helvetica", "normal"); doc.setFontSize(10); doc.text(clean(p.sub), left, y);
  y += 16; doc.text(clean(p.stats.map((s) => `${s.label}: ${s.value}`).join("    ")), left, y);
  const rows = matrix(p);
  const width = 770 / rows[0].length;
  y += 24;
  rows.forEach((r, ri) => {
    if (y > 560) { doc.addPage(); y = 44; }
    doc.setFont("helvetica", ri === 0 || ri === rows.length - 1 ? "bold" : "normal");
    r.forEach((cell, ci) => doc.text(clean(cell).slice(0, 28), left + ci * width, y));
    y += 16;
  });
  doc.setFontSize(8);
  doc.text("Figures are calculated from the Transport module's stored records.", left, Math.min(y + 12, 580));
  doc.save(`${slug(name)}.pdf`);
}

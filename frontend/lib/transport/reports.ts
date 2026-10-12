/**
 * Report preview tables (Master Prompt §7.13). The §7.13 formulas are applied
 * to the shared store's live inputs — routes, stops, buses, crews, allocated
 * students and fares — so edits elsewhere in the module flow into the reports.
 */
import { inr, num } from "./format";
import type { TransportData } from "./mock";

export interface Cell { text: string; color?: string; bold?: boolean }
export interface PreviewColumn { header: string; numeric?: boolean }
export interface ReportPreview {
  sub: string;
  stats: { label: string; value: string }[];
  columns: PreviewColumn[];
  rows: Cell[][];
  totals: string[];
}
export interface ReportScope { routeCode: string | null; shift: string; label: string }

const c = (text: string | number, extra: Partial<Cell> = {}): Cell => ({ text: String(text), ...extra });
const pct = (n: number) => `${Math.round(n)}%`;
const GREEN = "#059669";
const AMBER = "#B45309";
const RED = "#E0463A";
const PURPLE = "#6D4AFF";
const MAINT = [8450, 6200, 2400, 7800, 3600, 18500, 1900, 1500, 1200];

export function buildPreview(name: string, state: TransportData, scope: ReportScope): ReportPreview {
  // Route buses in canonical order; i is the route's position (drives the §7.13 formulas).
  const all = state.routes.map((route, i) => ({ route, i, stopStudents: route.stops.reduce((s, x) => s + x.students, 0) }));
  const rows = scope.routeCode ? all.filter((x) => x.route.code === scope.routeCode) : all;
  const allocated = (code: string) => state.students.filter((s) => s.status === "Allocated" && s.routeCode === code);

  switch (name) {
    case "Route-wise strength": {
      const students = rows.reduce((s, x) => s + x.stopStudents, 0);
      const stops = rows.reduce((s, x) => s + x.route.stops.length, 0);
      const util = (n: number) => (n / (42 * 1.4)) * 100;
      return {
        sub: scope.label,
        stats: [
          { label: "Students", value: num(students) }, { label: "Stops", value: num(stops) },
          { label: "Avg utilisation", value: pct(rows.length ? (students / (rows.length * 42 * 1.4)) * 100 : 0) },
        ],
        columns: [{ header: "Route" }, { header: "Bus" }, { header: "Stops", numeric: true }, { header: "Students", numeric: true }, { header: "Seats / shift", numeric: true }, { header: "Utilisation", numeric: true }],
        rows: rows.map(({ route, stopStudents }) => {
          const u = util(stopStudents);
          return [c(`${route.code} · ${route.name}`), c(route.busReg), c(route.stops.length), c(stopStudents), c(42),
            c(pct(u), { bold: true, color: u > 95 ? RED : u > 80 ? AMBER : GREEN })];
        }),
        totals: ["Total", "", num(stops), num(students), num(rows.length * 42), pct(rows.length ? (students / (rows.length * 42 * 1.4)) * 100 : 0)],
      };
    }
    case "Vehicle utilisation": {
      const data = rows.map(({ route, i, stopStudents }) => ({ route, used: Math.round(stopStudents / 1.4), km: 640 + i * 37, idle: i % 3 }));
      const km = data.reduce((s, x) => s + x.km, 0);
      const idle = data.reduce((s, x) => s + x.idle, 0);
      const used = data.reduce((s, x) => s + x.used, 0);
      return {
        sub: scope.label,
        stats: [{ label: "Km run MTD", value: `${num(km)} km` }, { label: "Idle days", value: num(idle) }, { label: "Vehicles", value: num(data.length) }],
        columns: [{ header: "Vehicle" }, { header: "Route" }, { header: "Seats used", numeric: true }, { header: "Km MTD", numeric: true }, { header: "Idle days", numeric: true }, { header: "Utilisation", numeric: true }],
        rows: data.map((x) => [c(x.route.busReg), c(`${x.route.code} · ${x.route.name}`), c(`${x.used} / 42`), c(num(x.km)), c(x.idle), c(pct((x.used / 42) * 100), { bold: true })]),
        totals: ["Total", "", `${num(used)} / ${num(data.length * 42)}`, num(km), num(idle), pct(data.length ? (used / (data.length * 42)) * 100 : 0)],
      };
    }
    case "Transport fee collection": {
      const data = rows.map(({ route, i }) => {
        const st = allocated(route.code);
        const billed = st.reduce((s, x) => s + x.fare, 0);
        const rate = 0.9 + (i % 4) * 0.025;
        const collected = Math.round(billed * rate);
        return { route, students: st.length, billed, collected, outstanding: billed - collected, defaulters: Math.round(st.length * (1 - rate)) };
      });
      const sum = (k: "students" | "billed" | "collected" | "outstanding" | "defaulters") => data.reduce((s, x) => s + x[k], 0);
      const billed = sum("billed");
      return {
        sub: `October 2026 · ${scope.label}`,
        stats: [{ label: "Billed", value: inr(billed) }, { label: "Collected", value: inr(sum("collected")) }, { label: "Collection rate", value: pct(billed ? (sum("collected") / billed) * 100 : 0) }],
        columns: [{ header: "Route" }, { header: "Students", numeric: true }, { header: "Billed", numeric: true }, { header: "Collected", numeric: true }, { header: "Outstanding", numeric: true }, { header: "Defaulters", numeric: true }],
        rows: data.map((x) => [c(`${x.route.code} · ${x.route.name}`), c(x.students), c(inr(x.billed)), c(inr(x.collected)), c(inr(x.outstanding), { bold: true, color: RED }), c(x.defaulters)]),
        totals: ["Total", num(sum("students")), inr(billed), inr(sum("collected")), inr(sum("outstanding")), num(sum("defaulters"))],
      };
    }
    case "Driver duty roster": {
      const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const HOURS: Record<string, number> = { "AM + PM": 7, AM: 3.5, Relief: 4, Leave: 0 };
      let relief = 0;
      let leave = 0;
      const data = rows.map(({ route, i }) => {
        const cells = DAYS.map((_, j) => ((i * 3 + j) % 11 === 0 ? "Leave" : (i + j) % 9 === 0 ? "Relief" : j === 5 ? "AM" : "AM + PM"));
        relief += cells.filter((x) => x === "Relief").length;
        leave += cells.filter((x) => x === "Leave").length;
        return { route, cells, hours: cells.reduce((s, x) => s + HOURS[x], 0) };
      });
      return {
        sub: "Week of 05 Oct 2026 · all shifts",
        stats: [{ label: "Drivers rostered", value: num(data.length) }, { label: "Relief shifts", value: num(relief) }, { label: "On leave", value: num(leave) }],
        columns: [{ header: "Driver" }, { header: "Route" }, ...DAYS.map((d) => ({ header: d })), { header: "Hours", numeric: true }],
        rows: data.map((x) => [c(x.route.driverName), c(`${x.route.code} · ${x.route.name}`),
          ...x.cells.map((v) => c(v, v === "Leave" ? { color: AMBER, bold: true } : v === "Relief" ? { color: PURPLE, bold: true } : {})),
          c(x.hours, { bold: true })]),
        totals: ["Total", "", "", "", "", "", "", "", String(data.reduce((s, x) => s + x.hours, 0))],
      };
    }
    case "Daily boarding register": {
      const data = rows.map(({ route, i }) => {
        const alloc = allocated(route.code).length;
        const noShow = Math.min(alloc, route.code === "R3" ? 5 : i % 3);
        const boarded = alloc - noShow;
        const late = Math.min(boarded, 2 + (i % 4));
        return { route, alloc, boarded, noShow, late };
      });
      const sum = (k: "alloc" | "boarded" | "noShow" | "late") => data.reduce((s, x) => s + x[k], 0);
      const onTime = (b: number, l: number, a: number) => pct(a ? ((b - l) / a) * 100 : 0);
      return {
        sub: `${scope.label} · 06 Oct 2026 · morning pickup`,
        stats: [{ label: "Boarded", value: num(sum("boarded")) }, { label: "No-show", value: num(sum("noShow")) }, { label: "Late", value: num(sum("late")) }],
        columns: [{ header: "Bus" }, { header: "Route" }, { header: "Allocated", numeric: true }, { header: "Boarded", numeric: true }, { header: "No-show", numeric: true }, { header: "Late", numeric: true }, { header: "On time %", numeric: true }],
        rows: data.map((x) => [c(x.route.busReg), c(`${x.route.code} · ${x.route.name}`), c(x.alloc), c(x.boarded, { bold: true, color: GREEN }),
          c(x.noShow, x.noShow > 0 ? { color: RED, bold: true } : {}), c(x.late, { color: AMBER }), c(onTime(x.boarded, x.late, x.alloc))]),
        totals: ["Total", "", num(sum("alloc")), num(sum("boarded")), num(sum("noShow")), num(sum("late")), onTime(sum("boarded"), sum("late"), sum("alloc"))],
      };
    }
    case "Fuel & maintenance cost":
    default: {
      const data = rows.map(({ route, i }) => {
        const fuel = 14000 + i * 820;
        const maint = MAINT[i % 9] + i * 40;
        const students = allocated(route.code).length;
        return { route, fuel, maint, total: fuel + maint, students };
      });
      const fuel = data.reduce((s, x) => s + x.fuel, 0);
      const maint = data.reduce((s, x) => s + x.maint, 0);
      const students = data.reduce((s, x) => s + x.students, 0);
      return {
        sub: `October 2026 MTD · ${scope.label}`,
        stats: [{ label: "Fuel", value: inr(fuel) }, { label: "Maintenance", value: inr(maint) }, { label: "Cost per student", value: inr(students ? (fuel + maint) / students : 0) }],
        columns: [{ header: "Vehicle" }, { header: "Route" }, { header: "Fuel", numeric: true }, { header: "Maintenance", numeric: true }, { header: "Total", numeric: true }, { header: "Per student", numeric: true }],
        rows: data.map((x) => [c(x.route.busReg), c(`${x.route.code} · ${x.route.name}`), c(inr(x.fuel)), c(inr(x.maint)), c(inr(x.total), { bold: true }), c(x.students ? inr(x.total / x.students) : "—")]),
        totals: ["Total", "", inr(fuel), inr(maint), inr(fuel + maint), inr(students ? (fuel + maint) / students : 0)],
      };
    }
  }
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
  doc.text("Figures come from the Transport module's live records.", left, Math.min(y + 12, 580));
  doc.save(`${slug(name)}.pdf`);
}

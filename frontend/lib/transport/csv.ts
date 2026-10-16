/** Client-side CSV export for Transport list pages (Master Prompt §5). */

export interface CsvColumn<T> { header: string; value: (row: T) => string | number }

function escape(v: string | number): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]): void {
  const lines = [columns.map((c) => escape(c.header)).join(","), ...rows.map((r) => columns.map((c) => escape(c.value(r))).join(","))];
  // BOM so Excel opens ₹ and • correctly.
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

"use client";

import type { ReactNode } from "react";
import { Btn, inputStyle } from "../catalogue/ui";

export const cardStyle = {
  background: "var(--bg-1)",
  border: "1px solid var(--bd)",
  borderRadius: 12,
  padding: "4px 8px",
  overflowX: "auto",
} as const;

export function SectionHeader({ title, hint, actions }: { title: string; hint?: string; actions?: ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", margin: "28px 0 10px" }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--ink-1)" }}>{title}</h2>
        {hint ? <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--ink-3)" }}>{hint}</p> : null}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>
    </div>
  );
}

export function Pager({
  count, page, pageSize, loading, noun, onPage, onPageSize,
}: {
  count: number; page: number; pageSize: number; loading: boolean; noun: string;
  onPage: (page: number) => void; onPageSize: (size: number) => void;
}) {
  if (count === 0) return null;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, fontSize: 13, color: "var(--ink-2)", flexWrap: "wrap" }}>
      <span>{count} {noun}{count === 1 ? "" : "s"}</span>
      <Btn small disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>Previous</Btn>
      <span>Page {page} of {pages}</span>
      <Btn small disabled={page >= pages || loading} onClick={() => onPage(page + 1)}>Next</Btn>
      <label>
        Per page{" "}
        <select aria-label={`${noun} page size`} value={pageSize} onChange={(e) => { onPageSize(Number(e.target.value)); onPage(1); }} style={{ ...inputStyle, width: 70, height: 30, display: "inline-block" }}>
          {[10, 25, 50].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function FormAlert({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
      {text}
    </div>
  );
}

/** First message for a field from a LibraryApiError's fieldErrors, if any. */
export function firstError(fieldErrors: Record<string, string[]> | undefined, name: string): string | undefined {
  return fieldErrors?.[name]?.[0];
}

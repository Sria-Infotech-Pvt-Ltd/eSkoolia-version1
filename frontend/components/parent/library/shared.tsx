"use client";

import type { CSSProperties, ReactNode } from "react";
import { useParentChild } from "@/contexts/ParentChildContext";

/* Pieces shared by the two parent library pages. The frame and the child switch copy the Homework page. */

export const card: CSSProperties = { border: "1px solid var(--bd)", borderRadius: 14, padding: "16px 18px", background: "var(--bg-1)" };

export function Frame({ title, accent, subtitle, children }: { title: string; accent: string; subtitle: string; children: ReactNode }) {
  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 18, boxShadow: "var(--sh-1)", padding: "28px 30px" }}>
      <div style={{ marginBottom: 22, paddingBottom: 20, borderBottom: "1px solid var(--bd)" }}>
        <h1 style={{ fontSize: 34, fontWeight: 600, color: "var(--ink-1)", margin: "0 0 5px", lineHeight: 1.05, letterSpacing: "-0.03em", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          {title}{" "}
          <em style={{ fontFamily: "var(--font-instrument-serif,'Instrument Serif',Georgia,serif)", fontWeight: 400, fontStyle: "italic", color: "var(--ok)", fontSize: 38, letterSpacing: "-0.02em" }}>{accent}</em>
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.55 }}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

/** Pills for choosing which child to look at. Shown only when the guardian has more than one. */
export function ChildSwitch() {
  const { children, selectedChild, setSelectedChildId } = useParentChild();
  if (children.length <= 1) return null;
  return (
    <div role="group" aria-label="Choose a child" style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
      {children.map((c) => {
        const sel = c.id === selectedChild?.id;
        const initials = c.name.split(" ").filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={sel}
            onClick={() => setSelectedChildId(c.id)}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 16px", borderRadius: 24, border: `1.5px solid ${sel ? "var(--pu)" : "var(--bd)"}`, background: sel ? "var(--pu-soft)" : "var(--bg-1)", color: sel ? "var(--pu)" : "var(--ink-2)", fontSize: 13, fontWeight: sel ? 600 : 400, cursor: "pointer" }}
          >
            <div style={{ width: 20, height: 20, borderRadius: "50%", background: sel ? "var(--pu)" : "var(--pu-soft)", color: sel ? "var(--bg-1)" : "var(--pu)", display: "grid", placeItems: "center", fontSize: 9, fontWeight: 700 }}>{initials}</div>
            <span>{c.name.split(" ")[0]}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Skeletons({ rows = 3, h = 92 }: { rows?: number; h?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height: h, borderRadius: 8, background: "var(--bg-2)" }} />
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" style={{ background: "var(--bg-2)", border: "1px solid var(--bd)", borderRadius: 12, padding: 40, textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>{title}</div>
      {children ? <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{children}</div> : null}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ background: "var(--danger-soft)", borderRadius: 10, padding: "12px 16px", color: "var(--danger)", fontSize: 13, marginBottom: 20, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span>{message}</span>
      <button type="button" onClick={onRetry} style={{ border: "1px solid var(--danger)", background: "transparent", color: "var(--danger)", borderRadius: 8, padding: "4px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Try again</button>
    </div>
  );
}

type Tone = "ok" | "warn" | "danger" | "neutral";
const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  neutral: { bg: "var(--bg-2)", fg: "var(--ink-3)" },
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const { bg, fg } = TONES[tone];
  return <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, color: fg, background: bg, padding: "3px 10px", borderRadius: 20, whiteSpace: "nowrap" }}>{children}</span>;
}

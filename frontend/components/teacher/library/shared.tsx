"use client";

import type { CSSProperties, ReactNode } from "react";

/* Small pieces shared by the three teacher library pages. Colours come from styles/tokens.css only. */

export const card: CSSProperties = { background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 14, padding: 18 };
export const th: CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: 11, fontWeight: 700, color: "var(--ink-3)", borderBottom: "1px solid var(--bd-2)", whiteSpace: "nowrap" };
export const td: CSSProperties = { padding: "10px", fontSize: 13, color: "var(--ink-1)", borderBottom: "1px solid var(--bd)", verticalAlign: "middle" };
export const input: CSSProperties = { width: "100%", height: 38, border: "1px solid var(--bd-2)", borderRadius: 8, padding: "0 10px", background: "var(--bg-1)", color: "var(--ink-1)", fontSize: 13 };

export function Page({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "20px 24px 40px" }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: "var(--ink-1)" }}>{title}</h1>
      <p style={{ margin: "4px 0 18px", fontSize: 13, color: "var(--ink-3)" }}>{subtitle}</p>
      {children}
    </div>
  );
}

export function Skeleton({ h = 16 }: { h?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ height: h, width: "100%", borderRadius: 8, background: "var(--bg-3)", animation: "libpulse 1.2s ease-in-out infinite" }}>
      <style>{"@keyframes libpulse{0%,100%{opacity:.55}50%{opacity:1}}"}</style>
    </div>
  );
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} h={44} />
      ))}
    </div>
  );
}

export function EmptyBox({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div role="status" style={{ background: "var(--bg-2)", border: "1px solid var(--bd)", borderRadius: 12, padding: "32px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-2)" }}>{title}</div>
      {children ? <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ background: "var(--danger-soft)", borderRadius: 10, padding: "12px 16px", color: "var(--danger)", fontSize: 13, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
      <span>{message}</span>
      <Button small onClick={onRetry}>Try again</Button>
    </div>
  );
}

type Tone = "ok" | "warn" | "danger" | "info" | "neutral";
const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
  neutral: { bg: "var(--bg-3)", fg: "var(--ink-2)" },
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const { bg, fg } = TONES[tone];
  return <span style={{ display: "inline-block", padding: "2px 9px", borderRadius: 999, background: bg, color: fg, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap" }}>{children}</span>;
}

export function Button({ variant = "secondary", small, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary"; small?: boolean }) {
  const look = variant === "primary"
    ? { background: "var(--pu)", color: "var(--bg-1)", border: "1px solid var(--pu)" }
    : { background: "var(--bg-1)", color: "var(--ink-1)", border: "1px solid var(--bd-3)" };
  return (
    <button
      type="button"
      {...props}
      style={{
        ...look, height: small ? 28 : 36, padding: small ? "0 10px" : "0 16px", borderRadius: 8, fontSize: small ? 12 : 13, fontWeight: 600,
        cursor: props.disabled ? "not-allowed" : "pointer", opacity: props.disabled ? 0.55 : 1, whiteSpace: "nowrap", ...props.style,
      }}
    />
  );
}

/** An inline message that says what happened and stays on screen until the next action. */
export function Notice({ tone, children }: { tone: "ok" | "danger"; children: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} style={{ background: tone === "ok" ? "var(--ok-soft)" : "var(--danger-soft)", color: tone === "ok" ? "var(--ok)" : "var(--danger)", borderRadius: 10, padding: "9px 14px", fontSize: 13, marginBottom: 14 }}>
      {children}
    </div>
  );
}

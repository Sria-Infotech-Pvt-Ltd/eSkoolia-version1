"use client";

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { LibraryApiError } from "@/hooks/useLibraryApi";

/* Small presentational primitives for the library screens. Colours come from styles/tokens.css only. */

export const inputStyle = {
  width: "100%",
  height: 36,
  border: "1px solid var(--bd-2)",
  borderRadius: 8,
  padding: "0 10px",
  background: "var(--bg-1)",
  color: "var(--ink-1)",
  fontSize: 13,
} as const;

export const labelStyle = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 } as const;

type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "brand";

const TONES: Record<Tone, { bg: string; fg: string }> = {
  ok: { bg: "var(--ok-soft)", fg: "var(--ok)" },
  warn: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  danger: { bg: "var(--danger-soft)", fg: "var(--danger)" },
  info: { bg: "var(--info-soft)", fg: "var(--info)" },
  neutral: { bg: "var(--bg-3)", fg: "var(--ink-2)" },
  brand: { bg: "var(--pu-soft)", fg: "var(--pu-deep)" },
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  const { bg, fg } = TONES[tone];
  return (
    <span
      style={{
        display: "inline-block", padding: "2px 9px", borderRadius: 999, background: bg, color: fg,
        fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

export function Btn({
  variant = "secondary",
  small,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; small?: boolean }) {
  const styles = {
    primary: { background: "var(--pu)", color: "var(--bg-1)", border: "1px solid var(--pu)" },
    secondary: { background: "var(--bg-1)", color: "var(--ink-1)", border: "1px solid var(--bd-3)" },
    danger: { background: "var(--danger)", color: "var(--bg-1)", border: "1px solid var(--danger)" },
    ghost: { background: "transparent", color: "var(--pu-deep)", border: "1px solid transparent" },
  }[variant];
  return (
    <button
      type="button"
      {...props}
      style={{
        ...styles,
        height: small ? 28 : 36,
        padding: small ? "0 10px" : "0 14px",
        borderRadius: 8,
        fontSize: small ? 12 : 13,
        fontWeight: 600,
        cursor: props.disabled ? "not-allowed" : "pointer",
        opacity: props.disabled ? 0.55 : 1,
        whiteSpace: "nowrap",
        ...props.style,
      }}
    />
  );
}

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>
        {label}
        {children}
      </label>
      {hint && !error ? <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 3 }}>{hint}</div> : null}
      {error ? (
        <div role="alert" style={{ fontSize: 12, color: "var(--danger)", marginTop: 3 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 640,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: "fixed", inset: 0, background: "var(--overlay)", zIndex: 1000,
        display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "40px 12px",
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%", maxWidth: width, background: "var(--bg-1)", borderRadius: 14, boxShadow: "var(--sh-3)",
          border: "1px solid var(--bd)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 18px", borderBottom: "1px solid var(--bd)" }}>
          <h2 style={{ margin: 0, fontSize: 16, color: "var(--ink-1)" }}>{title}</h2>
          <Btn variant="ghost" small onClick={onClose} aria-label="Close">
            Close
          </Btn>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
        {footer ? (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--bd)", display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width={440}
      footer={
        <>
          <Btn onClick={onCancel} disabled={busy}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working..." : confirmLabel}
          </Btn>
        </>
      }
    >
      <p style={{ margin: "0 0 10px", color: "var(--ink-2)", fontSize: 13 }}>{message}</p>
      {children}
    </Modal>
  );
}

export function StateBox({ tone = "neutral", title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  const { bg, fg } = TONES[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} style={{ background: bg, color: fg, borderRadius: 12, padding: "28px 20px", textAlign: "center" }}>
      <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
      {children ? <div style={{ fontSize: 13, marginTop: 6 }}>{children}</div> : null}
    </div>
  );
}

export function SkeletonRows({ rows = 6, columns = 6 }: { rows?: number; columns?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <style>{"@keyframes libpulse{0%,100%{opacity:.55}50%{opacity:1}}"}</style>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 12, padding: "12px 8px", borderBottom: "1px solid var(--bd)" }}>
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} style={{ height: 14, borderRadius: 6, background: "var(--bg-3)", animation: "libpulse 1.2s ease-in-out infinite" }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A readable message for any failure. 503 gets the "temporarily unavailable" copy. */
export function describeError(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof LibraryApiError) {
    if (error.status === 503) return "The library is temporarily unavailable. Please try again in a few seconds.";
    return error.message || fallback;
  }
  const message = (error as { message?: string } | null)?.message;
  return message && message !== "401" ? message : fallback;
}

/** First message of each server field error, keyed by field. */
export function fieldMessages(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (error instanceof LibraryApiError && error.fieldErrors) {
    for (const [field, messages] of Object.entries(error.fieldErrors)) out[field] = messages[0] ?? "";
  }
  return out;
}

export interface ToastState {
  tone: "ok" | "danger";
  text: string;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, tone: ToastState["tone"] = "ok") => {
    setToast({ text, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 5000);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const node = toast ? (
    <div
      role="status"
      style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 1100, maxWidth: 380, padding: "10px 14px", borderRadius: 10,
        boxShadow: "var(--sh-3)", fontSize: 13, fontWeight: 600,
        background: toast.tone === "ok" ? "var(--ok-soft)" : "var(--danger-soft)",
        color: toast.tone === "ok" ? "var(--ok)" : "var(--danger)",
      }}
    >
      {toast.text}
    </div>
  ) : null;
  return { show, node };
}

export function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ display: "inline-block", width: 10, height: 10, borderRadius: 999, background: color, marginRight: 6 }} />;
}

export const thStyle = { textAlign: "left", padding: "8px 8px", fontSize: 11, color: "var(--ink-3)", fontWeight: 700, borderBottom: "1px solid var(--bd-2)", whiteSpace: "nowrap" } as const;
export const tdStyle = { padding: "10px 8px", fontSize: 13, color: "var(--ink-1)", borderBottom: "1px solid var(--bd)", verticalAlign: "middle" } as const;

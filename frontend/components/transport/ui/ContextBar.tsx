"use client";
/**
 * Context bar (Master Prompt §4.9) — the Exam ExamPicker pattern
 * (components/exams/ExamUi.tsx). ExamPicker takes a single select with fixed
 * copy; this variant takes one or two selects and the spec label.
 */
import { T } from "./tokens";

export interface ContextSelect {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export function ContextBar({ icon: Icon, selects, note }: { icon: React.ElementType; selects: ContextSelect[]; note: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, background: "#fff", border: `1px solid ${T.exBd}`,
      borderRadius: 12, padding: "12px 16px", marginBottom: 16,
    }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <Icon size={14} color={T.exPu} strokeWidth={1.8} />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.exInk3, whiteSpace: "nowrap" }}>
          Now viewing data for
        </span>
      </span>
      {selects.map((s) => (
        <select key={s.label} aria-label={s.label} value={s.value} onChange={(e) => s.onChange(e.target.value)}
          style={{ height: 34, borderRadius: 8, border: `1px solid ${T.exBdStrong}`, padding: "0 8px", fontSize: 13, fontWeight: 600, color: T.exInk1, background: "#fff" }}>
          {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ))}
      <span style={{ fontSize: 11.5, fontWeight: 600, color: T.exPu, flex: "1 1 200px" }}>{note}</span>
    </div>
  );
}

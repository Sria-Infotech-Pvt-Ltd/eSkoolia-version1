"use client";
/**
 * Simple accordion (Master Prompt §4.26) — the Exam Accordion pattern
 * (components/exams/ExamUi.tsx). That one is uncontrolled and rotates its
 * chevron 180°; Settings needs collapse/expand-all and search-to-expand, so this
 * variant is controlled, adds the description line and uses the −90° chevron.
 */
import { ChevronDown } from "lucide-react";
import { T } from "./tokens";

export function SimpleAccordion({
  icon: Icon, title, description, right, open, onToggle, children,
}: {
  icon: React.ElementType; title: string; description?: string; right?: React.ReactNode;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.exBd}`, borderRadius: 12, overflow: "hidden" }}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="tp-link-reset"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "12px 16px" }}>
        <Icon size={14} color={T.exPu} strokeWidth={1.8} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: T.exInk1 }}>{title}</span>
          {description && <span style={{ display: "block", fontSize: 11.5, color: T.exInk2, marginTop: 2 }}>{description}</span>}
        </span>
        {right}
        <ChevronDown size={15} color={T.exInk2} strokeWidth={2} style={{ flexShrink: 0, transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
      </button>
      {open && <div style={{ borderTop: `1px solid ${T.exBd}`, padding: 14 }}>{children}</div>}
    </div>
  );
}

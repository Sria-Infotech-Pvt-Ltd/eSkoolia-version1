"use client";
/**
 * Buttons, badges, chips and pills (Master Prompt §4.1, §4.2).
 * Modal / drawer buttons reuse HrButton (primary / ghost / soft / red) as-is;
 * HrBadge is wrapped to add the spec's slate tone.
 */
import { Download, Plus } from "lucide-react";
import { HrBadge } from "@/components/hr/HrUi";
import { T } from "./tokens";

export { HrButton as Button } from "@/components/hr/HrUi";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export function HeroPrimary({ children, icon = true, ...rest }: BtnProps & { icon?: boolean }) {
  return (
    <button type="button" className="tp-btn-hero" {...rest}>
      {icon && <Plus size={15} strokeWidth={2} />}
      {children}
    </button>
  );
}

export function HeroSecondary({ children, download = true, ...rest }: BtnProps & { download?: boolean }) {
  return (
    <button type="button" className="tp-btn-hero2" {...rest}>
      {download && <Download size={15} strokeWidth={1.8} />}
      {children}
    </button>
  );
}

export function OutlineButton({ children, ...rest }: BtnProps) {
  return <button type="button" className="tp-btn-outline" {...rest}>{children}</button>;
}

export function RowIconButton({ label, children, ...rest }: BtnProps & { label: string }) {
  return <button type="button" className="tp-btn-row" aria-label={label} title={label} {...rest}>{children}</button>;
}

export function ExportChip(props: BtnProps) {
  return <button type="button" className="tp-chip-export" {...props}>↓ Export</button>;
}

// ─── Badges & chips ──────────────────────────────────────────────────────────

export type Tone = "purple" | "green" | "red" | "amber" | "blue" | "grey" | "slate";

const HR_VARIANT: Record<Exclude<Tone, "slate">, "purple" | "green" | "red" | "amber" | "blue" | "grey"> = {
  purple: "purple", green: "green", red: "red", amber: "amber", blue: "blue", grey: "grey",
};

/** HrBadge plus the slate tone (§4.2). */
export function Badge({ tone = "grey", children }: { tone?: Tone; children: React.ReactNode }) {
  if (tone === "slate") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 999, padding: "3px 8px", fontSize: 11, fontWeight: 850, whiteSpace: "nowrap", background: T.surface2, color: T.inkChip }}>
        {children}
      </span>
    );
  }
  return <HrBadge variant={HR_VARIANT[tone]}>{children}</HrBadge>;
}

const CHIP_COLORS: Record<Tone, [string, string]> = {
  purple: [T.puSoft, T.pu],
  green: [T.greenSoft, T.green],
  red: [T.redSoft, T.red],
  amber: [T.amberSoft, T.amber],
  blue: ["#eff6ff", T.info],
  grey: [T.greySoft, T.grey],
  slate: [T.surface2, T.inkChip],
};

/** Meta chip used in the filter header and accordion headers. */
export function Chip({ tone = "slate", children }: { tone?: Tone; children: React.ReactNode }) {
  const [bg, color] = CHIP_COLORS[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: bg, color, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function IdPill({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span className={mono ? "tp-mono" : undefined} style={{ display: "inline-flex", padding: "4px 8px", borderRadius: 6, background: T.surface2, fontSize: 11.5, fontWeight: 700, letterSpacing: "0.04em", color: T.ink, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

export function Plate({ children, size = 12.5 }: { children: React.ReactNode; size?: number }) {
  return <span className="tp-mono" style={{ fontSize: size, fontWeight: 700, letterSpacing: "0.02em", color: T.ink, whiteSpace: "nowrap" }}>{children}</span>;
}

export function RhythmPill({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.exInk3, border: `1px solid ${T.exBdStrong}`, borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** Status → tone map (§4.2). */
export function statusTone(status: string): Tone {
  const s = status.toLowerCase();
  if (["active", "on duty", "allocated", "completed", "normal", "published", "resolved", "boarded"].includes(s)) return "green";
  if (["on route", "in transit", "scheduled"].includes(s)) return "blue";
  if (["idle", "off duty", "inactive", "waitlisted"].includes(s)) return "grey";
  if (["under maintenance", "due soon", "on leave", "pending", "in workshop", "expiring"].includes(s)) return "amber";
  if (["breakdown", "overdue", "expired", "running late", "overspeed", "anomaly", "not boarded", "open alert"].includes(s)) return "red";
  if (s === "acknowledged") return "purple";
  return "grey";
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={statusTone(status)}>{status}</Badge>;
}

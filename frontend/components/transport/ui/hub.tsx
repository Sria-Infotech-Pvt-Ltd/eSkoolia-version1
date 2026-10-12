"use client";
/**
 * Hub surfaces from the Examination Command Center
 * (app/(dashboard)/exams/command-center/page.tsx): breadcrumb, StatTile,
 * ModuleCard, Needs-attention item, Quick-action row. Those are private to that
 * page, so they are rebuilt here to the same spec (Master Prompt §4.3, §4.6–§4.8).
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { RhythmPill } from "./controls";
import { T } from "./tokens";

export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 14, flexWrap: "wrap" }}>
      {items.map((it, i) => (
        <span key={it.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span style={{ color: T.exInk3 }}>/</span>}
          {it.href ? (
            <Link href={it.href} style={{ color: T.exInk2, textDecoration: "none" }}>{it.label}</Link>
          ) : (
            <span aria-current="page" style={{ color: T.exInk1, fontWeight: 600 }}>{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export type StatTone = "neutral" | "ok" | "danger" | "warn";
const STAT_TONE: Record<StatTone, { chip: string; icon: string; value: string }> = {
  neutral: { chip: T.exPuSoft, icon: T.exPu, value: T.exInk1 },
  ok: { chip: T.okSoft, icon: T.ok, value: T.exInk1 },
  danger: { chip: T.dangerSoft, icon: T.danger, value: T.danger },
  warn: { chip: T.warnSoft, icon: T.warn, value: T.warn },
};

export function StatTile({
  icon: Icon, label, value, note, tone = "neutral", loading,
}: { icon: React.ElementType; label: string; value: string; note: string; tone?: StatTone; loading?: boolean }) {
  const c = STAT_TONE[tone];
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.exBd}`, borderRadius: 14, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      {loading ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div className="tp-skel" style={{ width: 110, height: 10 }} />
            <div className="tp-skel" style={{ width: 28, height: 28 }} />
          </div>
          <div className="tp-skel" style={{ width: 90, height: 40 }} />
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.exInk2 }}>{label}</span>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: c.chip, display: "grid", placeItems: "center", flexShrink: 0 }}>
              <Icon size={13} color={c.icon} strokeWidth={2} />
            </span>
          </div>
          <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, color: c.value }}>{value}</div>
          <div style={{ fontSize: 12, lineHeight: 1.4, color: T.exInk2 }}>{note}</div>
        </>
      )}
    </div>
  );
}

export type Dot = "ok" | "warn" | "danger";
const DOT: Record<Dot, string> = { ok: T.dotOk, warn: T.dotWarn, danger: T.dotDanger };

export interface ModuleCta { label: string; href: string; variant: "primary" | "danger" | "outline" }

export function ModuleCard({
  icon: Icon, rhythm, title, dot, description, ctas, span2,
}: {
  icon: React.ElementType; rhythm: string; title: string; dot: Dot; description: string; ctas: ModuleCta[]; span2?: boolean;
}) {
  return (
    <div className={span2 ? "tp-span2" : undefined} style={{
      background: "#fff", border: `1px solid ${T.exBd}`, borderRadius: 16, padding: 22, display: "flex", flexDirection: "column",
      gap: 14, boxShadow: T.shadow1,
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <span style={{ width: 36, height: 36, borderRadius: 10, background: T.exPuSoft, display: "grid", placeItems: "center" }}>
          <Icon size={17} color={T.exPu} strokeWidth={1.8} />
        </span>
        <RhythmPill>{rhythm}</RhythmPill>
      </div>
      <div>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.exInk1, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: T.exInk2 }}>
          <span aria-hidden style={{ color: DOT[dot], marginRight: 6 }}>●</span>
          {description}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: "auto" }}>
        {ctas.map((c) => (
          <Link key={c.label} href={c.href} className={`tp-cta tp-cta--${c.variant}`}>{c.label}</Link>
        ))}
      </div>
    </div>
  );
}

export type AttnTone = "danger" | "warn" | "info" | "resolved";
const ATTN: Record<AttnTone, [string, string]> = {
  danger: [T.danger, T.dangerSoft],
  warn: [T.warn, T.warnSoft],
  info: [T.info, T.infoSoft],
  resolved: [T.muted, T.surface2],
};

export function AttentionItem({
  icon: Icon, tone, title, sub, href, onClick, trailing,
}: {
  icon: React.ElementType; tone: AttnTone; title: string; sub: string; href: string; onClick?: () => void;
  trailing?: React.ReactNode;
}) {
  const [color, bg] = ATTN[tone];
  return (
    <Link href={href} onClick={onClick} className="tp-attn" style={{ borderLeft: `3px solid ${color}`, background: bg, alignItems: "flex-start" }}>
      <Icon size={15} color={color} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 1 }} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: T.exInk1, lineHeight: 1.35 }}>{title}</span>
        <span style={{ display: "block", fontSize: 11, color: T.exInk2, marginTop: 2 }}>{sub}</span>
      </span>
      {trailing}
    </Link>
  );
}

export function QuickAction({ icon: Icon, label, href }: { icon: React.ElementType; label: string; href: string }) {
  return (
    <Link href={href} className="tp-qa">
      <Icon size={14} color={T.exPu} strokeWidth={1.8} />
      <span style={{ flex: 1 }}>{label}</span>
      <ChevronRight size={12} color={T.exInk3} strokeWidth={2} />
    </Link>
  );
}

/** White sidebar card used on the Dashboard right column. */
export function SideCard({ children }: { children: React.ReactNode }) {
  return <div style={{ background: "#fff", border: `1px solid ${T.exBd}`, borderRadius: 14, padding: 16 }}>{children}</div>;
}

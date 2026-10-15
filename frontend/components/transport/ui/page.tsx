"use client";
/** Page frame, hero, KPI card and mount skeleton (Master Prompt §3.3, §4.4, §4.10, §4.22). */
import { useEffect, useState } from "react";
import { useTransportSection } from "./sectionContext";
import { T } from "./tokens";

/**
 * HR/Exam page frame: #FAFAFB wrapper → #f8f8fc framed card → 1400px inner.
 * Inside a combined page (TransportSections) the frame is already drawn, so a
 * section's own TransportPage renders its content only.
 */
export function TransportPage({ hub, compact, children }: {
  hub?: boolean;
  /** Less wrapper/frame padding (Drivers / Attendants). */
  compact?: boolean;
  children: React.ReactNode;
}) {
  const section = useTransportSection();
  if (section) return <>{children}</>;
  return (
    <div className={compact ? "tp-wrap tp-wrap--compact" : "tp-wrap"}>
      <div className={hub ? "tp-frame tp-frame--hub" : compact ? "tp-frame tp-frame--compact" : "tp-frame"}>
        <div className="tp-inner">{children}</div>
      </div>
    </div>
  );
}

/** HR-directory hero: eyebrow, Playfair H1 (roman + italic purple), sub-copy, actions. */
export function PageHero({
  eyebrow, title, accent, sub, actions, eyebrowAddon, compact,
}: {
  eyebrow: string; title: string; accent: string; sub: string; actions?: React.ReactNode;
  /** Extra element on the eyebrow row (e.g. the Live Tracking "LIVE" pill). */
  eyebrowAddon?: React.ReactNode;
  /** Tighter margins (Drivers / Attendants); typography is unchanged. */
  compact?: boolean;
}) {
  // A lower section of a combined page gets a smaller <h2> heading; the page keeps one <h1>.
  const sub2 = useTransportSection()?.primary === false;
  const Heading = sub2 ? "h2" : "h1";
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: compact ? 12 : 16, marginBottom: compact ? 12 : 18 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: compact ? 4 : 8 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted }}>{eyebrow}</p>
          {eyebrowAddon}
        </div>
        <Heading className="tp-serif" style={{ margin: 0, fontSize: sub2 ? 28 : 40, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
          {title}{" "}
          <span className="tp-serif" style={{ fontStyle: "italic", fontWeight: 400, color: T.pu }}>{accent}</span>
        </Heading>
        <p style={{ margin: compact ? "6px 0 0" : "10px 0 0", fontSize: 14, color: T.muted, maxWidth: compact ? 1000 : 640, lineHeight: 1.55 }}>{sub}</p>
      </div>
      {actions && <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}

/** True for the first `ms` after mount — drives KPI / stat-tile skeletons. */
export function useMountSkeleton(ms = 400): boolean {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return loading;
}

export function KpiCard({
  label, value, sub, color = T.ink, loading, compact,
}: { label: string; value: React.ReactNode; sub?: string; color?: string; loading?: boolean; compact?: boolean }) {
  return (
    <div className="tp-card" style={{ padding: compact ? "12px 14px" : 14, minHeight: compact ? 0 : 96 }}>
      {loading ? (
        <>
          <div className="tp-skel" style={{ width: 96, height: 10 }} />
          <div className="tp-skel" style={{ width: 70, height: 34, marginTop: compact ? 8 : 12 }} />
        </>
      ) : compact ? (
        // Value and sub-text share one row (wrapping on narrow cards); sizes unchanged.
        <>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: T.grey, fontWeight: 850 }}>{label}</div>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "4px 10px", marginTop: 8 }}>
            <div style={{ fontSize: 34, fontWeight: 850, lineHeight: 1, color }}>{value}</div>
            {sub && <div style={{ fontSize: 12, color: T.muted, minWidth: 0 }}>{sub}</div>}
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: T.grey, fontWeight: 850 }}>{label}</div>
          <div style={{ fontSize: 34, fontWeight: 850, lineHeight: 1, marginTop: 10, color }}>{value}</div>
          {sub && <div style={{ fontSize: 12, color: T.muted, marginTop: 8 }}>{sub}</div>}
        </>
      )}
    </div>
  );
}

export function KpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="tp-kpi-grid">{children}</div>;
}

/** Centred empty/notice line (§4.13). */
export function EmptyLine({ children, compact }: { children: React.ReactNode; compact?: boolean }) {
  return <div style={{ padding: compact ? "12px 0" : "32px 0", textAlign: "center", fontSize: 13, color: T.muted }}>{children}</div>;
}

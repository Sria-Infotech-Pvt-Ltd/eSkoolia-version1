"use client";
/** Page frame, hero, KPI card and mount skeleton (Master Prompt §3.3, §4.4, §4.10, §4.22). */
import { useEffect, useState } from "react";
import { T } from "./tokens";

/** HR/Exam page frame: #FAFAFB wrapper → #f8f8fc framed card → 1400px inner. */
export function TransportPage({ hub, children }: { hub?: boolean; children: React.ReactNode }) {
  return (
    <div className="tp-wrap">
      <div className={hub ? "tp-frame tp-frame--hub" : "tp-frame"}>
        <div className="tp-inner">{children}</div>
      </div>
    </div>
  );
}

/** HR-directory hero: eyebrow, Playfair H1 (roman + italic purple), sub-copy, actions. */
export function PageHero({
  eyebrow, title, accent, sub, actions, eyebrowAddon,
}: {
  eyebrow: string; title: string; accent: string; sub: string; actions?: React.ReactNode;
  /** Extra element on the eyebrow row (e.g. the Live Tracking "LIVE" pill). */
  eyebrowAddon?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 18 }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.muted }}>{eyebrow}</p>
          {eyebrowAddon}
        </div>
        <h1 className="tp-serif" style={{ margin: 0, fontSize: 40, lineHeight: 1.1, fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
          {title}{" "}
          <span className="tp-serif" style={{ fontStyle: "italic", fontWeight: 400, color: T.pu }}>{accent}</span>
        </h1>
        <p style={{ margin: "10px 0 0", fontSize: 14, color: T.muted, maxWidth: 640, lineHeight: 1.55 }}>{sub}</p>
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
  label, value, sub, color = T.ink, loading,
}: { label: string; value: React.ReactNode; sub?: string; color?: string; loading?: boolean }) {
  return (
    <div className="tp-card" style={{ padding: 14, minHeight: 96 }}>
      {loading ? (
        <>
          <div className="tp-skel" style={{ width: 96, height: 10 }} />
          <div className="tp-skel" style={{ width: 70, height: 34, marginTop: 12 }} />
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
export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: T.muted }}>{children}</div>;
}

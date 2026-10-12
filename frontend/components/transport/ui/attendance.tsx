"use client";
/**
 * Attendance KPI variant (Master Prompt §4.5) — the student-attendance KPI card
 * pattern (app/(dashboard)/attendance/student/components/AttendanceKPIs.tsx)
 * with Transport's BD / NS / LT / DR code badges — and the Switch (§4.28).
 */
import { T } from "./tokens";

export type AttendanceCode = "BD" | "NS" | "LT" | "DR";
const CODE: Record<AttendanceCode, [string, string]> = {
  BD: ["#ECFDF5", "#16A34A"], NS: ["#FFF1F2", "#E11D48"], LT: ["#FFFBEB", "#D97706"], DR: ["#EFF6FF", "#2563EB"],
};

export function AttendanceKpi({
  code, label, value, trend, trendColor, loading,
}: { code: AttendanceCode; label: string; value: number; trend: string; trendColor: string; loading?: boolean }) {
  const [bg, color] = CODE[code];
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 16, padding: "12px 16px" }}>
      {loading ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div className="tp-skel" style={{ width: 28, height: 28 }} />
            <div className="tp-skel" style={{ width: 80, height: 10 }} />
          </div>
          <div className="tp-skel" style={{ width: 70, height: 40, marginTop: 10 }} />
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 28, height: 28, borderRadius: 8, background: bg, color, fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center" }}>{code}</span>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: T.muted }}>{label}</span>
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, color: T.kpiInk }}>{value}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: trendColor }}>{trend}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="tp-switch" onClick={onChange}>
      <span />
    </button>
  );
}

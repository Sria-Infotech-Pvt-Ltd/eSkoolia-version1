"use client";

import { useEffect, useRef, useState } from "react";
import {
  Clock, Timer, Coffee, TrendingUp, AlertTriangle, Star, History as HistoryIcon,
  Pencil, Trash2, Plus, CalendarClock, Bell, CheckCircle2, GraduationCap, Users2,
  ChevronLeft, ChevronRight, ClipboardCheck, Loader2, CircleOff, Sparkles,
} from "lucide-react";
import { apiRequestWithRefresh } from "@/lib/api-auth";
import { extractListData, type ListApiResponse } from "@/lib/pagination";
import { WizardHelpButton } from "./WizardHelpButton";
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext";

interface AttendancePolicy {
  id: number;
  name: string;
  is_default: boolean;
  is_active: boolean;
  shift_start: string;
  shift_end: string;
  grace_period_minutes: number;
  missing_punch_grace_minutes: number;
  break_duration_minutes: number;
  min_hours_full_day: string;
  min_hours_half_day: string;
  early_exit_grace_minutes: number;
  ot_threshold_hours: string;
  ot_multiplier_regular: string;
  ot_multiplier_holiday: string;
  late_marks_per_lop: number;
  lop_deduction_unit: "full_day" | "half_day";
  weekly_off_mon: boolean;
  weekly_off_tue: boolean;
  weekly_off_wed: boolean;
  weekly_off_thu: boolean;
  weekly_off_fri: boolean;
  weekly_off_sat: boolean;
  weekly_off_sun: boolean;
  absence_alert_enabled: boolean;
  absence_alert_after_days: number;
  absence_alert_notify_whom: "manager_and_hr" | "hr_only" | "manager_only";
  applies_to_roles: number[];
  applies_to_roles_detail: Array<{ id: number; name: string }>;
  created_by_name: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

interface RoleOption {
  id: number;
  name: string;
  is_active: boolean;
  portal_type: "admin" | "teacher" | "parent" | "student" | "custom";
}

interface AuditEntry {
  id: number;
  actor_name: string;
  action: string;
  created_at: string;
}

const WEEKLY_OFF_DAYS: Array<{ key: keyof AttendancePolicy; short: string; letter: string; label: string }> = [
  { key: "weekly_off_mon", short: "Mon", letter: "M", label: "Monday" },
  { key: "weekly_off_tue", short: "Tue", letter: "T", label: "Tuesday" },
  { key: "weekly_off_wed", short: "Wed", letter: "W", label: "Wednesday" },
  { key: "weekly_off_thu", short: "Thu", letter: "T", label: "Thursday" },
  { key: "weekly_off_fri", short: "Fri", letter: "F", label: "Friday" },
  { key: "weekly_off_sat", short: "Sat", letter: "S", label: "Saturday" },
  { key: "weekly_off_sun", short: "Sun", letter: "S", label: "Sunday" },
];

const WIZARD_DEFAULTS: Partial<AttendancePolicy> = {
  name: "", shift_start: "09:00", shift_end: "17:00",
  grace_period_minutes: 15, missing_punch_grace_minutes: 10, break_duration_minutes: 30, early_exit_grace_minutes: 30,
  min_hours_full_day: "8.00", min_hours_half_day: "4.00", ot_threshold_hours: "9.00",
  ot_multiplier_regular: "1.50", ot_multiplier_holiday: "2.00",
  late_marks_per_lop: 3, lop_deduction_unit: "full_day",
  weekly_off_mon: false, weekly_off_tue: false, weekly_off_wed: false, weekly_off_thu: false,
  weekly_off_fri: false, weekly_off_sat: true, weekly_off_sun: true,
  absence_alert_enabled: false, absence_alert_after_days: 3, absence_alert_notify_whom: "manager_and_hr",
  applies_to_roles: [],
};

const WIZARD_STEPS: Array<{ label: string; icon: typeof Clock }> = [
  { label: "Basics", icon: Clock },
  { label: "Applies To", icon: Users2 },
  { label: "Grace & Breaks", icon: Coffee },
  { label: "Hours & Overtime", icon: TrendingUp },
  { label: "Weekly Offs", icon: CalendarClock },
  { label: "Late Marks & Alerts", icon: Bell },
  { label: "Review", icon: ClipboardCheck },
];

const WIZARD_HELP_STEPS = [
  { label: "Basics", description: "Name the policy and set the standard shift start/end time." },
  { label: "Applies To", description: "Which roles this policy covers. Leave empty to make it the fallback for anyone not covered by a more specific policy." },
  { label: "Grace & Breaks", description: "How late staff can arrive/leave without penalty, missing-punch grace, and break duration." },
  { label: "Hours & Overtime", description: "Minimum hours for a full/half day, when overtime kicks in, and its pay multipliers on regular days vs. holidays." },
  { label: "Weekly Offs", description: "Which days of the week are off under this policy." },
  { label: "Late Marks & Alerts", description: "How many late marks convert to a Loss-of-Pay day, and whether/when absence alerts fire and who gets notified." },
  { label: "Review", description: "Check the whole policy at a glance before saving." },
];

function formatTime(value: string): string {
  return value.slice(0, 5);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const inputStyle = { border: "1px solid var(--bd-2)", borderRadius: 10, padding: "9px 11px", fontSize: 14, background: "var(--bg-1)", color: "var(--ink-1)", width: "100%" } as const;
const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" };

type StatTone = "purple" | "blue" | "amber" | "rose";
const STAT_TONES: Record<StatTone, { bg: string; fg: string }> = {
  purple: { bg: "var(--pu-tint)", fg: "var(--pu)" },
  blue: { bg: "var(--info-soft)", fg: "var(--info)" },
  amber: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  rose: { bg: "var(--danger-soft)", fg: "var(--danger)" },
};

function StatTile({ icon: Icon, tone, label, value }: { icon: typeof Clock; tone: StatTone; label: string; value: React.ReactNode }) {
  const t = STAT_TONES[tone];
  return (
    <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 11px", borderRadius: 10, background: "var(--bg-2)" }}>
      <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 8, background: t.bg, color: t.fg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={13} strokeWidth={2.25} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-1)", marginTop: 1, lineHeight: 1.3 }}>{value}</div>
      </div>
    </div>
  );
}

function WeekStrip({ policy }: { policy: AttendancePolicy }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {WEEKLY_OFF_DAYS.map((d) => {
        const isOff = Boolean(policy[d.key]);
        return (
          <div
            key={d.key}
            title={`${d.label}${isOff ? " — weekly off" : " — working day"}`}
            style={{
              width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10, fontWeight: 700,
              background: isOff ? "var(--pu)" : "var(--bg-1)",
              color: isOff ? "#fff" : "var(--ink-3)",
              border: isOff ? "none" : "1px solid var(--bd-2)",
            }}
          >
            {d.letter}
          </div>
        );
      })}
    </div>
  );
}

function IconButton({ icon: Icon, label, onClick, disabled, tone = "neutral" }: {
  icon: typeof Pencil; label: string; onClick: () => void; disabled?: boolean; tone?: "neutral" | "purple" | "ok" | "danger";
}) {
  const toneColor = tone === "purple" ? "var(--pu)" : tone === "ok" ? "var(--ok)" : tone === "danger" ? "var(--danger)" : "var(--ink-2)";
  return (
    <button
      className="attn-icon-btn"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex", alignItems: "center", gap: 5, background: "var(--bg-1)",
        border: "1px solid var(--bd-2)", borderRadius: 8, padding: "6px 11px", fontSize: 11.5, fontWeight: 600,
        cursor: disabled ? "default" : "pointer", color: toneColor, opacity: disabled ? 0.55 : 1,
      }}
    >
      <Icon size={12} strokeWidth={2.25} />
      {label}
    </button>
  );
}

export function AttendanceRulesPanel() {
  const [policies, setPolicies] = useState<AttendancePolicy[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Partial<AttendancePolicy>>(WIZARD_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const openSnapshotRef = useRef<Partial<AttendancePolicy>>(WIZARD_DEFAULTS);

  const [historyOpenId, setHistoryOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequestWithRefresh<ListApiResponse<AttendancePolicy>>("/api/v1/settings/attendance-policies/");
      setPolicies(extractListData(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load attendance policies.");
    } finally {
      setLoading(false);
    }
  };

  const loadRoles = async () => {
    try {
      const data = await apiRequestWithRefresh<ListApiResponse<RoleOption>>("/api/v1/access-control/roles/?page_size=200");
      // portal_type isn't reliably set for legacy/seeded roles (e.g. the default
      // "Parent" role provisioned by apps/tenancy/provisioning.py has no portal_type,
      // so it defaults to "admin") — match on name too so it's actually excluded.
      setRoles(
        extractListData(data).filter(
          (r) => r.is_active && r.portal_type !== "parent" && !/^parent$/i.test(r.name.trim())
        )
      );
    } catch {
      setRoles([]);
    }
  };

  useEffect(() => {
    void load();
    void loadRoles();
  }, []);

  const startCreate = () => {
    setEditingId(null);
    setDraft(WIZARD_DEFAULTS);
    openSnapshotRef.current = WIZARD_DEFAULTS;
    setWizardStep(0);
    setWizardOpen(true);
  };

  const startEdit = (policy: AttendancePolicy) => {
    setEditingId(policy.id);
    const snapshot = { ...policy, shift_start: formatTime(policy.shift_start), shift_end: formatTime(policy.shift_end) };
    setDraft(snapshot);
    openSnapshotRef.current = snapshot;
    setWizardStep(0);
    setWizardOpen(true);
  };

  const closeWizard = () => {
    setWizardOpen(false);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        await apiRequestWithRefresh(`/api/v1/settings/attendance-policies/${editingId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        setSuccess("Policy updated.");
      } else {
        await apiRequestWithRefresh("/api/v1/settings/attendance-policies/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        setSuccess("Attendance policy created.");
      }
      closeWizard();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy.");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const isDirty = wizardOpen && JSON.stringify(draft) !== JSON.stringify(openSnapshotRef.current);
  useUnsavedChangesGuard(isDirty, () => handleSubmit());

  const handleMakeDefault = async (id: number) => {
    setBusyId(id);
    setError(null);
    try {
      await apiRequestWithRefresh(`/api/v1/settings/attendance-policies/${id}/make_default/`, { method: "POST" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set as default.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (policy: AttendancePolicy) => {
    if (!confirm(`Delete "${policy.name}"?`)) return;
    setBusyId(policy.id);
    setError(null);
    try {
      await apiRequestWithRefresh(`/api/v1/settings/attendance-policies/${policy.id}/`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete policy.");
    } finally {
      setBusyId(null);
    }
  };

  const toggleHistory = async (policy: AttendancePolicy) => {
    if (historyOpenId === policy.id) {
      setHistoryOpenId(null);
      return;
    }
    setHistoryOpenId(policy.id);
    setHistoryLoading(true);
    try {
      const data = await apiRequestWithRefresh<ListApiResponse<AuditEntry>>(
        `/api/v1/settings/audit-log/?module=SchoolAttendancePolicy&object_id=${policy.id}`
      );
      setHistory(extractListData(data));
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 18, boxShadow: "var(--sh-1)", padding: "26px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 34, fontWeight: 600, color: "var(--ink-1)", margin: 0, lineHeight: 1.05, letterSpacing: "-0.03em", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            Attendance{" "}
            <em style={{ fontFamily: "var(--font-instrument-serif,'Instrument Serif',Georgia,serif)", fontWeight: 400, fontStyle: "italic", color: "var(--pu)", fontSize: 38, letterSpacing: "-0.02em" }}>
              Rules
            </em>
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.55, maxWidth: 560 }}>
            Multiple named policies per school (e.g. Teaching vs. Non-Teaching Staff) — shown to staff for transparency. One policy is marked default.
          </p>
        </div>
        {!loading && policies.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--pu-tint)", color: "var(--pu)", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>
            <Sparkles size={12} strokeWidth={2.5} />
            {policies.length} {policies.length === 1 ? "policy" : "policies"} configured
          </div>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8, color: "var(--danger)", background: "var(--danger-soft)", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 500 }}>
          <AlertTriangle size={15} /> {error}
        </div>
      )}
      {success && (
        <div style={{ marginTop: 18, display: "flex", alignItems: "center", gap: 8, color: "var(--ok)", background: "var(--ok-soft)", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 500 }}>
          <CheckCircle2 size={15} /> {success}
        </div>
      )}
      {loading && (
        <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 10, color: "var(--ink-2)", fontSize: 14 }}>
          <Loader2 size={16} className="attn-spin" /> Loading attendance policies…
        </div>
      )}

      {!loading && !wizardOpen && policies.length === 0 && (
        <div style={{ marginTop: 24, border: "1px dashed var(--bd-3)", borderRadius: 14, padding: "34px 24px", textAlign: "center", background: "radial-gradient(circle at 50% 0%, var(--pu-tint), transparent 70%)" }}>
          <div style={{ width: 44, height: 44, borderRadius: 13, background: "var(--pu-tint)", color: "var(--pu)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}>
            <Clock size={21} strokeWidth={2} />
          </div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--ink-1)", margin: "0 0 6px" }}>Set up your first attendance policy</h2>
          <p style={{ margin: "0 auto 18px", maxWidth: 420, fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.6 }}>
            A short guided setup — shift timing, grace periods, overtime, weekly offs, and late-mark rules. Takes about
            a minute, and staff will see these rules on their own profile once saved.
          </p>
          <button className="attn-primary-btn" onClick={startCreate} style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 9, padding: "10px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} strokeWidth={2.5} /> Start Setup
          </button>
        </div>
      )}

      {!loading && !wizardOpen && policies.length > 0 && (
        <>
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 12 }}>
            {policies.map((p) => {
              const isTeaching = /teach/i.test(p.name);
              const RoleIcon = isTeaching ? GraduationCap : Users2;
              return (
                <div
                  key={p.id}
                  style={{
                    position: "relative", borderRadius: 13, padding: "14px 16px 12px 18px",
                    background: p.is_default ? "linear-gradient(135deg, var(--pu-tint) 0%, var(--bg-1) 45%)" : "var(--bg-1)",
                    border: `1px solid ${p.is_default ? "var(--pu-soft)" : "var(--bd)"}`,
                    boxShadow: "var(--sh-1)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: p.is_default ? "var(--pu)" : "var(--bd-3)" }} />

                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                      <div style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 9, background: p.is_default ? "var(--pu)" : "var(--bg-2)", color: p.is_default ? "#fff" : "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <RoleIcon size={15} strokeWidth={2} />
                      </div>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <strong style={{ color: "var(--ink-1)", fontSize: 14, fontWeight: 700 }}>{p.name}</strong>
                          {p.is_default && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, color: "var(--ok)", background: "var(--ok-soft)", fontWeight: 700, borderRadius: 999, padding: "2px 7px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                              <Star size={9} fill="var(--ok)" strokeWidth={0} /> Default
                            </span>
                          )}
                          {!p.is_active && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 9.5, color: "var(--danger)", background: "var(--danger-soft)", fontWeight: 700, borderRadius: 999, padding: "2px 7px" }}>
                              <CircleOff size={9} /> Inactive
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>
                          Last updated {p.updated_by_name ? `by ${p.updated_by_name} ` : ""}on {formatDate(p.updated_at)}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      {!p.is_default && (
                        <IconButton icon={Star} label="Set Default" tone="ok" onClick={() => void handleMakeDefault(p.id)} disabled={busyId === p.id} />
                      )}
                      <IconButton icon={Pencil} label="Edit" tone="purple" onClick={() => startEdit(p)} />
                      <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => void handleDelete(p)} disabled={busyId === p.id} />
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                    <StatTile icon={Clock} tone="purple" label="Shift" value={`${formatTime(p.shift_start)} – ${formatTime(p.shift_end)}`} />
                    <StatTile icon={Timer} tone="blue" label="Grace period" value={`${p.grace_period_minutes} min`} />
                    <StatTile icon={TrendingUp} tone="amber" label="Overtime" value={`after ${p.ot_threshold_hours}h · ×${p.ot_multiplier_regular} (×${p.ot_multiplier_holiday} holiday)`} />
                    <StatTile
                      icon={AlertTriangle}
                      tone="rose"
                      label="Late marks"
                      value={p.late_marks_per_lop === 0 ? "Tracking only" : `${p.late_marks_per_lop} = 1 ${p.lop_deduction_unit === "full_day" ? "full-day" : "half-day"} LOP`}
                    />
                  </div>

                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "8px 11px", background: "var(--bg-2)", borderRadius: 10 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Weekly off</div>
                    <WeekStrip policy={p} />
                  </div>

                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 11px", background: "var(--bg-2)", borderRadius: 10 }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>Applies to</div>
                    {p.applies_to_roles_detail && p.applies_to_roles_detail.length > 0 ? (
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {p.applies_to_roles_detail.map((r) => (
                          <span key={r.id} style={{ fontSize: 10.5, fontWeight: 600, color: "var(--pu)", background: "var(--pu-tint)", borderRadius: 999, padding: "2px 9px" }}>
                            {r.name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>All roles (no restriction set)</span>
                    )}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end" }}>
                    <button className="attn-link-btn" onClick={() => void toggleHistory(p)} style={{ background: "none", border: "none", padding: 0, fontSize: 11, fontWeight: 600, color: "var(--pu)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <HistoryIcon size={12} /> {historyOpenId === p.id ? "Hide history" : "View history"}
                    </button>
                  </div>

                  {historyOpenId === p.id && (
                    <div style={{ marginTop: 8, borderTop: "1px solid var(--bd)", paddingTop: 9 }}>
                      {historyLoading && (
                        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--ink-2)" }}>
                          <Loader2 size={12} className="attn-spin" /> Loading…
                        </span>
                      )}
                      {!historyLoading && history.length === 0 && <span style={{ fontSize: 11.5, color: "var(--ink-2)" }}>No history yet.</span>}
                      {!historyLoading && history.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          {history.map((h) => (
                            <div key={h.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--ink-2)" }}>
                              <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--pu)", flexShrink: 0 }} />
                              <span style={{ color: "var(--ink-3)" }}>{formatDate(h.created_at)}</span>
                              <span>—</span>
                              <strong style={{ color: "var(--ink-1)", fontWeight: 600 }}>{h.action}</strong>
                              <span>by {h.actor_name}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button className="attn-primary-btn" onClick={startCreate} style={{ marginTop: 16, background: "var(--pu)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} strokeWidth={2.5} /> Add Another Policy
          </button>
        </>
      )}

      {wizardOpen && (
        <AttendanceWizard
          draft={draft}
          setDraft={setDraft}
          step={wizardStep}
          setStep={setWizardStep}
          isEditing={editingId !== null}
          saving={saving}
          roles={roles}
          onCancel={closeWizard}
          onSubmit={() => void handleSubmit().catch(() => {})}
        />
      )}

      <style jsx>{`
        .attn-icon-btn:hover:not(:disabled) { background: var(--bg-2); border-color: var(--bd-3); }
        .attn-primary-btn:hover { background: var(--pu-deep); }
        .attn-link-btn:hover { text-decoration: underline; }
        .attn-spin { animation: attn-rotate 0.8s linear infinite; }
        @keyframes attn-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function AttendanceWizard({
  draft, setDraft, step, setStep, isEditing, saving, roles, onCancel, onSubmit,
}: {
  draft: Partial<AttendancePolicy>;
  setDraft: React.Dispatch<React.SetStateAction<Partial<AttendancePolicy>>>;
  step: number;
  setStep: (n: number) => void;
  isEditing: boolean;
  saving: boolean;
  roles: RoleOption[];
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof AttendancePolicy>(key: K, value: AttendancePolicy[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const hasName = Boolean(draft.name && draft.name.trim());
  const canGoNext = step === 0 ? hasName : true;
  // Editing an existing policy already has a name, so every step is reachable directly.
  // Creating one still needs the name (step 0) filled before jumping elsewhere.
  const canJumpTo = (target: number) => isEditing || target === 0 || hasName;

  const toggleRole = (roleId: number) => {
    const current = draft.applies_to_roles ?? [];
    set("applies_to_roles", (current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]) as never);
  };

  return (
    <div style={{ marginTop: 20, border: "1px solid var(--bd)", borderRadius: 14, padding: "22px 24px", background: "var(--bg-1)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flex: 1 }}>
        {WIZARD_STEPS.map((s, i) => {
          const StepIcon = s.icon;
          const isDone = i < step;
          const isActive = i === step;
          const jumpable = canJumpTo(i) && i !== step;
          return (
            <div key={s.label} style={{ display: "flex", alignItems: "center", flex: i < WIZARD_STEPS.length - 1 ? 1 : "0 0 auto" }}>
              <div
                onClick={() => jumpable && setStep(i)}
                title={jumpable ? `Jump to ${s.label}` : s.label}
                style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 34, cursor: jumpable ? "pointer" : "default" }}
              >
                <div
                  style={{
                    width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: isActive ? "var(--pu)" : isDone ? "var(--pu-tint)" : "var(--bg-2)",
                    color: isActive ? "#fff" : isDone ? "var(--pu)" : "var(--ink-3)",
                    border: isActive ? "none" : `1px solid ${isDone ? "var(--pu-soft)" : "var(--bd-2)"}`,
                    transition: "all 0.15s ease", flexShrink: 0,
                  }}
                >
                  {isDone ? <CheckCircle2 size={16} strokeWidth={2.5} /> : <StepIcon size={15} strokeWidth={2.25} />}
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? "var(--pu)" : "var(--ink-3)", textAlign: "center", whiteSpace: "nowrap" }}>
                  {s.label}
                </span>
              </div>
              {i < WIZARD_STEPS.length - 1 && (
                <div style={{ flex: 1, height: 2, background: isDone ? "var(--pu-soft)" : "var(--bd)", margin: "0 4px 18px" }} />
              )}
            </div>
          );
        })}
      </div>
      <WizardHelpButton
        title="Attendance Policy Wizard Guide"
        intro="Each step configures one part of the policy. Jump to any unlocked step using the icons above."
        steps={WIZARD_HELP_STEPS}
      />
      </div>

      {step === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
            Policy Name (e.g. &quot;Teaching Staff&quot;, &quot;Non-Teaching Staff&quot;)
            <input value={draft.name ?? ""} onChange={(e) => set("name", e.target.value.replace(/[^A-Za-z\s'.-]/g, ""))} style={inputStyle} autoFocus />
          </label>
          <label style={labelStyle}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Clock size={13} /> Shift Start</span>
            <input type="time" value={draft.shift_start ?? "09:00"} onChange={(e) => set("shift_start", e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Clock size={13} /> Shift End</span>
            <input type="time" value={draft.shift_end ?? "17:00"} onChange={(e) => set("shift_end", e.target.value)} style={inputStyle} />
          </label>
        </div>
      )}

      {step === 1 && (
        <div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "0 0 14px" }}>
            Which roles does this policy apply to? Leave empty to apply to all staff who aren&apos;t covered by a more specific policy.
          </p>
          {roles.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--ink-3)" }}>No roles found for this school yet.</p>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {roles.map((r) => {
                const checked = (draft.applies_to_roles ?? []).includes(r.id);
                return (
                  <label
                    key={r.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      color: checked ? "#fff" : "var(--ink-2)", background: checked ? "var(--pu)" : "var(--bg-2)",
                      border: `1px solid ${checked ? "var(--pu)" : "var(--bd-2)"}`, borderRadius: 999, padding: "8px 14px",
                      transition: "all 0.12s ease",
                    }}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleRole(r.id)} style={{ display: "none" }} />
                    {checked ? <CheckCircle2 size={14} /> : <Users2 size={14} />}
                    {r.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
          <label style={labelStyle}>Grace period (minutes) — how late staff can arrive without being marked late<input type="number" min={0} value={draft.grace_period_minutes ?? 0} onChange={(e) => set("grace_period_minutes", Number(e.target.value))} style={inputStyle} /></label>
          <label style={labelStyle}>Missing-punch grace (minutes)<input type="number" min={0} value={draft.missing_punch_grace_minutes ?? 0} onChange={(e) => set("missing_punch_grace_minutes", Number(e.target.value))} style={inputStyle} /></label>
          <label style={labelStyle}>Break duration (minutes)<input type="number" min={0} value={draft.break_duration_minutes ?? 0} onChange={(e) => set("break_duration_minutes", Number(e.target.value))} style={inputStyle} /></label>
          <label style={labelStyle}>Early-exit grace (minutes)<input type="number" min={0} value={draft.early_exit_grace_minutes ?? 0} onChange={(e) => set("early_exit_grace_minutes", Number(e.target.value))} style={inputStyle} /></label>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
          <label style={labelStyle}>Min. hours — full day<input type="number" step="0.5" value={draft.min_hours_full_day ?? "8.00"} onChange={(e) => set("min_hours_full_day", e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>Min. hours — half day<input type="number" step="0.5" value={draft.min_hours_half_day ?? "4.00"} onChange={(e) => set("min_hours_half_day", e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>Overtime threshold (hours)<input type="number" step="0.5" value={draft.ot_threshold_hours ?? "9.00"} onChange={(e) => set("ot_threshold_hours", e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>OT multiplier — regular day<input type="number" step="0.1" value={draft.ot_multiplier_regular ?? "1.50"} onChange={(e) => set("ot_multiplier_regular", e.target.value)} style={inputStyle} /></label>
          <label style={labelStyle}>OT multiplier — holiday<input type="number" step="0.1" value={draft.ot_multiplier_holiday ?? "2.00"} onChange={(e) => set("ot_multiplier_holiday", e.target.value)} style={inputStyle} /></label>
        </div>
      )}

      {step === 4 && (
        <div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "0 0 14px" }}>Which days are weekly off under this policy?</p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {WEEKLY_OFF_DAYS.map((d) => {
              const checked = Boolean(draft[d.key]);
              return (
                <label
                  key={d.key}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    color: checked ? "#fff" : "var(--ink-2)", background: checked ? "var(--pu)" : "var(--bg-2)",
                    border: `1px solid ${checked ? "var(--pu)" : "var(--bd-2)"}`, borderRadius: 12, padding: "12px 16px", minWidth: 66,
                    transition: "all 0.12s ease",
                  }}
                >
                  <input type="checkbox" checked={checked} onChange={(e) => set(d.key, e.target.checked as never)} style={{ display: "none" }} />
                  {checked ? <CheckCircle2 size={16} /> : <CalendarClock size={16} />}
                  {d.short}
                </label>
              );
            })}
          </div>
        </div>
      )}

      {step === 5 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
          <label style={labelStyle}>Late marks per LOP (0 = tracking only)<input type="number" min={0} value={draft.late_marks_per_lop ?? 3} onChange={(e) => set("late_marks_per_lop", Number(e.target.value))} style={inputStyle} /></label>
          <label style={labelStyle}>
            LOP deduction unit
            <select value={draft.lop_deduction_unit ?? "full_day"} onChange={(e) => set("lop_deduction_unit", e.target.value as AttendancePolicy["lop_deduction_unit"])} style={inputStyle}>
              <option value="full_day">Full day</option>
              <option value="half_day">Half day</option>
            </select>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-2)", gridColumn: "1 / -1", background: "var(--bg-2)", borderRadius: 10, padding: "12px 14px" }}>
            <input type="checkbox" checked={Boolean(draft.absence_alert_enabled)} onChange={(e) => set("absence_alert_enabled", e.target.checked)} />
            <Bell size={15} /> Enable absence alerts
          </label>
          {draft.absence_alert_enabled && (
            <>
              <label style={labelStyle}>Alert after (days)<input type="number" min={1} value={draft.absence_alert_after_days ?? 3} onChange={(e) => set("absence_alert_after_days", Number(e.target.value))} style={inputStyle} /></label>
              <label style={labelStyle}>
                Notify
                <select value={draft.absence_alert_notify_whom ?? "manager_and_hr"} onChange={(e) => set("absence_alert_notify_whom", e.target.value as AttendancePolicy["absence_alert_notify_whom"])} style={inputStyle}>
                  <option value="manager_and_hr">Manager &amp; HR</option>
                  <option value="hr_only">HR only</option>
                  <option value="manager_only">Manager only</option>
                </select>
              </label>
            </>
          )}
        </div>
      )}

      {step === 6 && (
        <div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardCheck size={15} /> Review before saving:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <StatTile icon={ClipboardCheck} tone="purple" label="Name" value={draft.name || "—"} />
            <StatTile icon={Users2} tone="purple" label="Applies to" value={roles.filter((r) => (draft.applies_to_roles ?? []).includes(r.id)).map((r) => r.name).join(", ") || "All roles"} />
            <StatTile icon={Clock} tone="purple" label="Shift" value={`${draft.shift_start}–${draft.shift_end}`} />
            <StatTile icon={Timer} tone="blue" label="Grace period" value={`${draft.grace_period_minutes} min`} />
            <StatTile icon={Coffee} tone="blue" label="Break" value={`${draft.break_duration_minutes} min`} />
            <StatTile icon={TrendingUp} tone="amber" label="Overtime" value={`after ${draft.ot_threshold_hours}h, ×${draft.ot_multiplier_regular} (×${draft.ot_multiplier_holiday} holiday)`} />
            <StatTile icon={CalendarClock} tone="purple" label="Weekly off" value={WEEKLY_OFF_DAYS.filter((d) => draft[d.key]).map((d) => d.short).join(", ") || "None"} />
            <StatTile icon={AlertTriangle} tone="rose" label="Late marks" value={draft.late_marks_per_lop === 0 ? "Tracking only" : `${draft.late_marks_per_lop} = 1 ${draft.lop_deduction_unit === "full_day" ? "full" : "half"}-day LOP`} />
            <StatTile icon={Bell} tone="rose" label="Absence alerts" value={draft.absence_alert_enabled ? `after ${draft.absence_alert_after_days} days` : "Off"} />
          </div>
        </div>
      )}

      <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--bd)", paddingTop: 20 }}>
        <div>
          {step > 0 && (
            <button className="attn-icon-btn" onClick={() => setStep(step - 1)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-1)", border: "1px solid var(--bd-2)", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--ink-2)" }}>
              <ChevronLeft size={15} /> Back
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={{ background: "transparent", border: "1px solid var(--bd-2)", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--ink-2)" }}>
            Cancel
          </button>
          {isEditing && step < WIZARD_STEPS.length - 1 && (
            <button
              onClick={onSubmit}
              disabled={saving}
              style={{ background: "var(--bg-1)", color: "var(--pu)", border: "1px solid var(--pu-soft)", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {saving ? (<><Loader2 size={15} className="attn-spin" /> Saving…</>) : (<><CheckCircle2 size={15} /> Save &amp; Exit</>)}
            </button>
          )}
          {step < WIZARD_STEPS.length - 1 ? (
            <button
              className="attn-primary-btn"
              onClick={() => canGoNext && setStep(step + 1)}
              disabled={!canGoNext}
              style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: canGoNext ? "pointer" : "default", opacity: canGoNext ? 1 : 0.5, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button
              className="attn-primary-btn"
              onClick={onSubmit}
              disabled={saving}
              style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {saving ? (<><Loader2 size={15} className="attn-spin" /> Saving…</>) : isEditing ? (<><CheckCircle2 size={15} /> Save Changes</>) : (<><Plus size={15} /> Create Policy</>)}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .attn-icon-btn:hover:not(:disabled) { background: var(--bg-2); border-color: var(--bd-3); }
        .attn-primary-btn:hover:not(:disabled) { background: var(--pu-deep); }
        .attn-spin { animation: attn-rotate 0.8s linear infinite; }
        @keyframes attn-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

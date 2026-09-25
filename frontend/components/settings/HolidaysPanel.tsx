"use client";

import { useEffect, useRef, useState } from "react";
import {
  CalendarDays, Settings2, ClipboardCheck, Pencil, Trash2, Plus, ChevronLeft, ChevronRight,
  CheckCircle2, Loader2, AlertTriangle, Sparkles, ShieldCheck, CalendarClock,
} from "lucide-react";
import { apiRequestWithRefresh } from "@/lib/api-auth";
import { extractListData, type ListApiResponse } from "@/lib/pagination";
import { WizardHelpButton } from "./WizardHelpButton";
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext";

interface Holiday {
  id: number;
  name: string;
  date: string;
  end_date: string | null;
  holiday_type: string;
  audience: "all" | "staff_only";
  is_optional: boolean;
}

interface Exclusion {
  id: number;
  holiday: number;
  holiday_name: string;
  holiday_date: string;
  reason: string;
}

interface HolidayDraft {
  name: string;
  date: string;
  end_date: string;
  is_optional: boolean;
}

const WIZARD_DEFAULTS: HolidayDraft = { name: "", date: "", end_date: "", is_optional: false };

const WIZARD_STEPS: Array<{ label: string; icon: typeof CalendarDays }> = [
  { label: "Details", icon: CalendarDays },
  { label: "Options", icon: Settings2 },
  { label: "Review", icon: ClipboardCheck },
];

const WIZARD_HELP_STEPS = [
  { label: "Details", description: "Name the holiday and set its date (or a date range for a multi-day holiday)." },
  { label: "Options", description: "Mark it Restricted/opt-in if staff can choose whether to take it, instead of it applying to everyone automatically." },
  { label: "Review", description: "Check the name, dates and type at a glance before saving." },
];

const inputStyle = { border: "1px solid var(--bd-2)", borderRadius: 10, padding: "9px 11px", fontSize: 14, background: "var(--bg-1)", color: "var(--ink-1)", width: "100%" } as const;
const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" };

type StatTone = "purple" | "blue" | "amber" | "rose";
const STAT_TONES: Record<StatTone, { bg: string; fg: string }> = {
  purple: { bg: "var(--pu-tint)", fg: "var(--pu)" },
  blue: { bg: "var(--info-soft)", fg: "var(--info)" },
  amber: { bg: "var(--warn-soft)", fg: "var(--warn)" },
  rose: { bg: "var(--danger-soft)", fg: "var(--danger)" },
};

function StatTile({ icon: Icon, tone, label, value }: { icon: typeof CalendarDays; tone: StatTone; label: string; value: React.ReactNode }) {
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

function IconButton({ icon: Icon, label, onClick, disabled, tone = "neutral" }: {
  icon: typeof Pencil; label: string; onClick: () => void; disabled?: boolean; tone?: "neutral" | "purple" | "ok" | "danger";
}) {
  const toneColor = tone === "purple" ? "var(--pu)" : tone === "ok" ? "var(--ok)" : tone === "danger" ? "var(--danger)" : "var(--ink-2)";
  return (
    <button
      className="hol-icon-btn"
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

const formatRange = (date: string, endDate: string | null) => (endDate && endDate !== date ? `${date} → ${endDate}` : date);

export function HolidaysPanel() {
  const [staffCalendar, setStaffCalendar] = useState<Holiday[]>([]);
  const [schoolWideHolidays, setSchoolWideHolidays] = useState<Holiday[]>([]);
  const [staffOnlyHolidays, setStaffOnlyHolidays] = useState<Holiday[]>([]);
  const [exclusions, setExclusions] = useState<Exclusion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<HolidayDraft>(WIZARD_DEFAULTS);
  const [saving, setSaving] = useState(false);
  const openSnapshotRef = useRef<HolidayDraft>(WIZARD_DEFAULTS);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [calendar, holidaysRes, exclusionsRes] = await Promise.all([
        apiRequestWithRefresh<ListApiResponse<Holiday>>("/api/v1/settings/staff-holiday-calendar/"),
        apiRequestWithRefresh<ListApiResponse<Holiday>>("/api/v1/core/holidays/?page_size=200"),
        apiRequestWithRefresh<ListApiResponse<Exclusion>>("/api/v1/settings/staff-holiday-exclusions/"),
      ]);
      const allHolidays = extractListData(holidaysRes);
      setStaffCalendar(extractListData(calendar));
      setSchoolWideHolidays(allHolidays.filter((h) => h.audience === "all"));
      setStaffOnlyHolidays(allHolidays.filter((h) => h.audience === "staff_only"));
      setExclusions(extractListData(exclusionsRes));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load holiday calendar.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const exclusionForHoliday = (holidayId: number) => exclusions.find((e) => e.holiday === holidayId);

  const toggleExclusion = async (holiday: Holiday) => {
    setBusyId(holiday.id);
    setError(null);
    try {
      const existing = exclusionForHoliday(holiday.id);
      if (existing) {
        await apiRequestWithRefresh(`/api/v1/settings/staff-holiday-exclusions/${existing.id}/`, { method: "DELETE" });
      } else {
        await apiRequestWithRefresh("/api/v1/settings/staff-holiday-exclusions/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ holiday: holiday.id }),
        });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update exclusion.");
    } finally {
      setBusyId(null);
    }
  };

  const startCreate = () => {
    setEditingId(null);
    setDraft(WIZARD_DEFAULTS);
    openSnapshotRef.current = WIZARD_DEFAULTS;
    setWizardStep(0);
    setWizardOpen(true);
  };

  const startEdit = (holiday: Holiday) => {
    setEditingId(holiday.id);
    const snapshot = { name: holiday.name, date: holiday.date, end_date: holiday.end_date ?? "", is_optional: holiday.is_optional };
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
    if (!draft.name.trim() || !draft.date) {
      setError("Name and date are required.");
      throw new Error("Name and date are required.");
    }
    if (draft.end_date && draft.end_date < draft.date) {
      setError("End date cannot be before the start date.");
      throw new Error("End date cannot be before the start date.");
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (editingId) {
        await apiRequestWithRefresh(`/api/v1/core/holidays/${editingId}/`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: draft.name, date: draft.date, end_date: draft.end_date || null, is_optional: draft.is_optional }),
        });
        setSuccess("Holiday updated.");
      } else {
        await apiRequestWithRefresh("/api/v1/core/holidays/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft.name, date: draft.date, end_date: draft.end_date || null,
            audience: "staff_only", holiday_type: "other", is_optional: draft.is_optional,
          }),
        });
        setSuccess("Staff-only holiday added.");
      }
      closeWizard();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save holiday.");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const isDirty = wizardOpen && JSON.stringify(draft) !== JSON.stringify(openSnapshotRef.current);
  useUnsavedChangesGuard(isDirty, () => handleSubmit());

  const handleDelete = async (holiday: Holiday) => {
    if (!confirm(`Delete "${holiday.name}"?`)) return;
    setBusyId(holiday.id);
    setError(null);
    try {
      await apiRequestWithRefresh(`/api/v1/core/holidays/${holiday.id}/`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete holiday.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 18, boxShadow: "var(--sh-1)", padding: "26px 28px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 34, fontWeight: 600, color: "var(--ink-1)", margin: 0, lineHeight: 1.05, letterSpacing: "-0.03em", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            Staff Holiday{" "}
            <em style={{ fontFamily: "var(--font-instrument-serif,'Instrument Serif',Georgia,serif)", fontWeight: 400, fontStyle: "italic", color: "var(--pu)", fontSize: 38, letterSpacing: "-0.02em" }}>
              Calendar
            </em>
          </h1>
          <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.55, maxWidth: 620 }}>
            Shares one calendar with Academics &gt; Foundation — a holiday added in either place shows up in both,
            blocks exam scheduling, appears on the parent portal, and auto-marks attendance on that date. Exclude
            school-wide holidays not applicable to staff, or add staff-only holidays below.
          </p>
        </div>
        {!loading && staffCalendar.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--pu-tint)", color: "var(--pu)", borderRadius: 999, padding: "6px 12px", fontSize: 11.5, fontWeight: 700, flexShrink: 0 }}>
            <Sparkles size={12} strokeWidth={2.5} />
            {staffCalendar.length} in staff calendar
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
          <Loader2 size={16} className="hol-spin" /> Loading holiday calendar…
        </div>
      )}

      {!loading && (
        <>
          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-1)", marginTop: 28, marginBottom: 4 }}>School-wide holidays</h2>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>Managed in Academics &gt; Foundation — exclude any not applicable to staff.</p>
          <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {schoolWideHolidays.map((h) => {
              const excluded = Boolean(exclusionForHoliday(h.id));
              return (
                <div key={h.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid var(--bd)", borderRadius: 12, padding: "10px 16px", opacity: excluded ? 0.6 : 1, background: "var(--bg-1)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <CalendarDays size={14} style={{ color: "var(--ink-3)" }} />
                    <div>
                      <strong style={{ color: "var(--ink-1)", fontSize: 13.5 }}>{h.name}</strong>
                      <span style={{ marginLeft: 10, fontSize: 12, color: "var(--ink-2)" }}>{formatRange(h.date, h.end_date)}</span>
                      {excluded && <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 700, color: "var(--danger)" }}>Excluded for staff</span>}
                    </div>
                  </div>
                  <IconButton
                    icon={excluded ? CheckCircle2 : ShieldCheck}
                    label={busyId === h.id ? "…" : excluded ? "Include for staff" : "Exclude for staff"}
                    tone={excluded ? "ok" : "danger"}
                    onClick={() => void toggleExclusion(h)}
                    disabled={busyId === h.id}
                  />
                </div>
              );
            })}
            {schoolWideHolidays.length === 0 && <div style={{ color: "var(--ink-2)", fontSize: 13 }}>No school-wide holidays set yet in Foundation.</div>}
          </div>

          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-1)", marginTop: 30, marginBottom: 4 }}>Staff-only holidays</h2>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>Holidays that apply only to staff, not the school-wide calendar.</p>

          {!wizardOpen && staffOnlyHolidays.length === 0 && (
            <div style={{ marginTop: 14, border: "1px dashed var(--bd-3)", borderRadius: 14, padding: "28px 24px", textAlign: "center", background: "radial-gradient(circle at 50% 0%, var(--pu-tint), transparent 70%)" }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "var(--pu-tint)", color: "var(--pu)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                <CalendarClock size={19} strokeWidth={2} />
              </div>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-1)", margin: "0 0 6px" }}>No staff-only holidays yet</h3>
              <p style={{ margin: "0 auto 14px", maxWidth: 380, fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6 }}>
                A short guided setup — name, date range, and whether it&apos;s opt-in (restricted).
              </p>
              <button className="hol-primary-btn" onClick={startCreate} style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 18px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Plus size={13} strokeWidth={2.5} /> Add Staff-Only Holiday
              </button>
            </div>
          )}

          {!wizardOpen && staffOnlyHolidays.length > 0 && (
            <>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {staffOnlyHolidays.map((h) => (
                  <div key={h.id} style={{ position: "relative", borderRadius: 12, padding: "11px 14px 11px 16px", background: "var(--bg-1)", border: "1px solid var(--bd)", overflow: "hidden" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--pu)" }} />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 8, background: "var(--bg-2)", color: "var(--ink-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <CalendarClock size={13} strokeWidth={2} />
                        </div>
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <strong style={{ color: "var(--ink-1)", fontSize: 13.5 }}>{h.name}</strong>
                            {h.is_optional && (
                              <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--warn)", background: "var(--warn-soft)", borderRadius: 999, padding: "2px 7px" }}>Restricted</span>
                            )}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 1 }}>{formatRange(h.date, h.end_date)}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <IconButton icon={Pencil} label="Edit" tone="purple" onClick={() => startEdit(h)} />
                        <IconButton icon={Trash2} label="Delete" tone="danger" onClick={() => void handleDelete(h)} disabled={busyId === h.id} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <button className="hol-primary-btn" onClick={startCreate} style={{ marginTop: 14, background: "var(--pu)", color: "#fff", border: "none", borderRadius: 9, padding: "9px 16px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <Plus size={14} strokeWidth={2.5} /> Add Another Staff-Only Holiday
              </button>
            </>
          )}

          {wizardOpen && (
            <HolidayWizard
              draft={draft}
              setDraft={setDraft}
              step={wizardStep}
              setStep={setWizardStep}
              isEditing={editingId !== null}
              saving={saving}
              onCancel={closeWizard}
              onSubmit={() => void handleSubmit().catch(() => {})}
            />
          )}

          <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--ink-1)", marginTop: 30, marginBottom: 4 }}>Staff calendar preview ({staffCalendar.length})</h2>
          <p style={{ margin: 0, fontSize: 12, color: "var(--ink-3)" }}>School-wide holidays minus exclusions, plus staff-only holidays — what staff actually see.</p>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            {staffCalendar.map((h) => (
              <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ink-2)", padding: "6px 0", borderBottom: "1px solid var(--bd)" }}>
                <span>{h.name}</span>
                <span>{formatRange(h.date, h.end_date)}{h.audience === "staff_only" ? " · staff only" : ""}{h.is_optional ? " · restricted" : ""}</span>
              </div>
            ))}
            {staffCalendar.length === 0 && <div style={{ color: "var(--ink-2)", fontSize: 13 }}>Nothing on the staff calendar yet.</div>}
          </div>
        </>
      )}

      <style jsx>{`
        .hol-icon-btn:hover:not(:disabled) { background: var(--bg-2); border-color: var(--bd-3); }
        .hol-primary-btn:hover { background: var(--pu-deep); }
        .hol-spin { animation: hol-rotate 0.8s linear infinite; }
        @keyframes hol-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function HolidayWizard({
  draft, setDraft, step, setStep, isEditing, saving, onCancel, onSubmit,
}: {
  draft: HolidayDraft;
  setDraft: React.Dispatch<React.SetStateAction<HolidayDraft>>;
  step: number;
  setStep: (n: number) => void;
  isEditing: boolean;
  saving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const set = <K extends keyof HolidayDraft>(key: K, value: HolidayDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const hasDetails = Boolean(draft.name.trim() && draft.date);
  const canGoNext = step === 0 ? hasDetails : true;
  const canJumpTo = (target: number) => isEditing || target === 0 || hasDetails;

  return (
    <div style={{ marginTop: 14, border: "1px solid var(--bd)", borderRadius: 14, padding: "22px 24px", background: "var(--bg-1)" }}>
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
        title="Holiday Wizard Guide"
        intro="A quick walkthrough of what each step configures."
        steps={WIZARD_HELP_STEPS}
      />
      </div>

      {step === 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
          <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>
            Name
            <input value={draft.name} onChange={(e) => set("name", e.target.value.replace(/[^A-Za-z\s'.-]/g, ""))} style={inputStyle} autoFocus />
          </label>
          <label style={labelStyle}>
            Start date
            <input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} style={inputStyle} />
          </label>
          <label style={labelStyle}>
            End date <span style={{ fontWeight: 400 }}>(optional — for multi-day breaks)</span>
            <input type="date" value={draft.end_date} min={draft.date || undefined} onChange={(e) => set("end_date", e.target.value)} style={inputStyle} />
          </label>
        </div>
      )}

      {step === 1 && (
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600, color: "var(--ink-2)", background: "var(--bg-2)", borderRadius: 10, padding: "14px 16px" }}>
            <input type="checkbox" checked={draft.is_optional} onChange={(e) => set("is_optional", e.target.checked)} />
            Restricted (staff opt-in) — not counted automatically, staff choose to take it
          </label>
        </div>
      )}

      {step === 2 && (
        <div>
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "0 0 16px", display: "flex", alignItems: "center", gap: 8 }}>
            <ClipboardCheck size={15} /> Review before saving:
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <StatTile icon={CalendarDays} tone="purple" label="Name" value={draft.name || "—"} />
            <StatTile icon={CalendarClock} tone="blue" label="Dates" value={formatRange(draft.date || "—", draft.end_date || null)} />
            <StatTile icon={Settings2} tone="amber" label="Type" value={draft.is_optional ? "Restricted (opt-in)" : "Standard"} />
          </div>
        </div>
      )}

      <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--bd)", paddingTop: 20 }}>
        <div>
          {step > 0 && (
            <button className="hol-icon-btn" onClick={() => setStep(step - 1)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-1)", border: "1px solid var(--bd-2)", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--ink-2)" }}>
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
              {saving ? (<><Loader2 size={15} className="hol-spin" /> Saving…</>) : (<><CheckCircle2 size={15} /> Save &amp; Exit</>)}
            </button>
          )}
          {step < WIZARD_STEPS.length - 1 ? (
            <button
              className="hol-primary-btn"
              onClick={() => canGoNext && setStep(step + 1)}
              disabled={!canGoNext}
              style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: canGoNext ? "pointer" : "default", opacity: canGoNext ? 1 : 0.5, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              Next <ChevronRight size={15} />
            </button>
          ) : (
            <button
              className="hol-primary-btn"
              onClick={onSubmit}
              disabled={saving}
              style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {saving ? (<><Loader2 size={15} className="hol-spin" /> Saving…</>) : isEditing ? (<><CheckCircle2 size={15} /> Save Changes</>) : (<><Plus size={15} /> Add Holiday</>)}
            </button>
          )}
        </div>
      </div>

      <style jsx>{`
        .hol-icon-btn:hover:not(:disabled) { background: var(--bg-2); border-color: var(--bd-3); }
        .hol-primary-btn:hover:not(:disabled) { background: var(--pu-deep); }
        .hol-spin { animation: hol-rotate 0.8s linear infinite; }
        @keyframes hol-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

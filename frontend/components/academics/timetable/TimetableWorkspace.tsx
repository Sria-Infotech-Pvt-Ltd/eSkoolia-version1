"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Calendar,
  ChevronDown,
  Clock,
  Printer,
  RefreshCw,
  ScanLine,
  Search,
  Shield,
  Trash2,
  Users as UsersIcon,
  WrenchIcon,
  Zap,
} from "lucide-react";
import { apiRequestWithRefresh } from "@/lib/api-auth";
import {
  autoGenerateRoutine,
  clearSlot,
  saveLevelScheduleConfig,
  saveSlot,
  useClashes,
  useClassPeriods,
  useClassSubjectEntries,
  useLevelScheduleConfigs,
  useSectionRoutine,
  useTeacherRoutine,
  useTeachersForSlot,
} from "@/hooks/useTimetableApi";
import type {
  AcademicYear,
  ClashEntry,
  ClassPeriod,
  ClassRoutineSlot,
  LevelScheduleConfig,
  SchoolClass,
  Section,
  Subject,
  Teacher,
} from "@/types/academics";

type Tab = "config" | "class" | "teacher" | "clash";

/** A virtual column — either a real period, an interval break, or a lunch break */
type ColDef =
  | { kind: "period";   period: ClassPeriod; periodNum: number }
  | { kind: "interval"; minutes: number | null }
  | { kind: "lunch";    minutes: number | null };

const LEVEL_GROUPS: { code: string; label: string; color: string }[] = [
  { code: "pre_primary",      label: "Pre-Primary", color: "#F59E0B" },
  { code: "primary",          label: "Primary",     color: "#10B981" },
  { code: "middle",           label: "Middle",      color: "#3B82F6" },
  { code: "secondary",        label: "Secondary",   color: "#8B5CF6" },
  { code: "senior_secondary", label: "Higher Sec.", color: "#EF4444" },
];

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_LABEL: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat",
};

// 8-colour deterministic soft-pastel palette
const SUBJECT_PALETTE = [
  { bg: "#EFF6FF", border: "#93C5FD", text: "#1D4ED8" },
  { bg: "#F0FDF4", border: "#86EFAC", text: "#15803D" },
  { bg: "#FEF3C7", border: "#FCD34D", text: "#B45309" },
  { bg: "#FDF2F8", border: "#F0ABFC", text: "#A21CAF" },
  { bg: "#FFF7ED", border: "#FDBA74", text: "#C2410C" },
  { bg: "#ECFDF5", border: "#6EE7B7", text: "#065F46" },
  { bg: "#EEE9FF", border: "#A78BFA", text: "#5B21B6" },
  { bg: "#FEF9EC", border: "#FDE68A", text: "#92400E" },
];

function subjectColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return SUBJECT_PALETTE[Math.abs(h) % SUBJECT_PALETTE.length];
}

async function fetchList<T>(path: string): Promise<T[]> {
  const res = await apiRequestWithRefresh<{ results?: T[]; data?: T[] } | T[]>(path);
  if (Array.isArray(res)) return res;
  return res.results ?? res.data ?? [];
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesToTime(total: number) {
  const normalized = total % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}:00`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Root workspace
// ─────────────────────────────────────────────────────────────────────────────
export default function TimetableWorkspace() {
  const [tab, setTab] = useState<Tab>("config");
  const [years, setYears]     = useState<AcademicYear[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 3200);
  };

  useEffect(() => {
    void fetchList<AcademicYear>("/api/v1/core/academic-years/?page_size=50").then(setYears);
    void fetchList<SchoolClass>("/api/v1/core/classes/?page_size=200").then(setClasses);
    void fetchList<Subject>("/api/v1/core/subjects/?page_size=200").then(setSubjects);
  }, []);

  const currentYear = years.find((y) => y.is_current) ?? years[0] ?? null;
  const allSections: (Section & { className: string; level?: string | null })[] = useMemo(
    () => classes.flatMap((c) => (c.sections ?? []).map((s) => ({ ...s, className: c.name, level: c.level }))),
    [classes],
  );

  const tabs = [
    { id: "config"  as Tab, label: "Configure Hours",  icon: Clock },
    { id: "class"   as Tab, label: "Class Timetable",  icon: Calendar },
    { id: "teacher" as Tab, label: "Teacher Schedule", icon: UsersIcon },
    { id: "clash"   as Tab, label: "Clash Report",     icon: Shield },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--page)", padding: "20px 24px 60px" }}>
      {/* Header */}
      <div className="mb-5">
        <div className="text-[11px] font-bold text-[#6F767E] tracking-[0.05em] uppercase mb-1">ACADEMICS</div>
        <h1 className="m-0 text-[28px] font-extrabold text-[#15172A]">Timetable</h1>
        <p className="mt-1.5 text-[13px] text-[#5B5E72]">
          Configure working hours, build each section&apos;s weekly grid, and review teacher schedules.
        </p>
      </div>

      {/* Tab bar */}
      <div className="inline-flex gap-1 bg-[#F5F5FB] rounded-xl p-1 mb-5">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[13px] font-semibold transition-all",
              tab === id ? "bg-white text-[#4F35CC] shadow-sm" : "text-[#5B5E72] hover:bg-white/60",
            ].join(" ")}
          >
            <Icon size={14} /> {label}
            {id === "clash" && <ClashBadge />}
          </button>
        ))}
      </div>

      {tab === "config"  && <ConfigureHoursTab  academicYearId={currentYear?.id ?? null} showToast={showToast} />}
      {tab === "class"   && <ClassTimetableTab  sections={allSections} subjects={subjects} academicYearId={currentYear?.id ?? null} showToast={showToast} onSwitchToConfigureHours={() => setTab("config")} />}
      {tab === "teacher" && <TeacherScheduleTab subjects={subjects} allSections={allSections} />}
      {tab === "clash"   && <ClashReportTab     sections={allSections} subjects={subjects} academicYearId={currentYear?.id ?? null} showToast={showToast} />}

      {toast && (
        <div className={["fixed top-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold shadow-2xl max-w-sm", toast.tone === "success" ? "bg-[#15172A] text-white" : "bg-[#E0463A] text-white"].join(" ")}>
          <span>{toast.tone === "success" ? "✓" : "✕"}</span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function ClashBadge() {
  const { count } = useClashes();
  if (!count) return null;
  return (
    <span className="ml-0.5 bg-[#E0463A] text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 leading-none">
      {count}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Configure Hours tab
// ─────────────────────────────────────────────────────────────────────────────
function ConfigureHoursTab({ academicYearId, showToast }: { academicYearId: number | null; showToast: (m: string, t?: "success" | "error") => void }) {
  const { configs, loading, refetch } = useLevelScheduleConfigs(academicYearId);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[#DBE4F0] bg-[#EEEAFF] px-4 py-3 text-[13px] text-[#4F35CC]">
        Set working hours for each school division. These drive the period grid shown in the timetable.
      </div>
      {LEVEL_GROUPS.map((lg) => (
        <LevelConfigCard
          key={lg.code}
          levelGroup={lg}
          existing={configs.find((c) => c.level_group === lg.code) ?? null}
          academicYearId={academicYearId}
          onSaved={() => { void refetch(); showToast(`${lg.label} hours saved`); }}
          onError={(m) => showToast(m, "error")}
        />
      ))}
      {loading && <p className="text-[12px] text-[#9EA2C4]">Loading…</p>}
    </div>
  );
}

function LevelConfigCard({
  levelGroup, existing, academicYearId, onSaved, onError,
}: {
  levelGroup: { code: string; label: string; color: string };
  existing: LevelScheduleConfig | null;
  academicYearId: number | null;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    start_time: existing?.start_time?.slice(0, 5) ?? "08:00",
    end_time: existing?.end_time?.slice(0, 5) ?? "14:00",
    period_duration_minutes: existing?.period_duration_minutes ?? 40,
    snack_break_after_period: existing?.snack_break_after_period ?? undefined,
    snack_break_minutes: existing?.snack_break_minutes ?? undefined,
    lunch_break_after_period: existing?.lunch_break_after_period ?? undefined,
    lunch_break_minutes: existing?.lunch_break_minutes ?? undefined,
    bus_dispersal_time: existing?.bus_dispersal_time?.slice(0, 5) ?? "",
    pickup_time: existing?.pickup_time?.slice(0, 5) ?? "",
    working_days: existing?.working_days ?? ["mon", "tue", "wed", "thu", "fri"],
  });
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: string) =>
    setForm((f) => ({
      ...f,
      working_days: f.working_days.includes(d as never)
        ? f.working_days.filter((x) => x !== d)
        : [...f.working_days, d as never],
    }));

  const save = async () => {
    if (!academicYearId) { onError("No academic year found — set one up in Foundation first."); return; }
    setSaving(true);
    try {
      await saveLevelScheduleConfig(existing?.id ?? null, {
        school: undefined,
        academic_year: academicYearId,
        level_group: levelGroup.code,
        start_time: form.start_time,
        end_time: form.end_time,
        period_duration_minutes: form.period_duration_minutes,
        snack_break_after_period: form.snack_break_after_period || null,
        snack_break_minutes: form.snack_break_minutes || null,
        lunch_break_after_period: form.lunch_break_after_period || null,
        lunch_break_minutes: form.lunch_break_minutes || null,
        bus_dispersal_time: form.bus_dispersal_time || null,
        pickup_time: form.pickup_time || null,
        working_days: form.working_days,
        is_configured: true,
      } as Partial<LevelScheduleConfig>);
      onSaved();
      setOpen(false);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save — check the times entered.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#DBE4F0] bg-white shadow-sm overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: levelGroup.color }} />
          <span className="text-[14px] font-bold text-[#15172A]">{levelGroup.label}</span>
        </div>
        <div className="flex items-center gap-2">
          {existing && <span className="text-[10px] text-[#5B5E72]">{existing.start_time?.slice(0,5)} – {existing.end_time?.slice(0,5)}</span>}
          <span className={["text-[11px] font-semibold px-2.5 py-1 rounded-full", existing?.is_configured ? "bg-[#DCFCE7] text-[#15803D]" : "bg-[#FEF3C7] text-[#B45309]"].join(" ")}>
            {existing ? `${existing.periods_per_day} periods/day` : "Not configured"}
          </span>
          <span className="text-[#9EA2C4] text-[12px]">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-[#E8ECF5] grid grid-cols-2 gap-3">
          <Field label="Start Time"><input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} className="input" /></Field>
          <Field label="End Time"><input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} className="input" /></Field>
          <Field label="Period Duration (min)"><input type="number" value={form.period_duration_minutes} onChange={(e) => setForm({ ...form, period_duration_minutes: +e.target.value })} className="input" /></Field>
          <Field label="Bus Dispersal Time"><input type="time" value={form.bus_dispersal_time} onChange={(e) => setForm({ ...form, bus_dispersal_time: e.target.value })} className="input" /></Field>
          <Field label="☕ Interval After Period"><input type="number" value={form.snack_break_after_period ?? ""} onChange={(e) => setForm({ ...form, snack_break_after_period: e.target.value ? +e.target.value : undefined })} className="input" placeholder="e.g. 3" /></Field>
          <Field label="Interval Duration (min)"><input type="number" value={form.snack_break_minutes ?? ""} onChange={(e) => setForm({ ...form, snack_break_minutes: e.target.value ? +e.target.value : undefined })} className="input" placeholder="e.g. 15" /></Field>
          <Field label="🍽 Lunch After Period"><input type="number" value={form.lunch_break_after_period ?? ""} onChange={(e) => setForm({ ...form, lunch_break_after_period: e.target.value ? +e.target.value : undefined })} className="input" placeholder="e.g. 5" /></Field>
          <Field label="Lunch Duration (min)"><input type="number" value={form.lunch_break_minutes ?? ""} onChange={(e) => setForm({ ...form, lunch_break_minutes: e.target.value ? +e.target.value : undefined })} className="input" placeholder="e.g. 30" /></Field>
          <div className="col-span-2">
            <label className="text-[11px] font-semibold text-[#5B5E72] block mb-1.5">Working Days</label>
            <div className="flex gap-1.5 flex-wrap">
              {["mon", "tue", "wed", "thu", "fri", "sat"].map((d) => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  className={["px-3 py-1.5 rounded-lg text-[12px] font-semibold border capitalize transition-all", form.working_days.includes(d as never) ? "bg-[#4F35CC] text-white border-[#4F35CC]" : "bg-white text-[#5B5E72] border-[#DBE4F0] hover:border-[#4F35CC]"].join(" ")}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="col-span-2 pt-1">
            <button disabled={saving} onClick={() => void save()} className="px-5 py-2 rounded-lg bg-[#6D4AFF] text-white text-[13px] font-semibold disabled:opacity-50 hover:bg-[#5B3DE8] transition-colors">
              {saving ? "Saving…" : `Save ${levelGroup.label} Hours`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-semibold text-[#5B5E72]">{label}</label>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Class Timetable tab  ★ fully redesigned with dynamic breaks
// ─────────────────────────────────────────────────────────────────────────────
function ClassTimetableTab({
  sections, subjects, academicYearId, showToast, onSwitchToConfigureHours,
}: {
  sections: (Section & { className: string; level?: string | null })[];
  subjects: Subject[];
  academicYearId: number | null;
  showToast: (m: string, t?: "success" | "error") => void;
  onSwitchToConfigureHours: () => void;
}) {
  const router = useRouter();
  const [sectionId,    setSectionId]   = useState<number | null>(null);
  const [levelFilter,  setLevelFilter] = useState<string>("all");
  const { periods }  = useClassPeriods();
  const { configs }  = useLevelScheduleConfigs(academicYearId);
  const { slots, loading, refetch }    = useSectionRoutine(sectionId);
  const { teacherClashes, refetch: refetchClashes } = useClashes();
  const [modal, setModal]   = useState<{ day: string; start: string; end: string } | null>(null);
  const [generating, setGenerating] = useState(false);

  const section = sections.find((s) => s.id === sectionId) ?? null;

  /** LevelScheduleConfig for the currently selected section */
  const levelCfg = useMemo(() => {
    if (!section?.level) return null;
    return configs.find((c) => c.level_group === section.level) ?? null;
  }, [section, configs]);

  /**
   * Build the ordered column list:
   *  – filter only non-break periods from the API
   *  – after period N (1-indexed) == snack_break_after_period → inject "interval" col
   *  – after period N == lunch_break_after_period → inject "lunch" col
   */
  const columns: ColDef[] = useMemo(() => {
    const ivAfter   = levelCfg?.snack_break_after_period ?? null;
    const lunchAfter = levelCfg?.lunch_break_after_period ?? null;
    const classPeriods = periods.filter((p) => !p.is_break).slice(0, levelCfg?.periods_per_day ?? periods.length);
    const cols: ColDef[] = [];
    let nextStart = levelCfg ? timeToMinutes(levelCfg.start_time) : null;
    classPeriods.forEach((p, idx) => {
      const num = idx + 1;
      const start = nextStart === null ? p.start_time : minutesToTime(nextStart);
      const end = nextStart === null
        ? p.end_time
        : minutesToTime(nextStart + (levelCfg?.period_duration_minutes ?? 0));
      cols.push({ kind: "period", period: { ...p, start_time: start, end_time: end }, periodNum: num });
      if (ivAfter    !== null && num === ivAfter)
        cols.push({ kind: "interval", minutes: levelCfg?.snack_break_minutes ?? null });
      if (lunchAfter !== null && num === lunchAfter)
        cols.push({ kind: "lunch",    minutes: levelCfg?.lunch_break_minutes ?? null });
      if (nextStart !== null) {
        nextStart = nextStart + (levelCfg?.period_duration_minutes ?? 0);
        if (num === ivAfter) nextStart += levelCfg?.snack_break_minutes ?? 0;
        if (num === lunchAfter) nextStart += levelCfg?.lunch_break_minutes ?? 0;
      }
    });
    return cols;
  }, [periods, levelCfg]);

  const slotFor = (day: string, start: string) =>
    slots.find((s) => s.day === day && s.start_time.slice(0, 5) === start.slice(0, 5));

  const filteredSections = useMemo(
    () => levelFilter === "all" ? sections : sections.filter((s) => s.level === levelFilter),
    [sections, levelFilter],
  );

  const autoGenerate = async () => {
    if (!sectionId) return;
    setGenerating(true);
    try {
      const result = await autoGenerateRoutine(sectionId, academicYearId);
      showToast(`Auto-generated ${result.created_count} slot(s).`);
      void refetch(); void refetchClashes();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Auto-generate failed", "error");
    } finally { setGenerating(false); }
  };

  const clashCount  = teacherClashes.length;
  const sectionMeta = LEVEL_GROUPS.find((lg) => lg.code === section?.level);

  return (
    <div>
      {/* Legend */}
      <div className="flex items-center gap-3 text-[11px] text-[#5B5E72] mb-3 flex-wrap">
        <span className="font-semibold text-[#15172A]">Clash-safe:</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#EF4444] inline-block" />= teacher busy</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#22C55E] inline-block" />= free. Clashes blocked before assignment.</span>
      </div>

      {/* Level filter pills */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {([{ code: "all", label: "All", color: "#64748B" }, ...LEVEL_GROUPS] as { code: string; label: string; color: string }[]).map((lg) => (
          <button
            key={lg.code}
            onClick={() => { setLevelFilter(lg.code); setSectionId(null); }}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold border transition-all"
            style={levelFilter === lg.code
              ? { background: lg.color, color: "#fff", borderColor: "transparent" }
              : { background: "#fff", color: "#5B5E72", borderColor: "#E2E8F0" }}
          >
            {lg.label}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <select value={sectionId ?? ""} onChange={(e) => setSectionId(e.target.value ? +e.target.value : null)} className="input max-w-xs">
          <option value="">Select a section…</option>
          {filteredSections.map((s) => <option key={s.id} value={s.id}>{s.className} – Sec {s.name}</option>)}
        </select>
        <button disabled={!sectionId || generating} onClick={() => void autoGenerate()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#EEEAFF] text-[#4F35CC] text-[13px] font-semibold disabled:opacity-40 hover:bg-[#DDD5FF] transition-colors">
          <Zap size={14} /> {generating ? "Generating…" : "Auto-Generate"}
        </button>
        <button onClick={() => { void refetch(); void refetchClashes(); }} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E2E8F0] text-[#5B5E72] text-[13px] font-semibold hover:bg-[#F8FAFC] transition-colors">
          <RefreshCw size={14} /> Refresh
        </button>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-[#E2E8F0] text-[#5B5E72] text-[13px] font-semibold hover:bg-[#F8FAFC] transition-colors ml-auto">
          <Printer size={14} /> Print
        </button>
      </div>

      {/* Clash banner */}
      {clashCount > 0 && (
        <div className="mb-4 rounded-xl border border-[#FCA5A5] bg-[#FEF2F2] px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={15} className="text-[#EF4444] shrink-0" />
          <span className="text-[13px] font-semibold text-[#991B1B]">{clashCount} conflict{clashCount > 1 ? "s" : ""} detected.</span>
          <span className="text-[13px] text-[#B91C1C]">Go to Clash Report to fix.</span>
        </div>
      )}

      {/* Section header + break info pills */}
      {section && (
        <div className="flex flex-wrap items-center gap-2.5 mb-4">
          {sectionMeta && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: sectionMeta.color }} />}
          <h2 className="text-[16px] font-bold text-[#15172A]">{section.className} – Sec {section.name} — Weekly Schedule</h2>
          {clashCount > 0 && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-[#EF4444] bg-[#FEF2F2] px-2.5 py-1 rounded-full border border-[#FCA5A5]">
              <AlertTriangle size={10} /> Conflicts
            </span>
          )}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            {levelCfg?.snack_break_after_period ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-[#FFFBEB] text-[#D97706] px-3 py-1 rounded-full border border-[#FDE68A]">
                ☕ Interval after P{levelCfg.snack_break_after_period}{levelCfg.snack_break_minutes ? ` · ${levelCfg.snack_break_minutes} min` : ""}
              </span>
            ) : sectionId && !loading ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF] bg-[#F9FAFB] px-3 py-1 rounded-full border border-[#E5E7EB]">☕ No interval configured</span>
            ) : null}
            {levelCfg?.lunch_break_after_period ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold bg-[#FFF7ED] text-[#EA580C] px-3 py-1 rounded-full border border-[#FDBA74]">
                🍽 Lunch after P{levelCfg.lunch_break_after_period}{levelCfg.lunch_break_minutes ? ` · ${levelCfg.lunch_break_minutes} min` : ""}
              </span>
            ) : sectionId && !loading ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF] bg-[#F9FAFB] px-3 py-1 rounded-full border border-[#E5E7EB]">🍽 No lunch configured</span>
            ) : null}
          </div>
        </div>
      )}

      {/* Grid area */}
      {!sectionId ? (
        <div className="text-center py-28">
          <div className="text-[44px] mb-3 select-none">📅</div>
          <div className="text-[15px] font-bold text-[#15172A] mb-1.5">No section selected</div>
          <div className="text-[13px] text-[#9EA2C4]">Pick a section above to view its weekly timetable.</div>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-3 py-14 text-[13px] text-[#9EA2C4]">
          <RefreshCw size={16} className="animate-spin" /> Loading timetable…
        </div>
      ) : columns.filter((col) => col.kind === "period").length === 0 ? (
        <div className="rounded-xl border border-[#FEF3C7] bg-[#FFFBEB] px-4 py-4 text-[13px] text-[#B45309]">
          <p className="mb-2">
            No class periods configured yet. &quot;Configure Hours&quot; sets each level&apos;s working
            hours, but the actual class-period slots this grid reads are defined
            separately, under Setup.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              className="rounded-lg border border-[#B45309] px-3 py-1.5 text-[12px] font-semibold text-[#B45309] hover:bg-[#FEF3C7]"
              onClick={() => router.push("/setup/class-periods")}
            >
              Go to Class Periods setup →
            </button>
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[#B45309] underline"
              onClick={onSwitchToConfigureHours}
            >
              Review Configure Hours
            </button>
          </div>
        </div>
      ) : (
        /* ══ TIMETABLE GRID ══ */
        <div className="overflow-x-auto rounded-2xl shadow-xl border border-[#E2E8F0]" style={{ background: "#fff" }}>
          <table className="w-full border-collapse" style={{ minWidth: `${72 + columns.length * 108}px` }}>
            <thead>
              <tr>
                {/* DAY header */}
                <th className="sticky left-0 z-20 text-white text-[11px] font-extrabold uppercase tracking-wider px-4 py-4 text-left" style={{ background: "#1E1B4B", minWidth: 72 }}>
                  DAY
                </th>

                {columns.map((col, ci) => {
                  if (col.kind === "interval") {
                    return (
                      <th key={`iv-hd-${ci}`} className="text-white text-center py-4 px-1" style={{ background: "#D97706", minWidth: 76 }}>
                        <div className="text-[16px]">☕</div>
                        <div className="text-[10px] font-bold mt-0.5 tracking-wide">INTERVAL</div>
                        {col.minutes && <div className="text-[9px] font-normal opacity-90 mt-0.5">{col.minutes} min</div>}
                      </th>
                    );
                  }
                  if (col.kind === "lunch") {
                    return (
                      <th key={`ln-hd-${ci}`} className="text-white text-center py-4 px-1" style={{ background: "#EA580C", minWidth: 76 }}>
                        <div className="text-[16px]">🍽</div>
                        <div className="text-[10px] font-bold mt-0.5 tracking-wide">LUNCH</div>
                        {col.minutes && <div className="text-[9px] font-normal opacity-90 mt-0.5">{col.minutes} min</div>}
                      </th>
                    );
                  }
                  return (
                    <th key={col.period.id} className="text-white text-center py-4 px-2" style={{ background: "#312E81", minWidth: 108 }}>
                      <div className="text-[12px] font-semibold">Period {col.periodNum}</div>
                      <div className="text-[10px] font-normal opacity-60 mt-0.5">{col.period.start_time.slice(0, 5)} – {col.period.end_time.slice(0, 5)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {DAYS.map((day) => (
                <tr key={day} className="group border-t border-[#F1F5F9] hover:bg-[#FAFBFF] transition-colors">
                  {/* Day label — sticky */}
                  <td className="sticky left-0 z-10 font-extrabold text-[13px] px-4 py-2 border-r border-[#EDE9FE]" style={{ background: "#EEF2FF", color: "#4338CA", minWidth: 72 }}>
                    {DAY_LABEL[day]}
                  </td>

                  {columns.map((col, ci) => {
                    /* ── Interval column ── */
                    if (col.kind === "interval") {
                      return (
                        <td key={`iv-${ci}-${day}`} className="align-middle border-x border-[#F1F5F9]" style={{ background: "linear-gradient(180deg,#FFFBEB 0%,#FEF3C7 100%)", minWidth: 76 }}>
                          <div className="flex flex-col items-center justify-center py-3 gap-0.5">
                            <span className="text-[14px]">☕</span>
                            <span className="text-[8px] font-extrabold tracking-widest uppercase" style={{ color: "#D97706" }}>Break</span>
                          </div>
                        </td>
                      );
                    }

                    /* ── Lunch column ── */
                    if (col.kind === "lunch") {
                      return (
                        <td key={`ln-${ci}-${day}`} className="align-middle border-x border-[#F1F5F9]" style={{ background: "linear-gradient(180deg,#FFF7ED 0%,#FED7AA 100%)", minWidth: 76 }}>
                          <div className="flex flex-col items-center justify-center py-3 gap-0.5">
                            <span className="text-[14px]">🍽</span>
                            <span className="text-[8px] font-extrabold tracking-widest uppercase" style={{ color: "#EA580C" }}>Lunch</span>
                          </div>
                        </td>
                      );
                    }

                    /* ── Regular period cell ── */
                    const p           = col.period;
                    const slot        = slotFor(day, p.start_time);
                    const isClash     = slot && teacherClashes.some((c) => c.day === day && c.start_time.slice(0, 5) === p.start_time.slice(0, 5) && c.teacher_id === slot.teacher_id);
                    const subjectName = slot?.subject?.name ?? "";
                    const palette     = subjectName ? subjectColor(subjectName) : null;

                    return (
                      <td key={p.id} className="border-x border-[#F1F5F9] p-1.5 align-top" style={{ minWidth: 108 }}>
                        <button
                          onClick={() => setModal({ day, start: p.start_time, end: p.end_time })}
                          className={[
                            "w-full rounded-xl text-left px-3 py-2.5 transition-all border",
                            slot
                              ? isClash ? "bg-[#FEF2F2] border-2 border-[#EF4444] shadow-sm" : "border shadow-sm hover:shadow-md hover:scale-[1.02] cursor-pointer"
                              : "border-dashed border-[#CBD5E1] text-[#CBD5E1] hover:border-[#4F35CC] hover:bg-[#EEEAFF]/40 hover:text-[#4F35CC]",
                          ].join(" ")}
                          style={slot && palette && !isClash ? { background: palette.bg, borderColor: palette.border } : undefined}
                        >
                          {slot ? (
                            <div className="min-h-[44px]">
                              <div className="font-bold text-[12px] leading-snug truncate flex items-center gap-1" style={palette && !isClash ? { color: palette.text } : { color: "#1D4ED8" }}>
                                {isClash && <AlertTriangle size={10} className="text-[#EF4444] shrink-0" />}
                                {subjectName || "Free"}
                              </div>
                              <div className="text-[10px] mt-1 truncate font-medium" style={{ color: "#6B7280" }}>
                                {slot.teacher?.get_full_name ?? ""}
                              </div>
                            </div>
                          ) : (
                            <div className="min-h-[44px] flex items-center justify-center">
                              <span className="text-[22px] font-light opacity-40 select-none">＋</span>
                            </div>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && section && (
        <SlotModal
          section={section} subjects={subjects} day={modal.day}
          startTime={modal.start} endTime={modal.end}
          existing={slotFor(modal.day, modal.start) ?? null}
          academicYearId={academicYearId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); void refetch(); void refetchClashes(); showToast("Slot saved."); }}
          onError={(m) => showToast(m, "error")}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Slot assignment modal
// ─────────────────────────────────────────────────────────────────────────────
function TeacherRow({
  t, selected, onSelect, badgeExtra,
}: { t: Teacher; selected: boolean; onSelect: (id: number) => void; badgeExtra?: string }) {
  const unavailable = !!t.is_busy || !!t.is_on_leave_today;
  const statusLabel = t.is_busy ? "Busy" : t.is_on_leave_today ? "On Leave" : "Free";
  return (
    <button
      onClick={() => onSelect(t.id)}
      disabled={unavailable && !selected}
      className={["flex items-center justify-between px-3 py-2.5 rounded-xl text-[12px] text-left border transition-all w-full",
        selected ? "bg-[#EEEAFF] border-[#6D4AFF] border-2"
          : unavailable ? "bg-[#FEF2F2] border-[#FCA5A5] opacity-60 cursor-not-allowed"
          : "bg-[#F8F9FA] border-[#E8ECF5] hover:bg-[#EEEAFF] hover:border-[#A78BFA]",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-[#4F35CC] text-white text-[10px] font-bold flex items-center justify-center shrink-0">
          {initials(t.full_name)}
        </span>
        <span className="font-semibold text-[#15172A]">{t.full_name}</span>
        {badgeExtra && <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[#DDD5FF] text-[#4F35CC]">{badgeExtra}</span>}
      </div>
      <span className={["text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0", unavailable ? "bg-[#FEE2E2] text-[#EF4444]" : "bg-[#DCFCE7] text-[#16A34A]"].join(" ")}>
        ● {statusLabel}
      </span>
    </button>
  );
}

function SlotModal({
  section, subjects, day, startTime, endTime, existing, academicYearId, onClose, onSaved, onError,
}: {
  section: Section & { className: string };
  subjects: Subject[];
  day: string; startTime: string; endTime: string;
  existing: ClassRoutineSlot | null;
  academicYearId: number | null;
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [subjectId, setSubjectId] = useState<number | null>(existing?.subject_id ?? null);
  const [teacherId, setTeacherId] = useState<number | null>(existing?.teacher_id ?? null);
  const { teachers, loading } = useTeachersForSlot(subjectId, day, startTime, academicYearId, section.school_class, section.id);
  const [saving, setSaving]   = useState(false);

  /** The one teacher already on record for this subject in Staff Assignment — prefer them by default. */
  const assignedTeacher = teachers.find((t) => t.is_assigned) ?? null;
  const substituteTeachers = teachers.filter((t) => !t.is_assigned);
  const assignedUnavailable = !!assignedTeacher && (!!assignedTeacher.is_busy || !!assignedTeacher.is_on_leave_today);

  useEffect(() => {
    if (teacherId !== null || !assignedTeacher) return;
    if (!assignedTeacher.is_busy && !assignedTeacher.is_on_leave_today) setTeacherId(assignedTeacher.id);
  }, [assignedTeacher, teacherId]);

  /** Only offer subjects actually assigned to this class (Academics → Subjects), not the full school-wide catalog. */
  const { entries: classSubjects, loading: classSubjectsLoading } = useClassSubjectEntries(section.school_class);
  const availableSubjects = useMemo(() => {
    if (classSubjectsLoading) return [];
    const assignedNames = new Set(
      classSubjects.filter((e) => e.active_status).map((e) => e.name.trim().toLowerCase()),
    );
    return subjects.filter((s) => assignedNames.has(s.name.trim().toLowerCase()));
  }, [subjects, classSubjects, classSubjectsLoading]);

  const save = async () => {
    if (!subjectId) { if (existing) await remove(); else onClose(); return; }
    if (!teacherId) { onError("Pick a teacher before saving."); return; }
    setSaving(true);
    try {
      await saveSlot(existing?.id ?? null, {
        academic_year_id: academicYearId,
        class_id: section.school_class as unknown as number,
        section_id: section.id,
        subject_id: subjectId, teacher_id: teacherId,
        day, start_time: startTime, end_time: endTime,
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save this slot — the teacher may already be busy.");
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!existing) return;
    setSaving(true);
    try { await clearSlot(existing.id); onSaved(); }
    catch { onError("Could not clear this slot."); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-[15px] font-bold text-[#15172A] mb-0.5">{section.className} – Sec {section.name}</h3>
        <p className="text-[12px] text-[#6B7280] mb-4">{DAY_LABEL[day] ?? day} · {startTime.slice(0, 5)} – {endTime.slice(0, 5)}</p>
        <div className="rounded-lg bg-[#EEEAFF] text-[#4F35CC] text-[11px] px-3 py-2 mb-4">
          💡 The teacher assigned to this subject (via Staff Assignment) is picked by default. If they're busy or on leave, choose a substitute below.
        </div>
        <label className="text-[11px] font-semibold text-[#5B5E72] block mb-1">Subject</label>
        <select value={subjectId ?? ""} onChange={(e) => { setSubjectId(e.target.value ? +e.target.value : null); setTeacherId(null); }} className="input mb-4" disabled={classSubjectsLoading}>
          <option value="">— Free Period —</option>
          {availableSubjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!classSubjectsLoading && availableSubjects.length === 0 && (
          <p className="text-[11px] text-[#EF4444] -mt-3 mb-4">No subjects are assigned to this class yet — add them under Academics → Subjects.</p>
        )}
        <label className="text-[11px] font-semibold text-[#5B5E72] mb-1.5 block">Teacher</label>
        <div className="mb-5">
          {loading && <p className="text-[12px] text-[#9EA2C4]">Loading teachers…</p>}

          {!loading && subjectId && assignedTeacher && (
            <>
              <TeacherRow t={assignedTeacher} selected={teacherId === assignedTeacher.id} onSelect={setTeacherId} badgeExtra="Assigned" />
              {assignedUnavailable && (
                <div className="mt-2">
                  <p className="text-[11px] text-[#EF4444] mb-1.5">
                    {assignedTeacher.full_name} is {assignedTeacher.is_on_leave_today ? "on leave" : "already teaching another class"} for this period — choose a substitute:
                  </p>
                  <div className="max-h-40 overflow-y-auto flex flex-col gap-1.5">
                    {substituteTeachers.map((t) => (
                      <TeacherRow key={t.id} t={t} selected={teacherId === t.id} onSelect={setTeacherId} />
                    ))}
                    {substituteTeachers.length === 0 && (
                      <p className="text-[12px] text-[#9EA2C4]">No other teachers are set up for this subject.</p>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {!loading && subjectId && !assignedTeacher && (
            <div>
              <p className="text-[11px] text-[#B45309] mb-1.5">No teacher is assigned to this subject for this class yet — pick one:</p>
              <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5">
                {teachers.map((t) => (
                  <TeacherRow key={t.id} t={t} selected={teacherId === t.id} onSelect={setTeacherId} />
                ))}
                {teachers.length === 0 && <p className="text-[12px] text-[#9EA2C4]">No eligible teachers found.</p>}
              </div>
            </div>
          )}

          {!loading && !subjectId && <p className="text-[12px] text-[#9EA2C4]">Pick a subject to see the assigned teacher.</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-[#DBE4F0] text-[#5B5E72] text-[13px] font-semibold hover:bg-[#F5F5FB] transition-colors">Cancel</button>
          <button disabled={saving} onClick={() => void save()} className="px-4 py-2 rounded-lg bg-[#6D4AFF] text-white text-[13px] font-semibold disabled:opacity-50 hover:bg-[#5B3DE8] transition-colors">Save Slot</button>
          {existing && (
            <button disabled={saving} onClick={() => void remove()} className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#FEF2F2] text-[#EF4444] border border-[#FCA5A5] text-[13px] font-semibold hover:bg-[#FEE2E2] transition-colors">
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Teacher Schedule tab  ★ premium redesign
// ─────────────────────────────────────────────────────────────────────────────
/** Searchable teacher combobox — replaces a plain `<select>` whose native popup clashes with the dark hero card it sits in. */
function TeacherPicker({
  teachers, teacherId, onChange,
}: { teachers: Teacher[]; teacherId: number | null; onChange: (id: number) => void }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState("");
  const rootRef  = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = teachers.find((t) => t.id === teacherId) ?? null;
  const filtered = useMemo(
    () => teachers.filter((t) => t.full_name.toLowerCase().includes(query.trim().toLowerCase())),
    [teachers, query],
  );

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) { setQuery(""); requestAnimationFrame(() => inputRef.current?.focus()); }
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-white text-[18px] font-extrabold w-full truncate text-left"
      >
        <span className="truncate">{selected ? selected.full_name : "Select teacher…"}</span>
        <ChevronDown size={16} className="opacity-60 shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-white shadow-2xl border border-[#E2E8F0] z-30 overflow-hidden">
          <div className="p-2 border-b border-[#F1F5F9]">
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#F8FAFC] border border-[#E8ECF5]">
              <Search size={14} className="text-[#9EA2C4] shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search teacher…"
                className="bg-transparent outline-none text-[13px] text-[#15172A] w-full"
              />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => { onChange(t.id); setOpen(false); }}
                className={["w-full flex items-center gap-2 px-3 py-2 text-[13px] text-left transition-colors",
                  t.id === teacherId ? "bg-[#EEEAFF] text-[#4F35CC] font-semibold" : "text-[#15172A] hover:bg-[#F8FAFC]",
                ].join(" ")}
              >
                <span className="w-6 h-6 rounded-full bg-[#4F35CC] text-white text-[9px] font-bold flex items-center justify-center shrink-0">
                  {initials(t.full_name)}
                </span>
                <span className="truncate">{t.full_name}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-[#9EA2C4]">No teachers match "{query}".</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TeacherScheduleTab({ allSections }: { subjects: Subject[]; allSections: (Section & { className: string })[] }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState<number | null>(null);
  const { slots, loading } = useTeacherRoutine(teacherId);
  const { periods } = useClassPeriods();

  useEffect(() => {
    void fetchList<Teacher>("/api/v1/academics/staff/teachers/").then((list) => {
      setTeachers(list);
      if (list[0]) setTeacherId(list[0].id);
    });
  }, []);

  const slotFor = (day: string, start: string) =>
    slots.find((s) => s.day === day && s.start_time.slice(0, 5) === start.slice(0, 5));

  const sectionLabel = (classId: number, sectionId: number) => {
    const sec = allSections.find((s) => s.id === sectionId && (s.school_class as unknown as number) === classId);
    return sec ? `${sec.className} – ${sec.name}` : "";
  };

  const activePeriods = periods.filter((p) => !p.is_break);
  const selectedTeacher = teachers.find((t) => t.id === teacherId);
  const assignedSlots   = slots.filter((s) => !s.is_break);
  const uniqueDays      = new Set(assignedSlots.map((s) => s.day)).size;

  return (
    <div>
      {/* ── Hero header card ── */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm mb-5">
        <div className="rounded-2xl px-6 py-5 flex items-center gap-5 border-b border-[#F1F5F9]" style={{ background: "linear-gradient(135deg,#1E1B4B 0%,#312E81 100%)" }}>
          {/* Avatar */}
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-[18px] font-extrabold shrink-0 shadow-lg"
            style={{ background: "linear-gradient(135deg,#6D4AFF,#4F35CC)" }}
          >
            {selectedTeacher ? initials(selectedTeacher.full_name) : "?"}
          </div>
          {/* Name + picker */}
          <div className="flex-1 min-w-0">
            <div className="text-white text-[11px] font-semibold opacity-60 uppercase tracking-widest mb-1">Teacher Schedule</div>
            <TeacherPicker teachers={teachers} teacherId={teacherId} onChange={setTeacherId} />
            <div className="text-white/60 text-[11px] mt-0.5">Schedules are derived automatically from the Class Timetable.</div>
          </div>
          {/* Quick stats */}
          <div className="flex gap-3 shrink-0">
            <div className="text-center px-4 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.12)" }}>
              <div className="text-white text-[22px] font-extrabold leading-none">{assignedSlots.length}</div>
              <div className="text-white/60 text-[10px] mt-0.5 font-medium">Periods / Week</div>
            </div>
            <div className="text-center px-4 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.12)" }}>
              <div className="text-white text-[22px] font-extrabold leading-none">{uniqueDays}</div>
              <div className="text-white/60 text-[10px] mt-0.5 font-medium">Active Days</div>
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-14 text-[13px] text-[#9EA2C4]">
          <RefreshCw size={16} className="animate-spin" /> Loading schedule…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl shadow-xl border border-[#E2E8F0]" style={{ background: "#fff" }}>
          <table className="w-full border-collapse" style={{ minWidth: `${72 + activePeriods.length * 110}px` }}>
            <thead>
              <tr>
                <th className="sticky left-0 z-20 text-white text-[11px] font-extrabold uppercase tracking-wider px-4 py-4 text-left" style={{ background: "#1E1B4B", minWidth: 72 }}>DAY</th>
                {activePeriods.map((p, idx) => (
                  <th key={p.id} className="text-white text-center py-4 px-2" style={{ background: "#312E81", minWidth: 110 }}>
                    <div className="text-[12px] font-semibold">Period {idx + 1}</div>
                    <div className="text-[10px] font-normal opacity-60 mt-0.5">{p.start_time.slice(0, 5)} – {p.end_time.slice(0, 5)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {DAYS.map((day) => (
                <tr key={day} className="border-t border-[#F1F5F9] hover:bg-[#FAFBFF] transition-colors">
                  <td className="sticky left-0 z-10 font-extrabold text-[13px] px-4 py-2 border-r border-[#EDE9FE]" style={{ background: "#EEF2FF", color: "#4338CA", minWidth: 72 }}>
                    {DAY_LABEL[day]}
                  </td>
                  {activePeriods.map((p) => {
                    const slot = slotFor(day, p.start_time);
                    const subjectName = slot?.subject?.name ?? "";
                    const palette = subjectName ? subjectColor(subjectName) : null;
                    return (
                      <td key={p.id} className="border-x border-[#F1F5F9] p-1.5 align-top">
                        {slot ? (
                          <div
                            className="rounded-xl px-3 py-2.5 min-h-[52px] shadow-sm border transition-shadow hover:shadow-md"
                            style={palette ? { background: palette.bg, borderColor: palette.border } : { background: "#F8FAFC", borderColor: "#E2E8F0" }}
                          >
                            <div className="font-bold text-[12px] leading-tight" style={palette ? { color: palette.text } : { color: "#1D4ED8" }}>{subjectName || "Free"}</div>
                            <div className="text-[10px] text-[#6B7280] mt-1 font-medium truncate">{sectionLabel(slot.class_id, slot.section_id)}</div>
                          </div>
                        ) : (
                          <div className="min-h-[52px] flex items-center justify-center rounded-xl border border-dashed border-[#E2E8F0]">
                            <span className="text-[11px] text-[#CBD5E1] font-medium">Free</span>
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Clash Report tab  ★ premium redesign
// ─────────────────────────────────────────────────────────────────────────────
function ClashReportTab({
  sections, subjects, academicYearId, showToast,
}: {
  sections: (Section & { className: string; level?: string | null })[];
  subjects: Subject[];
  academicYearId: number | null;
  showToast: (m: string, t?: "success" | "error") => void;
}) {
  const { teacherClashes, roomClashes, count, loading, refetch } = useClashes();
  const [scanning, setScanning]   = useState(false);
  const [fixingAll, setFixingAll] = useState(false);
  const [fixModal, setFixModal]   = useState<{
    slotId: number; classId: number; sectionId: number;
    sectionName: string; className: string; day: string; startTime: string;
  } | null>(null);

  const allClashes = [
    ...teacherClashes.map((c) => ({ ...c, type: "teacher" as const })),
    ...roomClashes.map((c)   => ({ ...c, type: "room"    as const })),
  ];

  const scan = async () => { setScanning(true); await refetch(); setScanning(false); };

  const fixAll = async () => {
    setFixingAll(true);
    try {
      const toDelete: number[] = [];
      for (const clash of allClashes) toDelete.push(...clash.slots.slice(1).map((s) => s.slot_id));
      await Promise.all(toDelete.map((id) => clearSlot(id)));
      showToast(`Fixed ${toDelete.length} conflict(s).`);
      await refetch();
    } catch { showToast("Could not fix all — try fixing individually.", "error"); }
    finally { setFixingAll(false); }
  };

  const fixSection = fixModal ? sections.find((s) => s.id === fixModal.sectionId) ?? null : null;

  return (
    <div>
      {/* ── Hero header card ── */}
      <div className="rounded-2xl border border-[#E2E8F0] bg-white shadow-sm overflow-hidden mb-5">
        {/* Dark-indigo header banner */}
        <div className="px-6 py-5 flex items-center gap-5" style={{ background: "linear-gradient(135deg,#1E1B4B 0%,#312E81 100%)" }}>
          <div
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-[22px] shrink-0 shadow-lg"
            style={{ background: "linear-gradient(135deg,#EF4444,#B91C1C)" }}
          >
            🛡️
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-[11px] font-semibold opacity-60 uppercase tracking-widest mb-1">Timetable Analysis</div>
            <div className="text-white text-[20px] font-extrabold leading-tight">Clash Report</div>
            <div className="text-white/60 text-[11px] mt-0.5">Teacher assigned to two sections at the same time.</div>
          </div>
          {/* Stat pills */}
          <div className="flex gap-3 shrink-0">
            <div className="text-center px-4 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.12)" }}>
              <div className="text-white text-[22px] font-extrabold leading-none">{teacherClashes.length}</div>
              <div className="text-white/60 text-[10px] mt-0.5 font-medium">Teacher Clashes</div>
            </div>
            {roomClashes.length > 0 && (
              <div className="text-center px-4 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.12)" }}>
                <div className="text-white text-[22px] font-extrabold leading-none">{roomClashes.length}</div>
                <div className="text-white/60 text-[10px] mt-0.5 font-medium">Room Clashes</div>
              </div>
            )}
          </div>
          {/* Scan Now button */}
          <button
            onClick={() => void scan()}
            disabled={scanning}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all disabled:opacity-50 shrink-0"
            style={{ background: "rgba(255,255,255,0.15)", color: "#fff", backdropFilter: "blur(4px)" }}
          >
            <ScanLine size={15} className={scanning ? "animate-spin" : ""} />
            {scanning ? "Scanning…" : "Scan Now"}
          </button>
        </div>

        {/* Status bar below hero */}
        {loading ? (
          <div className="px-6 py-4 flex items-center gap-3 text-[13px] text-[#9EA2C4]">
            <RefreshCw size={15} className="animate-spin" /> Scanning for conflicts…
          </div>
        ) : count === 0 ? (
          <div className="px-6 py-5 flex items-center gap-4">
            <span className="w-10 h-10 rounded-xl bg-[#DCFCE7] flex items-center justify-center">
              <Shield size={20} className="text-[#16A34A]" />
            </span>
            <div>
              <div className="text-[14px] font-bold text-[#15172A]">All clear — no conflicts found</div>
              <div className="text-[12px] text-[#6B7280]">Your timetable is clean. All teachers are assigned without overlaps.</div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-4 flex items-center justify-between border-t border-[#FEE2E2]" style={{ background: "#FEF2F2" }}>
            <div className="flex items-center gap-4">
              <span className="w-10 h-10 rounded-xl bg-[#FEE2E2] flex items-center justify-center">
                <AlertTriangle size={20} className="text-[#EF4444]" />
              </span>
              <div>
                <div className="text-[15px] font-extrabold text-[#991B1B]">{count} conflict{count > 1 ? "s" : ""} detected</div>
                <div className="text-[12px] text-[#B91C1C]">
                  {teacherClashes.length} teacher clash{teacherClashes.length !== 1 ? "es" : ""}
                  {roomClashes.length > 0 && `, ${roomClashes.length} room clash${roomClashes.length !== 1 ? "es" : ""}`}
                </div>
              </div>
            </div>
            <button
              onClick={() => void fixAll()}
              disabled={fixingAll}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all disabled:opacity-50 shadow-lg hover:shadow-xl"
              style={{ background: "linear-gradient(135deg,#EF4444,#B91C1C)" }}
            >
              <WrenchIcon size={14} />
              {fixingAll ? "Fixing…" : `Fix All (${count})`}
            </button>
          </div>
        )}
      </div>

      {/* Clash cards */}
      {!loading && count > 0 && (
        <div className="space-y-3">
          {teacherClashes.map((clash, i) => (
            <ClashCard key={`teacher-${i}`} clash={clash} type="teacher"
              onFix={(slot) => setFixModal({ slotId: slot.slot_id, classId: slot.class_id, sectionId: slot.section_id, sectionName: slot.section_name, className: slot.class_name, day: clash.day, startTime: clash.start_time })}
            />
          ))}
          {roomClashes.map((clash, i) => (
            <ClashCard key={`room-${i}`} clash={clash} type="room"
              onFix={(slot) => setFixModal({ slotId: slot.slot_id, classId: slot.class_id, sectionId: slot.section_id, sectionName: slot.section_name, className: slot.class_name, day: clash.day, startTime: clash.start_time })}
            />
          ))}
        </div>
      )}

      {fixModal && fixSection && (
        <SlotModal
          section={fixSection} subjects={subjects} day={fixModal.day}
          startTime={fixModal.startTime} endTime={fixModal.startTime}
          existing={{ id: fixModal.slotId } as unknown as ClassRoutineSlot}
          academicYearId={academicYearId}
          onClose={() => setFixModal(null)}
          onSaved={() => { setFixModal(null); void refetch(); showToast("Conflict resolved."); }}
          onError={(m) => showToast(m, "error")}
        />
      )}
    </div>
  );
}

function ClashCard({
  clash, type, onFix,
}: {
  clash: ClashEntry;
  type: "teacher" | "room";
  onFix: (slot: ClashEntry["slots"][0]) => void;
}) {
  const name        = type === "teacher" ? (clash.teacher_name ?? "Unknown Teacher") : (clash.room_name ?? "Unknown Room");
  const dayLabel    = DAY_LABEL[clash.day] ?? clash.day;
  const timeLabel   = clash.start_time.slice(0, 5);

  return (
    <div className="rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-all border border-[#E8ECF5] bg-white">
      {/* Card header — dark indigo strip */}
      <div className="px-5 py-4 flex items-center gap-4" style={{ background: "linear-gradient(135deg,#1E1B4B 0%,#312E81 100%)" }}>
        {/* Avatar */}
        <div
          className="w-11 h-11 rounded-xl flex items-center justify-center text-white text-[14px] font-extrabold shrink-0 shadow-md"
          style={{ background: type === "teacher" ? "linear-gradient(135deg,#EF4444,#B91C1C)" : "linear-gradient(135deg,#F97316,#C2410C)" }}
        >
          {initials(name)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-extrabold text-[14px] truncate">{name}</div>
          {/* Period time badge */}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>
              {dayLabel}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: "rgba(255,255,255,0.18)", color: "#fff" }}>
              {timeLabel}
            </span>
          </div>
        </div>
        <span
          className="text-[10px] font-extrabold uppercase tracking-widest px-3 py-1.5 rounded-full shrink-0"
          style={type === "teacher"
            ? { background: "rgba(239,68,68,0.25)", color: "#FCA5A5" }
            : { background: "rgba(249,115,22,0.25)", color: "#FDBA74" }}
        >
          {type === "teacher" ? "Teacher Clash" : "Room Clash"}
        </span>
      </div>

      {/* Conflicting slots */}
      <div className="px-5 py-4 space-y-2.5">
        {clash.slots.map((slot, si) => {
          const subjColor = slot.subject_name ? subjectColor(slot.subject_name) : null;
          return (
            <div
              key={slot.slot_id}
              className="flex items-center gap-3 rounded-xl border px-4 py-3 transition-all hover:shadow-sm"
              style={{ borderColor: "#E8ECF5", background: "#FAFBFF" }}
            >
              {/* Number badge */}
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-extrabold shrink-0"
                style={{ background: si === 0 ? "#4338CA" : "#EF4444" }}
              >
                {si + 1}
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-[#15172A] truncate">
                  {slot.class_name} – Sec {slot.section_name}
                </div>
                {slot.subject_name && (
                  <span
                    className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                    style={subjColor ? { background: subjColor.bg, color: subjColor.text, border: `1px solid ${subjColor.border}` } : {}}
                  >
                    {slot.subject_name}
                  </span>
                )}
              </div>

              <button
                onClick={() => onFix(slot)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-white text-[12px] font-bold transition-all hover:shadow-md shrink-0"
                style={{ background: "linear-gradient(135deg,#4F35CC,#312E81)" }}
              >
                <WrenchIcon size={12} /> Fix this
              </button>
            </div>
          );
        })}

        <p className="text-[11px] text-[#9CA3AF] px-1 pt-0.5">
          Assigned to: {clash.slots.map((s) => `${s.class_name} – Sec ${s.section_name}`).join(" + ")} at the same time
        </p>
      </div>
    </div>
  );
}

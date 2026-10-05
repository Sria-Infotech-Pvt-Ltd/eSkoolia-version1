"use client";
/**
 * Examination › Conduct & Marks — "during exam" group: exam-day attendance,
 * then marks entry, monitored subject-by-subject and cross-checked
 * student-by-student. Wired to the real backend (apps/exams/views.py —
 * the ExamAttendance, ExamMarksRegister and ExamMarksProgressSummaryAPIView
 * view classes) via hooks/useExamsApi.ts — replaces the earlier static
 * mockup. Palette from
 * lib/examTheme.ts.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardList, UserCheck, CheckSquare, AlertTriangle } from "lucide-react";
import { examTheme as T } from "@/lib/examTheme";
import { Accordion, Badge, StepPills, ProgressBar, type Tone } from "@/components/exams/ExamUi";
import {
  ExamsApiError,
  searchExamAttendanceCreate,
  searchExamMarksCreate,
  searchExamMarksReport,
  storeExamAttendance,
  storeExamMarks,
  useExamAttendanceCriteria,
  useExamMarksProgress,
  type ExamMarksStoreRow,
} from "@/hooks/useExamsApi";
import type { ExamAttendanceStudentRow, ExamMarkRegisterRow, ExamMarksCreateStudentRow } from "@/types/exams";
import { useExamFocus } from "@/contexts/ExamFocusContext";
import { ExamContextBar } from "@/components/exams/ExamContextBar";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: T.ink2 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.purple, display: "inline-block" }} />
      {children}
    </div>
  );
}

const selectSx: React.CSSProperties = {
  height: 34, borderRadius: 8, border: `1px solid ${T.borderStrong}`,
  padding: "0 10px", fontSize: 12.5, color: T.ink1, background: "#fff", outline: "none",
};

const gradeTone = (g: string): Tone => (g.startsWith("A") ? "ok" : g.startsWith("B") ? "info" : g.startsWith("C") ? "warn" : "danger");

interface MatrixRow { rollNo: string; name: string; grades: Record<string, string | null>; absentSubjects: Set<string> }

export default function ConductAndMarksPage() {
  const { data: criteria } = useExamAttendanceCriteria();
  const { examTypeId: examId, setExamTypeId, hydrated: examFocusHydrated } = useExamFocus();
  const [step, setStep] = useState(1);

  useEffect(() => {
    if (!examFocusHydrated) return;
    if (examId === null && criteria?.exams.length) setExamTypeId(criteria.exams[0].id);
  }, [criteria, examFocusHydrated, examId, setExamTypeId]);

  const examTitle = criteria?.exams.find((e) => e.id === examId)?.title ?? "";

  // ─── Step 1: attendance ───────────────────────────────────────────────────
  const [attSubjectId, setAttSubjectId] = useState<number | null>(null);
  const [attClassId, setAttClassId] = useState<number | null>(null);
  const [attSectionId, setAttSectionId] = useState<number | null>(null);
  const [attStudents, setAttStudents] = useState<ExamAttendanceStudentRow[]>([]);
  // Undefined/missing entries mean "not marked yet" — never assume Present, so a student
  // that's never been toggled can't slip through as a false attendance record.
  const [attMap, setAttMap] = useState<Record<number, "P" | "A" | undefined>>({});
  const [attSearching, setAttSearching] = useState(false);
  const [attSaving, setAttSaving] = useState(false);
  const [attError, setAttError] = useState<string | null>(null);
  const [attSaved, setAttSaved] = useState(false);

  const attSectionsForClass = useMemo(() => (criteria?.sections ?? []).filter((s) => s.class_id === attClassId), [criteria, attClassId]);

  useEffect(() => {
    if (!examId || !attSubjectId || !attClassId) { setAttStudents([]); return; }
    setAttSearching(true);
    setAttError(null);
    setAttSaved(false);
    searchExamAttendanceCreate({ exam: examId, subject: attSubjectId, class_id: attClassId, section: attSectionId ?? undefined })
      .then((res) => {
        setAttStudents(res.students);
        const map: Record<number, "P" | "A" | undefined> = {};
        res.students.forEach((s) => {
          // Only trust an explicit P/A already recorded for this student — anything else
          // (missing, null, empty string) stays unmarked rather than defaulting to Present.
          map[s.student_record_id] = s.attendance_type === "P" || s.attendance_type === "A" ? s.attendance_type : undefined;
        });
        setAttMap(map);
      })
      .catch((e) => { setAttStudents([]); setAttError(e instanceof ExamsApiError ? e.message : "Failed to load roster."); })
      .finally(() => setAttSearching(false));
  }, [examId, attSubjectId, attClassId, attSectionId]);

  const presentCount = attStudents.filter((s) => attMap[s.student_record_id] === "P").length;
  const unmarkedCount = attStudents.filter((s) => attMap[s.student_record_id] !== "P" && attMap[s.student_record_id] !== "A").length;

  // Bulk default + individual exceptions, instead of tapping every student one by one —
  // still fully reversible per-row before Save, so it's a shortcut, not a forced default.
  const markAllPresent = () => {
    setAttMap((m) => {
      const next = { ...m };
      attStudents.forEach((s) => { next[s.student_record_id] = "P"; });
      return next;
    });
  };

  const handleSaveAttendance = async () => {
    if (!examId || !attSubjectId || !attClassId || unmarkedCount > 0) return;
    setAttSaving(true);
    setAttError(null);
    try {
      const attendance: Record<string, { student: number; attendance_type: "P" | "A" }> = {};
      attStudents.forEach((s) => {
        const marked = attMap[s.student_record_id];
        if (marked) attendance[String(s.student_record_id)] = { student: s.student, attendance_type: marked };
      });
      await storeExamAttendance({ exam_id: examId, subject_id: attSubjectId, class_id: attClassId, section_id: attSectionId, attendance });
      setAttSaved(true);
    } catch (e) {
      setAttError(e instanceof ExamsApiError ? e.message : "Failed to save attendance.");
    } finally {
      setAttSaving(false);
    }
  };

  // ─── Step 2: marks entry ──────────────────────────────────────────────────
  // Real backend (ExamMarksRegisterCreateSearchAPIView / StoreAPIView) — the
  // backend enforces its own real gates here: it 400s if exam-day attendance
  // hasn't been recorded yet for this subject, or if no Exam Setup exists for
  // this class/subject/exam, so both surface as plain messages instead of an
  // empty mock grid.
  const [marksSubjectId, setMarksSubjectId] = useState<number | null>(null);
  const [marksClassId, setMarksClassId] = useState<number | null>(null);
  const [marksSectionId, setMarksSectionId] = useState<number | null>(null);
  const marksSectionsForClass = useMemo(() => (criteria?.sections ?? []).filter((s) => s.class_id === marksClassId), [criteria, marksClassId]);

  const [marksComponents, setMarksComponents] = useState<{ id: number; exam_title: string; exam_mark: string }[]>([]);
  const [marksStudents, setMarksStudents] = useState<ExamMarksCreateStudentRow[]>([]);
  const [marksValues, setMarksValues] = useState<Record<number, Record<number, string>>>({});
  const [marksAbsent, setMarksAbsent] = useState<Record<number, boolean>>({});
  const [marksSearching, setMarksSearching] = useState(false);
  const [marksSaving, setMarksSaving] = useState(false);
  const [marksError, setMarksError] = useState<string | null>(null);
  const [marksSaved, setMarksSaved] = useState(false);

  useEffect(() => {
    if (!examId || !marksSubjectId || !marksClassId) {
      setMarksStudents([]);
      setMarksComponents([]);
      return;
    }
    setMarksSearching(true);
    setMarksError(null);
    setMarksSaved(false);
    searchExamMarksCreate({ exam: examId, subject: marksSubjectId, class_id: marksClassId, section: marksSectionId ?? undefined })
      .then((res) => {
        setMarksStudents(res.students);
        setMarksComponents(res.marks_entry_form);
        const values: Record<number, Record<number, string>> = {};
        const absent: Record<number, boolean> = {};
        res.students.forEach((s) => {
          values[s.student_record_id] = {};
          res.marks_entry_form.forEach((c) => { values[s.student_record_id][c.id] = s.marks[String(c.id)] ?? ""; });
          absent[s.student_record_id] = s.is_absent;
        });
        setMarksValues(values);
        setMarksAbsent(absent);
      })
      .catch((e) => {
        setMarksStudents([]);
        setMarksComponents([]);
        // Non-OK responses reach here as a plain Error from lib/api-auth (not ExamsApiError);
        // both carry the backend's gate message (attendance not taken / setup not done).
        setMarksError(e instanceof Error ? e.message : "Failed to load marks entry roster.");
      })
      .finally(() => setMarksSearching(false));
  }, [examId, marksSubjectId, marksClassId, marksSectionId]);

  const isOverMax = (recordId: number, componentId: number, maxMark: string) =>
    Number(marksValues[recordId]?.[componentId] ?? 0) > Number(maxMark);
  const hasOverMaxEntry = marksStudents.some((s) => marksComponents.some((c) => isOverMax(s.student_record_id, c.id, c.exam_mark)));

  const handleSaveMarksEntry = async () => {
    if (!examId || !marksSubjectId || !marksClassId || marksStudents.length === 0) return;
    setMarksSaving(true);
    setMarksError(null);
    try {
      const markStore: Record<string, ExamMarksStoreRow> = {};
      marksStudents.forEach((s) => {
        const recordId = s.student_record_id;
        const marks: Record<string, string> = {};
        marksComponents.forEach((c) => { marks[String(c.id)] = marksValues[recordId]?.[c.id] || "0"; });
        markStore[String(recordId)] = {
          student: s.student,
          section: s.section,
          marks,
          teacher_remarks: s.teacher_remarks,
          absent_students: marksAbsent[recordId] ? [recordId] : [],
        };
      });
      await storeExamMarks({ exam_id: examId, class_id: marksClassId, section_id: marksSectionId, subject_id: marksSubjectId, markStore });
      setMarksSaved(true);
      window.setTimeout(() => setMarksSaved(false), 2500);
    } catch (e) {
      setMarksError(e instanceof ExamsApiError ? e.message : "Failed to save marks.");
    } finally {
      setMarksSaving(false);
    }
  };

  // ─── Bulk entry: CSV export/import + spreadsheet-style Enter navigation ────
  // Export/import round-trip through the same column shape (roll_no + one
  // column per mark component) so a teacher can fill marks in a spreadsheet
  // offline and bring them back in — nothing here bypasses the real Save
  // above, it only pre-fills the same grid state that button already sends.
  const [csvError, setCsvError] = useState<string | null>(null);

  const parseCsvLine = (line: string): string[] => {
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cur += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ",") { cells.push(cur); cur = ""; }
      else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  };

  const handleExportMarksCsv = () => {
    const header = ["roll_no", "student", ...marksComponents.map((c) => c.exam_title)];
    const lines = [header];
    marksStudents.forEach((s) => {
      lines.push([
        s.roll_no,
        `${s.first_name} ${s.last_name}`.trim(),
        ...marksComponents.map((c) => marksValues[s.student_record_id]?.[c.id] || "0"),
      ]);
    });
    const csv = lines.map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `marks-entry-${marksSubjectId ?? "export"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportMarksCsv = (file: File) => {
    setCsvError(null);
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length < 2) throw new Error("CSV has no data rows.");
        const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
        const rollIdx = header.indexOf("roll_no");
        if (rollIdx === -1) throw new Error('CSV must have a "roll_no" column, matching the exported format.');
        const componentCols = marksComponents.map((c) => ({ id: c.id, idx: header.indexOf(c.exam_title.toLowerCase()) }));

        const byRoll = new Map(marksStudents.map((s) => [s.roll_no.trim(), s]));
        let matched = 0;
        setMarksValues((prev) => {
          const next = { ...prev };
          for (let i = 1; i < lines.length; i++) {
            const cells = parseCsvLine(lines[i]);
            const student = byRoll.get((cells[rollIdx] || "").trim());
            if (!student) continue;
            matched++;
            const recordId = student.student_record_id;
            next[recordId] = { ...next[recordId] };
            componentCols.forEach(({ id, idx }) => {
              if (idx === -1 || cells[idx] === undefined || cells[idx] === "") return;
              next[recordId][id] = cells[idx].replace(/[^0-9.]/g, "");
            });
          }
          return next;
        });
        if (matched === 0) setCsvError("No rows matched this roster — check that roll_no values line up.");
      } catch (e) {
        setCsvError(e instanceof Error ? e.message : "Failed to read CSV file.");
      }
    };
    reader.readAsText(file);
  };

  // Enter moves down the same column (spreadsheet convention) instead of
  // submitting or doing nothing — Tab still moves across via native browser order.
  const handleMarkKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, componentId: number) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const nextRow = marksStudents[rowIndex + 1];
    if (!nextRow) return;
    document.getElementById(`mark-${nextRow.student_record_id}-${componentId}`)?.focus();
  };

  // ─── Step 2: marks progress monitor + cross-check matrix ─────────────────
  const { data: progress, loading: progressLoading } = useExamMarksProgress(examId);
  const progressRows = useMemo(() => progress?.rows ?? [], [progress]);

  const classSectionOptions = useMemo(() => {
    const seen = new Map<string, { classId: number; className: string; sectionId: number | null; sectionName: string }>();
    progressRows.forEach((r) => {
      const key = `${r.class_id}-${r.section_id ?? "all"}`;
      if (!seen.has(key)) seen.set(key, { classId: r.class_id, className: r.class_name, sectionId: r.section_id, sectionName: r.section_name });
    });
    return Array.from(seen.values());
  }, [progressRows]);

  const [matrixKey, setMatrixKey] = useState<string>("");
  useEffect(() => {
    if (!matrixKey && classSectionOptions.length) setMatrixKey(`${classSectionOptions[0].classId}-${classSectionOptions[0].sectionId ?? "all"}`);
  }, [classSectionOptions, matrixKey]);

  const matrixScope = classSectionOptions.find((o) => `${o.classId}-${o.sectionId ?? "all"}` === matrixKey) ?? null;
  const matrixSubjects = useMemo(
    () => progressRows.filter((r) => matrixScope && r.class_id === matrixScope.classId && (r.section_id ?? null) === (matrixScope.sectionId ?? null)),
    [progressRows, matrixScope],
  );

  const [matrixRows, setMatrixRows] = useState<MatrixRow[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);

  useEffect(() => {
    if (!examId || !matrixScope || !matrixSubjects.length) { setMatrixRows([]); return; }
    let cancelled = false;
    setMatrixLoading(true);
    Promise.all(
      matrixSubjects.map((s) =>
        searchExamMarksReport({ exam: examId, subject: s.subject_id, class_id: matrixScope.classId, section: matrixScope.sectionId ?? undefined })
          .then((res) => ({ subjectName: s.subject_name, rows: res.marks_registers }))
          .catch(() => ({ subjectName: s.subject_name, rows: [] as ExamMarkRegisterRow[] })),
      ),
    ).then((perSubject) => {
      if (cancelled) return;
      const byStudent = new Map<string, MatrixRow>();
      perSubject.forEach(({ subjectName, rows }) => {
        rows.forEach((row) => {
          const key = row.roll_no || String(row.student);
          if (!byStudent.has(key)) {
            byStudent.set(key, { rollNo: row.roll_no, name: `${row.first_name} ${row.last_name}`.trim(), grades: {}, absentSubjects: new Set() });
          }
          const entry = byStudent.get(key)!;
          if (row.is_absent) entry.absentSubjects.add(subjectName);
          else entry.grades[subjectName] = row.total_gpa_grade || row.total_marks;
        });
      });
      setMatrixRows(Array.from(byStudent.values()).sort((a, b) => a.rollNo.localeCompare(b.rollNo)));
    }).finally(() => { if (!cancelled) setMatrixLoading(false); });
    return () => { cancelled = true; };
  }, [examId, matrixScope, matrixSubjects]);

  return (
    <div style={{ minHeight: "100%", background: T.page, padding: "12px 20px 40px" }}>
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 16, padding: 24 }}>
        {/* Breadcrumb */}
        <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 12 }}>
          <Link href="/dashboard" style={{ color: T.ink2, textDecoration: "none" }}>Dashboard</Link>
          <span style={{ color: T.ink3 }}>/</span>
          <Link href="/exams/command-center" style={{ color: T.ink2, textDecoration: "none" }}>Examinations</Link>
          <span style={{ color: T.ink3 }}>/</span>
          <span style={{ color: T.ink1, fontWeight: 600 }}>Conduct & Marks</span>
        </nav>

        <Link
          href="/exams/command-center"
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600,
            color: T.ink1, textDecoration: "none", border: `1px solid ${T.borderStrong}`,
            borderRadius: 8, padding: "6px 12px", background: "#fff", marginBottom: 16,
          }}
        >
          <ArrowLeft size={13} /> Back to Command Center
        </Link>

        {/* Hero */}
        <div style={{ marginBottom: 16 }}>
          <Eyebrow>Conduct & Marks · {examTitle || "Loading…"}</Eyebrow>
          <h1 style={{ margin: "6px 0 6px", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, fontSize: 30 }}>
            <span style={{ fontFamily: "Georgia, serif", fontWeight: 900, color: T.ink1 }}>Marks are entered</span>
            <span style={{ fontFamily: '"Playfair Display", Georgia, serif', fontStyle: "italic", fontWeight: 500, color: T.purple }}>
              by the teacher who taught it.
            </span>
          </h1>
          <p style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, maxWidth: 640, margin: "0 0 14px" }}>
            Each subject teacher takes their own roll call and enters their own marks. This screen tracks
            who&apos;s done and who still needs a nudge.
          </p>
        </div>

        <ExamContextBar
          icon={ClipboardList}
          options={criteria?.exams ?? []}
          note="Shared with Results & Reports — one exam in focus at a time, everywhere."
        />

        <div style={{ marginBottom: 16 }}>
          <StepPills step={step} setStep={setStep} steps={["Exam-day Attendance", "Marks Entry"]} />
        </div>

        {step === 1 ? (
          <>
            <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: T.ink1, marginBottom: 10 }}>
                <UserCheck size={15} color={T.purple} strokeWidth={2} /> Exam-day attendance
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <select style={selectSx} value={attSubjectId ?? ""} onChange={(e) => setAttSubjectId(Number(e.target.value) || null)}>
                  <option value="">Select subject</option>
                  {(criteria?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                </select>
                <select style={selectSx} value={attClassId ?? ""} onChange={(e) => { setAttClassId(Number(e.target.value) || null); setAttSectionId(null); }}>
                  <option value="">Select class</option>
                  {(criteria?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.class_name}</option>)}
                </select>
                <select style={selectSx} value={attSectionId ?? ""} onChange={(e) => setAttSectionId(Number(e.target.value) || null)}>
                  <option value="">All sections</option>
                  {attSectionsForClass.map((s) => <option key={s.id} value={s.id}>{s.section_name}</option>)}
                </select>
              </div>
            </div>

            {attError && (
              <div style={{ background: T.dangerSoft, color: T.danger, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{attError}</div>
            )}
            {attSaved && (
              <div style={{ background: T.okSoft, color: T.ok, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>Attendance saved.</div>
            )}

            {attSearching && <div style={{ fontSize: 12.5, color: T.ink3 }}>Loading roster…</div>}

            {!attSearching && attStudents.length > 0 && (
              <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Badge tone="ok">{presentCount}/{attStudents.length} present</Badge>
                    {unmarkedCount > 0 && <Badge tone="warn">{unmarkedCount} not marked</Badge>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      type="button" onClick={markAllPresent}
                      title="Sets every student to Present — mark individual exceptions afterward."
                      style={{
                        height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid ${T.borderStrong}`, background: "#fff", color: T.ink1,
                        fontSize: 12.5, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      Mark all present
                    </button>
                    <button
                      type="button" onClick={handleSaveAttendance} disabled={attSaving || unmarkedCount > 0}
                      title={unmarkedCount > 0 ? "Mark every student Present or Absent before saving." : undefined}
                      style={{
                        height: 34, padding: "0 14px", borderRadius: 8, border: `1px solid ${T.purple}`, background: T.purple, color: "#fff",
                        fontSize: 12.5, fontWeight: 700, cursor: attSaving || unmarkedCount > 0 ? "not-allowed" : "pointer", opacity: attSaving || unmarkedCount > 0 ? 0.6 : 1,
                      }}
                    >
                      {attSaving ? "Saving…" : "Save attendance"}
                    </button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "70px 1fr 180px", gap: 8, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0 4px 6px" }}>
                  <span>Roll</span><span>Student</span><span>Attendance</span>
                </div>
                {attStudents.map((s) => {
                  const current = attMap[s.student_record_id];
                  return (
                    <div key={s.student_record_id} style={{ display: "grid", gridTemplateColumns: "70px 1fr 180px", gap: 8, padding: "6px 4px", fontSize: 12.5, color: T.ink1, borderTop: `1px solid ${T.border}`, alignItems: "center" }}>
                      <span style={{ fontFamily: "monospace" }}>{s.roll_no}</span>
                      <span>{s.first_name} {s.last_name}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => setAttMap((m) => ({ ...m, [s.student_record_id]: "P" }))}
                          style={{
                            height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            border: `1px solid ${current === "P" ? T.ok : T.borderStrong}`,
                            background: current === "P" ? T.okSoft : "#fff",
                            color: current === "P" ? T.ok : T.ink3,
                          }}
                        >
                          Present
                        </button>
                        <button
                          type="button"
                          onClick={() => setAttMap((m) => ({ ...m, [s.student_record_id]: "A" }))}
                          style={{
                            height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            border: `1px solid ${current === "A" ? T.danger : T.borderStrong}`,
                            background: current === "A" ? T.dangerSoft : "#fff",
                            color: current === "A" ? T.danger : T.ink3,
                          }}
                        >
                          Absent
                        </button>
                        {!current && <span style={{ fontSize: 10.5, color: T.ink3, alignSelf: "center" }}>Not marked</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: T.ink1, marginBottom: 10 }}>
                <CheckSquare size={15} color={T.purple} strokeWidth={2} /> Marks entry
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <select style={selectSx} value={marksSubjectId ?? ""} onChange={(e) => setMarksSubjectId(Number(e.target.value) || null)}>
                  <option value="">Select subject</option>
                  {(criteria?.subjects ?? []).map((s) => <option key={s.id} value={s.id}>{s.subject_name}</option>)}
                </select>
                <select style={selectSx} value={marksClassId ?? ""} onChange={(e) => { setMarksClassId(Number(e.target.value) || null); setMarksSectionId(null); }}>
                  <option value="">Select class</option>
                  {(criteria?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.class_name}</option>)}
                </select>
                <select style={selectSx} value={marksSectionId ?? ""} onChange={(e) => setMarksSectionId(Number(e.target.value) || null)}>
                  <option value="">All sections</option>
                  {marksSectionsForClass.map((s) => <option key={s.id} value={s.id}>{s.section_name}</option>)}
                </select>
              </div>
            </div>

            {marksError && (
              <div style={{ background: T.dangerSoft, color: T.danger, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{marksError}</div>
            )}
            {csvError && (
              <div style={{ background: T.dangerSoft, color: T.danger, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>{csvError}</div>
            )}
            {marksSaved && (
              <div style={{ background: T.okSoft, color: T.ok, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 12 }}>Marks saved.</div>
            )}
            {marksSearching && <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 16 }}>Loading roster…</div>}

            {!marksSearching && marksStudents.length > 0 && (
              <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, marginBottom: 16, overflowX: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
                  <Badge tone="neutral">{marksStudents.length} student{marksStudents.length === 1 ? "" : "s"}</Badge>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    {hasOverMaxEntry && <span style={{ fontSize: 12, fontWeight: 600, color: T.danger }}>A mark exceeds its component&apos;s full mark.</span>}
                    <button
                      type="button" onClick={handleExportMarksCsv}
                      title="Download the current grid as a CSV to edit in a spreadsheet"
                      style={{ height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid ${T.borderStrong}`, background: "#fff", color: T.ink1, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                    >
                      Export CSV
                    </button>
                    <label
                      title="Import a CSV with a roll_no column plus one column per mark component"
                      style={{ height: 34, padding: "0 12px", borderRadius: 8, border: `1px solid ${T.borderStrong}`, background: "#fff", color: T.ink1, fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                    >
                      Import CSV
                      <input
                        type="file" accept=".csv,text/csv" style={{ display: "none" }}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleImportMarksCsv(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <button
                      type="button" onClick={() => void handleSaveMarksEntry()} disabled={marksSaving || hasOverMaxEntry}
                      style={{
                        height: 34, padding: "0 14px", borderRadius: 8, border: `1px solid ${T.purple}`, background: T.purple, color: "#fff",
                        fontSize: 12.5, fontWeight: 700, cursor: marksSaving || hasOverMaxEntry ? "not-allowed" : "pointer", opacity: marksSaving || hasOverMaxEntry ? 0.6 : 1,
                      }}
                    >
                      {marksSaving ? "Saving…" : "Save marks"}
                    </button>
                  </div>
                </div>
                <div style={{ minWidth: 420 + marksComponents.length * 100 }}>
                  <div style={{ display: "grid", gridTemplateColumns: `60px 1.3fr repeat(${marksComponents.length}, 100px) 90px`, gap: 8, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", padding: "0 4px 6px" }}>
                    <span>Roll</span><span>Student</span>
                    {marksComponents.map((c) => <span key={c.id}>{c.exam_title} /{c.exam_mark}</span>)}
                    <span>Absent</span>
                  </div>
                  {marksStudents.map((s, rowIndex) => {
                    const absent = !!marksAbsent[s.student_record_id];
                    return (
                      <div
                        key={s.student_record_id}
                        style={{ display: "grid", gridTemplateColumns: `60px 1.3fr repeat(${marksComponents.length}, 100px) 90px`, gap: 8, padding: "6px 4px", fontSize: 12.5, color: T.ink1, borderTop: `1px solid ${T.border}`, alignItems: "center", opacity: absent ? 0.55 : 1 }}
                      >
                        <span style={{ fontFamily: "monospace" }}>{s.roll_no}</span>
                        <span>{s.first_name} {s.last_name}</span>
                        {marksComponents.map((c) => {
                          const overMax = isOverMax(s.student_record_id, c.id, c.exam_mark);
                          return (
                            <input
                              key={c.id}
                              id={`mark-${s.student_record_id}-${c.id}`}
                              type="number" min={0} max={c.exam_mark} placeholder="0" disabled={absent}
                              value={marksValues[s.student_record_id]?.[c.id] ?? ""}
                              onChange={(e) => setMarksValues((m) => ({ ...m, [s.student_record_id]: { ...m[s.student_record_id], [c.id]: e.target.value } }))}
                              onKeyDown={(e) => handleMarkKeyDown(e, rowIndex, c.id)}
                              style={{ height: 30, borderRadius: 7, border: `1px solid ${overMax ? T.danger : T.borderStrong}`, padding: "0 8px", fontSize: 12.5, color: T.ink1, width: "100%" }}
                            />
                          );
                        })}
                        <button
                          type="button"
                          onClick={() => setMarksAbsent((m) => ({ ...m, [s.student_record_id]: !absent }))}
                          style={{
                            height: 26, padding: "0 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, cursor: "pointer",
                            border: `1px solid ${absent ? T.danger : T.ok}`, background: absent ? T.dangerSoft : T.okSoft, color: absent ? T.danger : T.ok,
                          }}
                        >
                          {absent ? "Absent" : "Present"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {!marksSearching && marksSubjectId && marksClassId && marksStudents.length === 0 && !marksError && (
              <div style={{ fontSize: 13, color: T.danger, background: T.dangerSoft, padding: "12px 16px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, fontWeight: 600, marginBottom: 16 }}>
                <AlertTriangle size={16} /> No students found for this subject/class/section. Please check if they are assigned.
              </div>
            )}

            {progress && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.ink1, whiteSpace: "nowrap" }}>{progress.total_entered} / {progress.total_expected} entered</span>
                <div style={{ flex: 1 }}><ProgressBar value={progress.percent} /></div>
                <span style={{ fontSize: 13, fontWeight: 700, color: T.purple }}>{progress.percent}%</span>
              </div>
            )}

            <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 1fr 1fr 1fr", gap: 8, padding: "10px 16px", fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", borderBottom: `1px solid ${T.border}` }}>
                <span>Subject</span><span>Class</span><span>Teacher</span><span>Progress</span><span>Status</span>
              </div>
              {progressLoading && <div style={{ padding: 16, fontSize: 12.5, color: T.ink3 }}>Loading…</div>}
              {!progressLoading && progressRows.length === 0 && (
                <div style={{ fontSize: 13, color: T.ink2, background: T.hoverSoft, padding: "12px 16px", margin: "16px", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                  <AlertTriangle size={16} /> No exam schedule found for {examTitle} yet.
                </div>
              )}
              {progressRows.map((r, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr 1fr 1fr 1fr", gap: 8, alignItems: "center", padding: "10px 16px", fontSize: 12.5, color: T.ink1, borderBottom: `1px solid ${T.border}` }}>
                  <span>{r.subject_name}</span>
                  <span>{r.class_name}-{r.section_name}</span>
                  <span>{r.teacher_name || "—"}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 11.5, color: T.ink2 }}>{r.entered}/{r.total}</span>
                  <span>
                    <Badge tone={r.status === "complete" ? "ok" : r.status === "in_progress" ? "warn" : "danger"}>
                      {r.status === "complete" ? "Complete" : r.status === "in_progress" ? "In progress" : "Not started"}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>

            <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 16, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 700, color: T.ink1, marginBottom: 10 }}>
                <CheckSquare size={15} color={T.purple} strokeWidth={2} /> Cross-check scores entered
              </div>
              <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                <select style={selectSx} value={matrixKey} onChange={(e) => setMatrixKey(e.target.value)}>
                  {classSectionOptions.map((o) => {
                    const key = `${o.classId}-${o.sectionId ?? "all"}`;
                    return <option key={key} value={key}>{o.className}-{o.sectionName}</option>;
                  })}
                </select>
              </div>

              {matrixLoading && <div style={{ fontSize: 12.5, color: T.ink3 }}>Loading…</div>}
              {!matrixLoading && matrixRows.length > 0 && (
                <Accordion title={matrixScope ? `${matrixScope.className}-${matrixScope.sectionName}` : ""} right={<Badge tone="neutral">{matrixRows.length} students</Badge>} defaultOpen>
                  <div style={{ overflowX: "auto" }}>
                    <div style={{ display: "grid", gridTemplateColumns: `60px 1.3fr repeat(${matrixSubjects.length}, 90px)`, gap: 6, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.03em", padding: "0 4px 6px", minWidth: 400 }}>
                      <span>Roll</span><span>Student</span>
                      {matrixSubjects.map((s) => <span key={s.subject_id}>{s.subject_name}</span>)}
                    </div>
                    {matrixRows.map((row) => (
                      <div key={row.rollNo} style={{ display: "grid", gridTemplateColumns: `60px 1.3fr repeat(${matrixSubjects.length}, 90px)`, gap: 6, padding: "6px 4px", fontSize: 12, color: T.ink1, borderTop: `1px solid ${T.border}`, alignItems: "center", minWidth: 400 }}>
                        <span style={{ fontFamily: "monospace", fontSize: 11 }}>{row.rollNo}</span>
                        <span>{row.name}</span>
                        {matrixSubjects.map((s) => {
                          if (row.absentSubjects.has(s.subject_name)) {
                            return <span key={s.subject_id} style={{ color: T.danger, fontWeight: 600, fontSize: 10.5 }}>Absent</span>;
                          }
                          const g = row.grades[s.subject_name];
                          return <span key={s.subject_id}>{g ? <Badge tone={gradeTone(g)}>{g}</Badge> : <span style={{ color: T.ink3 }}>–</span>}</span>;
                        })}
                      </div>
                    ))}
                  </div>
                </Accordion>
              )}
              {!matrixLoading && matrixRows.length === 0 && matrixScope && (
                <div style={{ fontSize: 13, color: T.ink2, background: T.hoverSoft, padding: "12px 16px", margin: "16px 0", borderRadius: 8, display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
                  <AlertTriangle size={16} /> No marks entered yet for {matrixScope.className}-{matrixScope.sectionName}.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RotateCcw, CalendarClock, Plus, X, LayoutGrid, Check, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { examTheme as T } from "@/lib/examTheme";
import {
  cloneExamSetup,
  ExamsApiError,
  searchExamSetup,
  storeExamSetup,
  useExamSetupCriteria,
  useExamSetupAnalytics,
  fetchConfiguredExams,
  deleteExamSetup,
  openExamForMarksEntry,
  ConfiguredExamRow
} from "@/hooks/useExamsApi";
import { useExamFocus } from "@/contexts/ExamFocusContext";
import { ExamContextBar } from "@/components/exams/ExamContextBar";

interface Component { id: string; name: string; marks: string }

function defaultComponents(max: string): Component[] {
  const total = Number(max) || 0;
  const written = Math.round(total * 0.75);
  return [
    { id: "written", name: "Written", marks: String(written) },
    { id: "practical", name: "Practical", marks: String(total - written) },
  ];
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: T.ink2 }}>
      <span style={{ width: 5, height: 5, borderRadius: "50%", background: T.purple, display: "inline-block" }} />
      {children}
    </div>
  );
}

const selectSx: React.CSSProperties = {
  width: "100%", height: 38, borderRadius: 8, border: `1px solid ${T.borderStrong}`,
  padding: "0 10px", fontSize: 13, color: T.ink1, background: "#fff", outline: "none",
};

interface ClassConfig {
  sectionIds: number[];
  subjectIds: number[];
  activeSubjectId: number | null;
  componentsBySubject: Record<number, Component[]>;
}

export default function ExamSetupPage() {
  const { data: criteria, loading: criteriaLoading } = useExamSetupCriteria();
  const { data: analytics, loading: analyticsLoading } = useExamSetupAnalytics();

  const [step, setStep] = useState<1 | 2>(1);
  const { examTypeId, setExamTypeId } = useExamFocus();
  const [classIds, setClassIds] = useState<number[]>([]);
  const [maxMarks, setMaxMarks] = useState("80");
  
  const [classConfigs, setClassConfigs] = useState<Record<number, ClassConfig>>({});
  const [expandedClassId, setExpandedClassId] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // The save/error banner renders above the form while the Save button sits at
  // the bottom — bring it into view so the result of a click is never off-screen.
  const feedbackRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (saveError || saveSuccess) feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [saveError, saveSuccess]);
  const [cloned, setCloned] = useState(false);
  const [cloning, setCloning] = useState(false);

  const [configuredExams, setConfiguredExams] = useState<ConfiguredExamRow[]>([]);
  const [fetchingExams, setFetchingExams] = useState(false);

  const loadExams = () => {
    setFetchingExams(true);
    fetchConfiguredExams()
      .then(res => setConfiguredExams(res.items))
      .catch(e => console.error("Failed to load exams", e))
      .finally(() => setFetchingExams(false));
  };

  useEffect(() => {
    loadExams();
  }, []);

  // Seed defaults once criteria loads.
  useEffect(() => {
    if (!criteria) return;
    // No auto-selections per user request
  }, [criteria]);

  const initClassConfig = (classId: number, cr: NonNullable<typeof criteria>) => {
    setClassConfigs(prev => {
        if (prev[classId]) return prev;
        return {
            ...prev,
            [classId]: {
                sectionIds: [],
                subjectIds: [],
                componentsBySubject: {},
                activeSubjectId: null
            }
        };
    });
  };

  const toggleClass = (id: number) => {
    setClassIds((cur) => {
      if (cur.includes(id)) {
        return cur.filter((x) => x !== id);
      } else {
        if (criteria) initClassConfig(id, criteria);
        setExpandedClassId(id);
        return [...cur, id];
      }
    });
  };

  const updateClassConfig = (classId: number, updater: (config: ClassConfig) => ClassConfig) => {
    setClassConfigs(prev => {
        const current = prev[classId];
        if (!current) return prev;
        return { ...prev, [classId]: updater(current) };
    });
  };

  const toggleSection = (classId: number, sectionId: number) => {
    updateClassConfig(classId, (config) => ({
        ...config,
        sectionIds: config.sectionIds.includes(sectionId) 
            ? config.sectionIds.filter(id => id !== sectionId)
            : [...config.sectionIds, sectionId]
    }));
  };

  const toggleSubject = (classId: number, subjectId: number) => {
    updateClassConfig(classId, (config) => {
        const newSubjects = config.subjectIds.includes(subjectId)
            ? config.subjectIds.filter(id => id !== subjectId)
            : [...config.subjectIds, subjectId];
        
        let newActive = config.activeSubjectId;
        if (!newSubjects.includes(newActive ?? -1)) {
            newActive = newSubjects[0] ?? null;
        } else if (newActive === null && newSubjects.length > 0) {
            newActive = newSubjects[0];
        }

        return { ...config, subjectIds: newSubjects, activeSubjectId: newActive };
    });
  };

  const setActiveSubjectId = (classId: number, subjectId: number) => {
    updateClassConfig(classId, config => ({ ...config, activeSubjectId: subjectId }));
  };

  const setActiveComponents = (classId: number, updater: (rows: Component[]) => Component[]) => {
    updateClassConfig(classId, config => {
        if (config.activeSubjectId === null) return config;
        const currentComponents = config.componentsBySubject[config.activeSubjectId] ?? defaultComponents(maxMarks);
        return {
            ...config,
            componentsBySubject: {
                ...config.componentsBySubject,
                [config.activeSubjectId]: updater(currentComponents)
            }
        };
    });
  };

  // Bulk entry: once one class's subjects + mark distribution are set up, copy
  // them to other selected classes instead of repeating the same subject picks
  // and component rows by hand for each one. Sections stay per-class (they're
  // never the same set across classes) — only subjects + distribution copy.
  const [copyTargets, setCopyTargets] = useState<Record<number, number[]>>({});

  const toggleCopyTarget = (fromClassId: number, targetClassId: number) => {
    setCopyTargets((prev) => {
      const current = prev[fromClassId] ?? [];
      return {
        ...prev,
        [fromClassId]: current.includes(targetClassId) ? current.filter((id) => id !== targetClassId) : [...current, targetClassId],
      };
    });
  };

  const applyCopyConfig = (fromClassId: number) => {
    const source = classConfigs[fromClassId];
    const targets = copyTargets[fromClassId] ?? [];
    if (!source || targets.length === 0) return;
    setClassConfigs((prev) => {
      const next = { ...prev };
      targets.forEach((targetId) => {
        const existing = next[targetId] ?? { sectionIds: [], subjectIds: [], activeSubjectId: null, componentsBySubject: {} };
        next[targetId] = {
          ...existing,
          subjectIds: [...source.subjectIds],
          activeSubjectId: source.activeSubjectId,
          componentsBySubject: { ...source.componentsBySubject },
        };
      });
      return next;
    });
    setCopyTargets((prev) => ({ ...prev, [fromClassId]: [] }));
  };

  // Load existing setup from backend for each class's active subject
  useEffect(() => {
    if (!criteria || !examTypeId) return;
    
    classIds.forEach(classId => {
        const config = classConfigs[classId];
        if (!config || !config.activeSubjectId || !config.sectionIds.length) return;
        
        const primarySectionId = config.sectionIds[0];
        const subjectId = config.activeSubjectId;
        
        // If we already have components for this subject, don't overwrite
        if (config.componentsBySubject[subjectId]) return;

        searchExamSetup({ class_id: classId, section: primarySectionId, subject: subjectId, exam_term_id: examTypeId })
        .then((res) => {
            if (res.items.length) {
                updateClassConfig(classId, cfg => ({
                    ...cfg,
                    componentsBySubject: {
                        ...cfg.componentsBySubject,
                        [subjectId]: res.items.map((item) => ({ id: String(item.id), name: item.exam_title, marks: item.exam_mark }))
                    }
                }));
            }
        })
        .catch(() => { /* skip */ });
    });
  }, [examTypeId, classIds, classConfigs, criteria]);

  const examTypeTitle = criteria?.exam_types.find((e) => e.id === examTypeId)?.title ?? "";
  const subjectName = (id: number | null) => criteria?.subjects.find((s) => s.id === id)?.subject_name ?? "";
  const className = (id: number) => criteria?.classes.find(c => c.id === id)?.class_name ?? "";

  const cloneCandidate = useMemo(() => {
    if (!criteria || !examTypeId) return null;
    const current = criteria.exam_types.find((e) => e.id === examTypeId);
    if (!current) return null;
    return criteria.exam_types.find((e) => e.id !== examTypeId && e.title.toLowerCase() === current.title.toLowerCase() && e.id < examTypeId) ?? null;
  }, [criteria, examTypeId]);

  const handleClone = async () => {
    if (!cloneCandidate || !examTypeId || !classIds.length) return;
    setCloning(true);
    setSaveError(null);
    try {
      for (const classIdValue of classIds) {
          const config = classConfigs[classIdValue];
          if (!config || !config.sectionIds.length) continue;
          for(const sectionIdValue of config.sectionIds) {
               await cloneExamSetup({ from_exam_term_id: cloneCandidate.id, to_exam_term_id: examTypeId, class_id: classIdValue, section: sectionIdValue });
          }
      }
      setCloned(true);
      setClassConfigs({}); // Reset to trigger reload
    } catch (e) {
      setSaveError(e instanceof ExamsApiError ? e.message : "Failed to clone last year's setup.");
    } finally {
      setCloning(false);
    }
  };

  const handleSave = async () => {
    if (!examTypeId) { setSaveError("Pick an exam in the bar above before saving."); return; }
    if (!classIds.length) return;

    // Every selected class needs its own section(s) — "Copy to other classes"
    // deliberately only copies subjects + mark distribution (sections are never
    // the same set across classes). A class missing either used to be silently
    // dropped from the save while the button still reported a blanket success —
    // block instead, and name exactly which class and what's missing.
    const incomplete = classIds.filter((id) => {
      const config = classConfigs[id];
      return !config || config.sectionIds.length === 0 || config.subjectIds.length === 0;
    });
    if (incomplete.length > 0) {
      const details = incomplete.map((id) => {
        const config = classConfigs[id];
        const missing: string[] = [];
        if (!config || config.sectionIds.length === 0) missing.push("section(s)");
        if (!config || config.subjectIds.length === 0) missing.push("subject(s)");
        return `${className(id)} (missing ${missing.join(" and ")})`;
      });
      setSaveError(`Can't save yet — ${details.join(", ")}. Pick these before saving, or remove that class in Step 1.`);
      setExpandedClassId(incomplete[0]);
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      for (const classIdValue of classIds) {
        const config = classConfigs[classIdValue];
        if (!config) continue;

        for (const sectionIdValue of config.sectionIds) {
          for (const subjectId of config.subjectIds) {
            const components = config.componentsBySubject[subjectId] ?? defaultComponents(maxMarks);
            await storeExamSetup({
              class_id: classIdValue,
              section: sectionIdValue,
              subject: subjectId,
              exam_term_id: examTypeId,
              total_exam_mark: maxMarks,
              totalMark: String(components.reduce((sum, c) => sum + (Number(c.marks) || 0), 0)),
              exam_title: components.map((c) => c.name),
              exam_mark: components.map((c) => c.marks),
            });
          }
        }
      }
      setSaveSuccess(true);
      loadExams();
    } catch (e) {
      setSaveError(e instanceof ExamsApiError ? e.message : "Failed to save exam setup.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: ConfiguredExamRow) => {
    if (!confirm(`Are you sure you want to delete the setup for ${row.exam_name}?`)) return;
    try {
      await deleteExamSetup(row.id);
      loadExams();
    } catch (e) {
      alert("Failed to delete exam setup");
    }
  };

  const handleOpenMarks = async (row: ConfiguredExamRow) => {
    if (!confirm(`Are you sure you want to open ${row.exam_name} for marks entry? Teachers will be notified.`)) return;
    try {
      await openExamForMarksEntry(row.id);
      alert(`${row.exam_name} is now open for marks entry. Teachers have been notified.`);
      loadExams();
    } catch (e) {
      alert(e instanceof ExamsApiError ? e.message : "Failed to open for marks entry");
    }
  };

  const handleEdit = (row: ConfiguredExamRow) => {
    setExamTypeId(row.id);
    const classes = row.class_ids || [];
    setClassIds(classes);
    classes.forEach(classId => {
      if (criteria) initClassConfig(classId, criteria);
    });
    setExpandedClassId(classes[0] ?? null);
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div style={{ minHeight: "100%", background: T.page, padding: "12px 20px 40px" }}>
      <div style={{ background: T.card, border: `1px solid ${T.cardBorder}`, borderRadius: 16, padding: 24 }}>
        <nav style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 12 }}>
          <Link href="/dashboard" style={{ color: T.ink2, textDecoration: "none" }}>Dashboard</Link>
          <span style={{ color: T.ink3 }}>/</span>
          <Link href="/exams/command-center" style={{ color: T.ink2, textDecoration: "none" }}>Examinations</Link>
          <span style={{ color: T.ink3 }}>/</span>
          <span style={{ color: T.ink1, fontWeight: 600 }}>Exam Setup</span>
        </nav>

        <Link
          href="/exams/command-center"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: T.ink1, textDecoration: "none", border: `1px solid ${T.borderStrong}`, borderRadius: 8, padding: "6px 12px", background: "#fff", marginBottom: 16 }}
        >
          <ArrowLeft size={13} /> Back to Command Center
        </Link>

        <div style={{ marginBottom: 18 }}>
          <Eyebrow>Exam Setup · {examTypeTitle || "Loading…"} · Per exam cycle</Eyebrow>
          <h1 style={{ margin: "6px 0 6px", display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 8, fontSize: 30 }}>
            <span style={{ fontFamily: "Georgia, serif", fontWeight: 900, color: T.ink1 }}>Which classes sit it,</span>
            <span style={{ fontFamily: '"Playfair Display", Georgia, serif', fontStyle: "italic", fontWeight: 500, color: T.purple }}>
              and how it&apos;s marked.
            </span>
          </h1>
          <p style={{ fontSize: 13, color: T.ink2, lineHeight: 1.6, maxWidth: 640, margin: "0 0 14px" }}>
            The pattern rarely changes cycle to cycle — start from last term instead of rebuilding it from scratch.
          </p>

          <div style={{ display: "flex", gap: 8 }}>
            {([[1, "Step 1 · Choose Classes & Criteria"], [2, "Step 2 · Class Configurations"]] as const).map(([n, label]) => {
              const done = n < step;
              const active = n === step;
              return (
                <button
                  key={n} type="button" onClick={() => setStep(n)}
                  style={{ display: "flex", alignItems: "center", gap: 5, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em", cursor: "pointer", border: `1px solid ${active ? T.purple : done ? T.ok : T.borderStrong}`, background: active ? T.purple : done ? T.okSoft : "#fff", color: active ? "#fff" : done ? T.ok : T.ink3 }}
                >
                  {done && <Check size={11} strokeWidth={3} />}
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <ExamContextBar icon={CalendarClock} options={criteria?.exam_types ?? []} />

        {!examTypeId && (
          <div style={{ background: T.warnSoft, color: T.warn, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 14 }}>
            Pick an exam in the bar above — nothing below can be saved until one is selected.
          </div>
        )}

        <div ref={feedbackRef}>
        {saveError && <div style={{ background: T.dangerSoft, color: T.danger, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 14 }}>{saveError}</div>}
        {saveSuccess && <div style={{ background: T.okSoft, color: T.ok, borderRadius: 10, padding: "10px 14px", fontSize: 12.5, fontWeight: 600, marginBottom: 14 }}>Exam setup saved.</div>}
        </div>

        {cloneCandidate && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: T.purpleSoft, border: `1px solid ${T.purple}33`, borderRadius: 14, padding: "16px 18px", marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <RotateCcw size={16} color={T.purple} strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink1 }}>Reuse {cloneCandidate.title}&apos;s setup</div>
              <div style={{ fontSize: 12, color: T.ink2, marginTop: 2 }}>Same classes, subjects and mark distribution as before — tweak only what&apos;s different.</div>
            </div>
            <button type="button" onClick={handleClone} disabled={cloning || cloned} style={{ height: 38, padding: "0 16px", borderRadius: 9, border: `1px solid ${T.purple}`, background: T.purple, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: cloning || cloned ? "default" : "pointer", whiteSpace: "nowrap", flexShrink: 0, opacity: cloning ? 0.7 : 1 }}>
              {cloned ? "Cloned ✓" : cloning ? "Cloning…" : `Clone from ${cloneCandidate.title}`}
            </button>
          </div>
        )}

        {step === 1 ? (
          <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 700, color: T.ink1, marginBottom: 16 }}>
              <CalendarClock size={15} color={T.purple} strokeWidth={2} />
              Exam criteria & Classes
            </div>

            {criteriaLoading ? (
              <div style={{ fontSize: 12.5, color: T.ink3 }}>Loading criteria…</div>
            ) : (
              <>
                <div style={{ marginBottom: 24, padding: 16, borderRadius: 12, border: `1px solid ${T.border}`, background: T.page }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: T.ink1, marginBottom: 12 }}>
                    Class Readiness Analytics
                  </div>
                  <div style={{ fontSize: 11.5, color: T.ink2, marginBottom: 12 }}>Check which classes have students and teachers assigned before creating exams for them.</div>
                  {analyticsLoading ? (
                    <div style={{ fontSize: 12, color: T.ink3 }}>Loading analytics...</div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
                      {(analytics || []).map((row, idx) => {
                        const isReady = row.student_count > 0 && row.has_teacher;
                        return (
                          <div key={idx} style={{ padding: 12, borderRadius: 8, border: `1px solid ${isReady ? T.ok : T.warn}`, background: isReady ? "#fff" : T.warnSoft }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink1, marginBottom: 4 }}>{row.class_name} - {row.section_name}</div>
                            <div style={{ fontSize: 11, color: row.student_count > 0 ? T.ink2 : T.danger, display: "flex", alignItems: "center", gap: 4 }}>
                              {row.student_count > 0 ? <Check size={10} color={T.ok} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                              {row.student_count} Student{row.student_count === 1 ? "" : "s"}
                            </div>
                            <div style={{ fontSize: 11, color: row.has_teacher ? T.ink2 : T.danger, display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                              {row.has_teacher ? <Check size={10} color={T.ok} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                              {row.has_teacher ? "Teacher Assigned" : "No Teacher"}
                            </div>
                          </div>
                        );
                      })}
                      {(!analytics || analytics.length === 0) && (
                         <div style={{ fontSize: 12, color: T.ink3 }}>No classes or sections found.</div>
                      )}
                    </div>
                  )}
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>Max Marks</div>
                    <input style={selectSx} value={maxMarks} placeholder="Max marks" onChange={(e) => setMaxMarks(e.target.value.replace(/[^0-9]/g, ""))} />
                  </div>
                </div>

                <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
                  Classes sitting this exam (Select one or many)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {(criteria?.classes ?? []).map((c) => {
                    const active = classIds.includes(c.id);
                    return (
                      <button key={c.id} type="button" onClick={() => toggleClass(c.id)} style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${active ? T.purple : T.borderStrong}`, background: active ? T.purpleSoft : "#fff", color: active ? T.purple : T.ink2 }}>
                        {c.class_name}
                        {active && <X size={12} />}
                      </button>
                    );
                  })}
                </div>
                
                <button type="button" onClick={() => setStep(2)} disabled={classIds.length === 0} style={{ height: 38, padding: "0 22px", borderRadius: 10, background: classIds.length ? T.purple : T.borderStrong, color: "#fff", fontSize: 13, fontWeight: 700, cursor: classIds.length ? "pointer" : "default", border: "none" }}>
                    Configure Class Details →
                </button>
              </>
            )}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {classIds.map(classId => {
                const isExpanded = expandedClassId === classId;
                const config = classConfigs[classId];
                if (!config) return null;

                const classSections = (criteria?.sections ?? []).filter(s => s.class_id === classId);
                const activeComponents = config.activeSubjectId !== null ? config.componentsBySubject[config.activeSubjectId] : undefined;
                const currentTotal = (activeComponents ?? defaultComponents(maxMarks)).reduce((sum, c) => sum + (Number(c.marks) || 0), 0);
                const targetTotal = Number(maxMarks) || 0;
                const missingSections = config.sectionIds.length === 0;
                const missingSubjects = config.subjectIds.length === 0;
                const isIncomplete = missingSections || missingSubjects;

                return (
                    <div key={classId} style={{ background: "#fff", border: `1px solid ${isExpanded ? T.purple : isIncomplete ? T.warn : T.border}`, borderRadius: 14, overflow: "hidden" }}>
                        <button type="button" onClick={() => setExpandedClassId(isExpanded ? null : classId)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: isExpanded ? T.purpleSoft : "#fff", border: "none", cursor: "pointer", textAlign: "left" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <LayoutGrid size={16} color={T.purple} />
                                <span style={{ fontSize: 15, fontWeight: 700, color: T.ink1 }}>{className(classId)} Configuration</span>
                                {isIncomplete && (
                                    <span style={{ fontSize: 10.5, fontWeight: 700, color: T.warn, background: T.warnSoft, borderRadius: 999, padding: "2px 8px" }}>
                                        Missing {[missingSections && "section(s)", missingSubjects && "subject(s)"].filter(Boolean).join(" & ")}
                                    </span>
                                )}
                            </div>
                            {isExpanded ? <ChevronUp size={18} color={T.ink3} /> : <ChevronDown size={18} color={T.ink3} />}
                        </button>
                        
                        {isExpanded && (
                            <div style={{ padding: 20, borderTop: `1px solid ${T.purpleSoft}` }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Sections for {className(classId)}</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 20 }}>
                                    {classSections.map((s) => {
                                        const active = config.sectionIds.includes(s.id);
                                        return (
                                        <button key={s.id} type="button" onClick={() => toggleSection(classId, s.id)} style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${active ? T.purple : T.borderStrong}`, background: active ? T.purpleSoft : "#fff", color: active ? T.purple : T.ink2 }}>
                                            {s.section_name}
                                            {active && <X size={12} />}
                                        </button>
                                        );
                                    })}
                                    {classSections.length === 0 && <span style={{ fontSize: 12, color: T.ink3 }}>No sections found.</span>}
                                </div>

                                <div style={{ fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>Subjects</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
                                    {(criteria?.subjects ?? []).map((s) => {
                                        const active = config.subjectIds.includes(s.id);
                                        return (
                                        <button key={s.id} type="button" onClick={() => toggleSubject(classId, s.id)} style={{ display: "flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", border: `1px solid ${active ? T.purple : T.borderStrong}`, background: active ? T.purpleSoft : "#fff", color: active ? T.purple : T.ink2 }}>
                                            {s.subject_name}
                                            {active && <X size={12} />}
                                        </button>
                                        );
                                    })}
                                </div>

                                <div style={{ background: T.page, padding: 16, borderRadius: 12, border: `1px solid ${T.border}` }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: T.ink1, marginBottom: 12 }}>Mark Distribution for {className(classId)}</div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                                        {config.subjectIds.map((id) => {
                                            const isActive = config.activeSubjectId === id;
                                            return (
                                                <button key={id} type="button" onClick={() => setActiveSubjectId(classId, id)} style={{ fontSize: 12, fontWeight: 600, borderRadius: 999, padding: "6px 14px", cursor: "pointer", border: `1px solid ${isActive ? T.purple : T.borderStrong}`, background: isActive ? T.purple : "#fff", color: isActive ? "#fff" : T.ink2, transition: "all 0.1s" }}>
                                                {subjectName(id)}
                                                </button>
                                            );
                                        })}
                                        {config.subjectIds.length === 0 && <span style={{ fontSize: 12, color: T.ink3 }}>Select a subject first.</span>}
                                    </div>

                                    {config.activeSubjectId !== null && (
                                    <>
                                        <div style={{ fontSize: 13, fontWeight: 700, color: T.purple, marginBottom: 10, paddingBottom: 8, borderBottom: `1px dashed ${T.borderStrong}` }}>
                                            Component Breakdown for {subjectName(config.activeSubjectId)}
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 24px", gap: 8, fontSize: 10, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                                            <span>Component</span><span>Marks</span><span />
                                        </div>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
                                            {(activeComponents ?? defaultComponents(maxMarks)).map((c) => (
                                                <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr 100px 24px", gap: 8, alignItems: "center" }}>
                                                <input style={selectSx} value={c.name} onChange={(e) => setActiveComponents(classId, (rows) => rows.map((r) => (r.id === c.id ? { ...r, name: e.target.value } : r)))} />
                                                <input style={{ ...selectSx, textAlign: "center" }} value={c.marks} onChange={(e) => setActiveComponents(classId, (rows) => rows.map((r) => (r.id === c.id ? { ...r, marks: e.target.value.replace(/[^0-9]/g, "") } : r)))} />
                                                <button type="button" onClick={() => setActiveComponents(classId, (rows) => rows.filter((r) => r.id !== c.id))} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink3, padding: 4, display: "flex" }}>
                                                    <Trash2 size={14} />
                                                </button>
                                                </div>
                                            ))}
                                        </div>
                                        <button type="button" onClick={() => setActiveComponents(classId, (rows) => [...rows, { id: String(Date.now()), name: "", marks: "0" }])} style={{ display: "flex", alignItems: "center", gap: 6, height: 36, padding: "0 14px", marginBottom: 16, borderRadius: 9, border: `1px dashed ${T.borderStrong}`, background: "#fff", color: T.ink2, fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                                            <Plus size={13} /> Add component
                                        </button>

                                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, borderRadius: 10, padding: "10px 14px", background: currentTotal === targetTotal ? T.okSoft : T.warnSoft, color: currentTotal === targetTotal ? T.ok : T.warn }}>
                                            <span style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                                                {currentTotal === targetTotal && <Check size={13} strokeWidth={3} />}
                                                Target {targetTotal} · Current {currentTotal}
                                            </span>
                                        </div>
                                    </>
                                    )}
                                </div>

                                {classIds.length > 1 && config.subjectIds.length > 0 && (
                                    <div style={{ marginTop: 16, background: T.purpleSoft, padding: 16, borderRadius: 12, border: `1px solid ${T.purple}33` }}>
                                        <div style={{ fontSize: 12, fontWeight: 700, color: T.ink1, marginBottom: 8 }}>
                                            Copy {className(classId)}&apos;s subjects &amp; mark distribution to other classes
                                        </div>
                                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                                            {classIds.filter((id) => id !== classId).map((targetId) => {
                                                const checked = (copyTargets[classId] ?? []).includes(targetId);
                                                return (
                                                    <button key={targetId} type="button" onClick={() => toggleCopyTarget(classId, targetId)} style={{ display: "flex", alignItems: "center", gap: 6, height: 30, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${checked ? T.purple : T.borderStrong}`, background: checked ? "#fff" : "transparent", color: checked ? T.purple : T.ink2 }}>
                                                        {checked && <Check size={11} strokeWidth={3} />} {className(targetId)}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        <button
                                            type="button" onClick={() => applyCopyConfig(classId)}
                                            disabled={(copyTargets[classId] ?? []).length === 0}
                                            style={{ height: 34, padding: "0 14px", borderRadius: 8, border: "none", background: T.purple, color: "#fff", fontSize: 12.5, fontWeight: 700, cursor: (copyTargets[classId] ?? []).length === 0 ? "not-allowed" : "pointer", opacity: (copyTargets[classId] ?? []).length === 0 ? 0.5 : 1 }}
                                        >
                                            Apply to {(copyTargets[classId] ?? []).length || ""} class{(copyTargets[classId] ?? []).length === 1 ? "" : "es"}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}
            
            {classIds.length === 0 && (
                <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: T.ink3, border: `1px solid ${T.border}`, borderRadius: 14, background: "#fff" }}>
                    Go back to Step 1 and select at least one class.
                </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 20 }}>
          <Link
            href="/exams/command-center"
            style={{ height: 42, padding: "0 20px", borderRadius: 10, border: `1px solid ${T.borderStrong}`, background: "#fff", color: T.ink1, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", textDecoration: "none" }}
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !classIds.length || !examTypeId}
            title={!examTypeId ? "Pick an exam in the bar above first." : undefined}
            style={{ height: 42, padding: "0 22px", borderRadius: 10, border: `1px solid ${T.purple}`, background: T.purple, color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: saving || !classIds.length || !examTypeId ? "not-allowed" : "pointer", opacity: saving || !classIds.length || !examTypeId ? 0.6 : 1 }}
          >
            {saving ? "Saving…" : "Save Exam Setup"}
          </button>
        </div>

        <div style={{ background: "#fff", border: `1px solid ${T.border}`, borderRadius: 14, padding: 20, marginTop: 20 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.ink1, marginBottom: 12 }}>Configured Exams</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", minWidth: 560, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>Exam Name</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>Classes</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>Status</th>
                  <th style={{ padding: "8px 10px", borderBottom: `1px solid ${T.border}`, fontSize: 11, fontWeight: 700, color: T.ink3, textTransform: "uppercase", letterSpacing: "0.04em" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fetchingExams && configuredExams.length === 0 ? (
                  <tr><td colSpan={4} style={{ padding: 10, fontSize: 12.5, color: T.ink3 }}>Loading exams...</td></tr>
                ) : (
                  configuredExams.map((row) => (
                    <tr key={row.id}>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontSize: 12.5, color: T.ink1 }}>{row.exam_name}</td>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, fontSize: 12.5, color: T.ink2 }}>{row.classes}</td>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}` }}>
                        <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: row.status === "Active" ? T.okSoft : T.hoverSoft, color: row.status === "Active" ? T.ok : T.ink2 }}>
                          {row.status}
                        </span>
                      </td>
                      <td style={{ padding: "10px", borderBottom: `1px solid ${T.border}`, whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" onClick={() => handleEdit(row)} style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${T.borderStrong}`, background: "#fff", color: T.ink1, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                          <button type="button" onClick={() => handleOpenMarks(row)} style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${T.purple}`, background: T.purpleSoft, color: T.purple, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Open for Marks</button>
                          <button type="button" onClick={() => handleDelete(row)} style={{ height: 28, padding: "0 10px", borderRadius: 7, border: `1px solid ${T.borderStrong}`, background: "#fff", color: T.danger, fontSize: 11.5, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
                {!fetchingExams && configuredExams.length === 0 && <tr><td colSpan={4} style={{ padding: 10, fontSize: 12.5, color: T.ink3 }}>No exams configured yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

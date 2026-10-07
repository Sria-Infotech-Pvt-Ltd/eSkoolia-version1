"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getLibrarySettings, listSchoolClasses, updateLibrarySettings } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import type { LibrarySettings, SchoolClassOption } from "@/types/library";
import { Btn, describeError, Field, fieldMessages, inputStyle, SkeletonRows, StateBox, useToast } from "../catalogue/ui";
import { isDirty, toForm, toSettingsInput, validateSettings, type SettingsErrors, type SettingsForm } from "./settingsHelpers";

type TextField = Exclude<keyof SettingsForm, "junior_class_ids" | "cap_fine_at_replacement_cost" | "notify_sms_email_enabled">;

interface FieldSpec {
  name: TextField;
  label: string;
  hint?: string;
}

const SECTIONS: { title: string; fields: FieldSpec[] }[] = [
  {
    title: "Overdue fines",
    fields: [
      { name: "fine_per_day", label: "Fine per overdue day", hint: "Currency units per day." },
      { name: "fine_grace_days", label: "Grace days", hint: "Days after the due date that cost nothing." },
      { name: "fine_cap", label: "Fine cap", hint: "Leave blank for no cap." },
    ],
  },
  {
    title: "Borrowing limits",
    fields: [
      { name: "limit_student", label: "Books per student" },
      { name: "limit_teacher", label: "Books per teacher" },
      { name: "limit_staff", label: "Books per staff member" },
    ],
  },
  {
    title: "Loan period and renewals",
    fields: [
      { name: "student_min_due_days", label: "Student minimum days to due date", hint: "The due date snaps to the class's next library period at least this many days away." },
      { name: "flat_loan_days", label: "Flat loan days", hint: "Teachers, staff, and students whose class has no library period." },
      { name: "max_renewals", label: "Maximum renewals" },
    ],
  },
  {
    title: "Replacement cost",
    fields: [
      { name: "replacement_processing_fee", label: "Handling fee", hint: "Added to the copy cost." },
      { name: "replacement_default_cost", label: "Default replacement cost", hint: "Used when a copy's cost is 0." },
    ],
  },
  {
    title: "Registration fee",
    fields: [
      { name: "registration_fee_junior", label: "Junior group fee" },
      { name: "registration_fee_senior", label: "Other students' fee" },
    ],
  },
  {
    title: "Desk and stock",
    fields: [
      { name: "low_stock_ratio", label: "Low stock ratio", hint: "A title is low stock when available copies divided by copies is at or under this (0 to 1)." },
      { name: "unscanned_flag_minutes", label: "Flag unscanned after (minutes)" },
      { name: "undo_return_minutes", label: "Undo a return for (minutes)" },
    ],
  },
];

export function SettingsPage() {
  const { me, can } = usePermissions();
  const canView = can("library.settings.view");
  const canManage = can("library.settings.manage");
  const [saved, setSaved] = useState<LibrarySettings | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [classes, setClasses] = useState<SchoolClassOption[]>([]);
  const [classFilter, setClassFilter] = useState("");
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [banner, setBanner] = useState("");
  const [saving, setSaving] = useState(false);
  const { show, node: toastNode } = useToast();

  const load = useCallback(async () => {
    setError("");
    try {
      const [settings, classList] = await Promise.all([getLibrarySettings(), listSchoolClasses({ silent401: true }).catch(() => [] as SchoolClassOption[])]);
      setSaved(settings);
      setForm(toForm(settings));
      setClasses(classList);
    } catch (err) {
      setError(describeError(err, "Could not load the settings."));
    }
  }, []);

  useEffect(() => {
    if (me && canView) void load();
  }, [me, canView, load]);

  const baseline = useMemo(() => (saved ? toForm(saved) : null), [saved]);
  const dirty = form && baseline ? isDirty(form, baseline) : false;

  // Unsaved edits survive a stray tab close only through this warning.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={2} />
      </Shell>
    );
  }
  if (!canView) {
    return (
      <Shell>
        <StateBox title="You do not have access to library settings">Ask an administrator to give your role the library settings view permission.</StateBox>
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell>
        <StateBox tone="danger" title="Could not load the settings">{error} <Btn small onClick={load}>Retry</Btn></StateBox>
      </Shell>
    );
  }
  if (!form || !saved) {
    return (
      <Shell>
        <SkeletonRows rows={8} columns={2} />
      </Shell>
    );
  }

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm({ ...form, [key]: value });
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const toggleClass = (id: number) =>
    set("junior_class_ids", form.junior_class_ids.includes(id) ? form.junior_class_ids.filter((c) => c !== id) : [...form.junior_class_ids, id]);

  const save = async () => {
    const problems = validateSettings(form);
    setErrors(problems);
    setBanner("");
    if (Object.keys(problems).length) {
      setBanner("Fix the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const updated = await updateLibrarySettings(toSettingsInput(form));
      setSaved(updated);
      setForm(toForm(updated));
      show("Settings saved");
    } catch (err) {
      const fields = fieldMessages(err) as SettingsErrors;
      setErrors(fields);
      setBanner(Object.keys(fields).length ? "The server rejected some fields." : describeError(err, "Could not save the settings."));
    } finally {
      setSaving(false);
    }
  };

  const visibleClasses = classes.filter((c) => c.name.toLowerCase().includes(classFilter.trim().toLowerCase()));
  const readOnly = !canManage;

  return (
    <Shell
      actions={
        canManage ? (
          <>
            <Btn onClick={() => { setForm(toForm(saved)); setErrors({}); setBanner(""); }} disabled={!dirty || saving}>
              Discard changes
            </Btn>
            <Btn variant="primary" onClick={save} disabled={!dirty || saving}>
              {saving ? "Saving..." : "Save settings"}
            </Btn>
          </>
        ) : null
      }
    >
      {readOnly ? <p style={{ fontSize: 13, color: "var(--ink-3)", marginTop: 0 }}>You can view these settings but not change them.</p> : null}
      {banner ? (
        <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {banner}
        </div>
      ) : null}

      {SECTIONS.map((section) => (
        <section key={section.title} style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 15, color: "var(--ink-1)" }}>{section.title}</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
            {section.fields.map((field) => (
              <Field key={field.name} label={field.label} hint={field.hint} error={errors[field.name]}>
                <input style={inputStyle} value={form[field.name]} disabled={readOnly} inputMode="decimal" onChange={(e) => set(field.name, e.target.value)} />
              </Field>
            ))}
          </div>
          {section.title === "Overdue fines" ? (
            <label style={{ fontSize: 13, color: "var(--ink-1)" }}>
              <input type="checkbox" checked={form.cap_fine_at_replacement_cost} disabled={readOnly} onChange={(e) => set("cap_fine_at_replacement_cost", e.target.checked)} /> Never let a fine exceed the copy&apos;s replacement cost
            </label>
          ) : null}
          {section.title === "Registration fee" ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>Classes in the junior group</div>
              <input aria-label="Filter classes" style={{ ...inputStyle, maxWidth: 260, marginBottom: 8 }} placeholder="Filter classes" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} />
              <div role="group" aria-label="Junior classes" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {visibleClasses.map((c) => (
                  <label key={c.id} style={{ fontSize: 13, padding: "4px 10px", border: "1px solid var(--bd-3)", borderRadius: 999, background: form.junior_class_ids.includes(c.id) ? "var(--pu-soft)" : "var(--bg-1)", color: "var(--ink-1)" }}>
                    <input type="checkbox" checked={form.junior_class_ids.includes(c.id)} disabled={readOnly} onChange={() => toggleClass(c.id)} /> {c.name}
                  </label>
                ))}
                {classes.length === 0 ? <span style={{ fontSize: 13, color: "var(--ink-3)" }}>No classes found. Create classes first.</span> : null}
              </div>
              {errors.junior_class_ids ? <div role="alert" style={{ color: "var(--danger)", fontSize: 12, marginTop: 4 }}>{errors.junior_class_ids}</div> : null}
            </div>
          ) : null}
        </section>
      ))}

      <section style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
        <h2 style={{ margin: "0 0 10px", fontSize: 15, color: "var(--ink-1)" }}>Notifications and numbering</h2>
        <label style={{ fontSize: 13, color: "var(--ink-1)" }}>
          <input type="checkbox" checked={form.notify_sms_email_enabled} disabled={readOnly} onChange={(e) => set("notify_sms_email_enabled", e.target.checked)} /> Also send SMS and email reminders (in-app notifications are always on)
        </label>
        <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 0 }}>
          Counters (set by the system): purchase orders issued {saved.po_sequence}, donation receipts issued {saved.donation_receipt_sequence}.
        </p>
      </section>
      {toastNode}
    </Shell>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Library settings</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Fines, limits, loan periods and fees for your school</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{actions}</div>
      </div>
      {children}
    </div>
  );
}

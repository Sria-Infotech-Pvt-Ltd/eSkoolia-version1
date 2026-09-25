"use client";
/**
 * HR Onboard — 10-step wizard matching the mockup design.
 * Layout: page header → QR banner → [252px grouped sidebar | step card] → sticky footer bar
 */
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Camera, Upload, ChevronDown, X, Printer, Sparkles,
  FileText, CheckCircle, QrCode,
} from "lucide-react";
import { useHrToast } from "@/components/hr/HrUi";
// Field components below are visually restyled to match the Student Enroll page
// pixel-for-pixel (see OnboardFieldUi.tsx) — aliased to the original names so
// none of this file's many call sites need to change, only the import source.
import {
  OnboardField as HrField,
  OnboardInput as HrInput,
  OnboardSelect as HrSelect,
  OnboardDropdown as HrDropdown,
} from "@/components/hr/OnboardFieldUi";
import SearchableSelect from "@/components/hr/SearchableSelect";
import { BackButton } from "@/components/common/BackButton";
import {
  useAllDepartments, useDesignations, useStaffList, createStaff, updateStaff,
  useMasterLanguages, useMasterReligions, useMasterCountries, useMasterEmploymentTypes,
  useStaffFormOptions,
  useOnboardDrafts, saveOnboardDraft, deleteOnboardDraft, downloadBlankForm, downloadFilledForm,
  useStaffDocuments,
} from "@/hooks/useHrApi";
import type { OnboardDraft } from "@/hooks/useHrApi";
import { HrApiError } from "@/hooks/useHrApi";
import { apiRequestWithRefreshResponse } from "@/lib/api-auth";
import type { Staff, StaffDocument } from "@/types/hr";
import { isValidEmail, isValidPhoneDigits, isValidPin, hasAlphanumeric, isGibberishAddress, isGibberishPlaceName, isValidIndianMobile, isValidPersonName, PERSON_NAME_ERR, isValidBankAccountName, BANK_ACCOUNT_NAME_ERR } from "@/lib/hrValidation";
import { ScanFillModal } from "@/components/students/ScanFillModal";
import { STAFF_FIELD_GROUPS } from "@/components/hr/staffScanFields";
import { StaffVerificationForm } from "@/components/hr/StaffVerificationForm";

// --- Constants ---
const GENDERS        = ["Male", "Female", "Other", "Prefer not to say"] as const;
const BLOOD_GROUPS   = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;
const MARITAL_STATUS = ["Single", "Married", "Divorced", "Widowed"] as const;
const ROLES          = ["Teacher", "Admin Staff", "Finance", "Support", "Transport / Driver", "Library", "Principal", "Vice Principal"] as const;
const SALARY_MODES   = ["Monthly", "Bi-monthly", "Weekly", "Daily"] as const;
// BANKS list removed — bank name now auto-populated via IFSC lookup
const DEGREES        = ["B.Ed", "M.Ed", "MBA", "B.Tech", "M.Tech", "B.Sc", "M.Sc", "B.A", "M.A", "Ph.D", "Diploma", "Other"] as const;
const RELATIONSHIPS  = ["Spouse", "Parent", "Sibling", "Child", "Friend", "Guardian", "Other"] as const;
const DISABILITY_STATUSES = ["None", "Physical disability", "Visual impairment", "Hearing impairment", "Speech or language disability", "Cognitive / learning disability", "Multiple disabilities", "Prefer not to say"] as const;
const CC_OPTIONS     = ["+91", "+234", "+44", "+1", "+971", "+61", "+27"] as const;

// --- Step definitions grouped by category ---
const STEP_GROUPS = [
  {
    group: "Personal",
    steps: [
      { num: 1, label: "Staff identity",     sub: "Basic profile, DOB, photo" },
      { num: 2, label: "Role & placement",   sub: "Department, role, joining" },
      { num: 3, label: "Contact & address",  sub: "Phone, email, location" },
      { num: 4, label: "Family & emergency", sub: "Nominees and contacts" },
    ],
  },
  {
    group: "Compliance",
    steps: [
      { num: 5, label: "Government identity", sub: "Aadhaar, PAN, etc." },
      { num: 6, label: "Qualifications",      sub: "Education and experience" },
      { num: 7, label: "Medical & fitness",   sub: "Health, transport, fitness" },
    ],
  },
  {
    group: "Payroll & Files",
    steps: [
      { num: 8,  label: "Payroll setup",    sub: "CTC and deductions" },
      { num: 9,  label: "Documents",        sub: "Tally-based checklist" },
      { num: 10, label: "Review & onboard", sub: "Confirm and create" },
    ],
  },
];

type StepDef = { num: number; label: string; sub: string };
const ALL_STEPS: StepDef[] = STEP_GROUPS.flatMap((g) => g.steps as StepDef[]);
const TOTAL     = ALL_STEPS.length;

// Maps backend field names (from a 400 response's `field_errors`, e.g. a
// server-side uniqueness check like "bank account already registered") to the
// wizard step that owns that field, so a submit-time API error can jump the
// user straight to it instead of leaving them stuck on Review with no clue
// which of the 10 steps needs fixing.
const BACKEND_FIELD_STEP_MAP: Record<string, number> = {
  first_name: 1, last_name: 1, middle_name: 1, gender: 1, date_of_birth: 1,
  nationality: 1, staff_photo: 1, staff_no: 1, status: 1,
  department: 2, designation: 2, role: 2, contract_type: 2, join_date: 2, employment_type: 2,
  phone: 3, mobile: 3, email: 3, personal_email: 3, official_email: 3, whatsapp: 3,
  current_address: 3, permanent_address: 3, city: 3, state: 3, current_pin: 3, preferred_communication: 3,
  emergency_name: 4, emergency_relation: 4, emergency_phone: 4, emergency_mobile: 4, spouse_parent_name: 4,
  nin: 5, aadhaar: 5, pan: 5, passport_no: 5, driving_licence: 5, uan: 5, esi_no: 5, pt_registration: 5,
  bank_account_no: 5, bank_name: 5, bank_branch: 5, bank_account_name: 5, ifsc_code: 5,
  basic_salary: 8, hra_input: 8, da_input: 8,
};

// --- Form data type ---
type FormData = Partial<
  Staff & {
    // Contact step extras
    preferred_communication: string;
    current_address_line2: string;
    current_pin: string;
    current_country: string;
    permanent_city: string;
    permanent_state: string;
    permanent_pin: string;
    permanent_country: string;
    same_address: string;
    // Family step
    num_children: string;
    spouse_parent_name: string;
    emergency_name: string;
    emergency_phone: string;
    emergency_relation: string;
    // Gov ID step extras
    nin: string;
    pt_registration: string;
    ifsc_code: string;
    bank_account_name: string;
    bank_branch: string;
    bank_city: string;
    bank_state: string;
    // Qualifications step
    bed_reg_no: string;
    ctet_score: string;
    subjects_qualified: string;
    qualifications_summary: string;
    // Medical step
    med_cert_no: string;
    med_exam_date: string;
    cert_valid_till: string;
    disability_cert_no: string;
    disability_pct: string;
    disability_authority: string;
    workplace_accommodations: string;
    eye_exam_result: string;
    colour_blindness: string;
    dl_medical_exam: string;
    medical_conditions: string;
    // Payroll step
    basic_salary_input: string;
    hra_input: string;
    da_input: string;
    travel_allowance_input: string;
    medical_allowance_input: string;
    special_allowance_input: string;
    salary_mode: string;
    // Legacy (kept for backward compat)
    blood_group_input: string;
    pension_id: string;
    tax_id: string;
    passport_number: string;
    // Review step
    create_login: string;
    send_welcome: string;
    activate_attendance: string;
    // Master data "Other" free-text
    mother_tongue_other: string;
    religion_other: string;
    nationality_other: string;
    employment_type_other: string;
    // Probation (replaces free-text probation_period)
    probation_value: string;
    probation_unit: string;
  }
>;

// --- Shared visual helpers ---
const PF = 'var(--font-playfair),"Playfair Display",Georgia,serif';
const CC_SEL_CLS = "h-[44px] px-3 border border-[var(--line)] rounded-[11px] bg-white text-[13px] text-[var(--ink)] outline-none focus:border-[#c4b5fd] shrink-0";

function WizardBlock({
  title, right, children,
}: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between pb-[10px] border-b border-[#F1F5F9]">
        <div className="text-[13px] font-[600] text-[#334155]" style={{ fontFamily: PF }}>
          {title}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function TipBox({ type, children }: { type: "info" | "warn" | "success"; children: React.ReactNode }) {
  const s = {
    info:    "bg-[#eff6ff] border-[#bfdbfe] text-[#1e40af]",
    warn:    "bg-[#fffbeb] border-[#fde68a] text-[#92400e]",
    success: "bg-[#ecfdf5] border-[#bbf7d0] text-[#065f46]",
  };
  return (
    <div className={`text-[12.5px] px-[14px] py-[10px] rounded-[10px] border leading-relaxed ${s[type]}`}>
      {children}
    </div>
  );
}

function FHG({ hints }: { hints: (string | null)[] }) {
  return (
    <div
      className="-mt-4 grid gap-6"
      style={{ gridTemplateColumns: `repeat(${hints.length}, minmax(0,1fr))` }}
    >
      {hints.map((h, i) => (
        <div key={i} className="text-[11px] text-[#94A3B8] leading-snug">{h ?? ""}</div>
      ))}
    </div>
  );
}

function PhoneField({
  label, required, value, onChange,
}: { label: string; required?: boolean; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-[9px]">
      <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
        {label}{required && <span className="text-[var(--red)] ml-1">*</span>}
      </label>
      <div className="flex gap-2">
        <select className={CC_SEL_CLS}>
          {CC_OPTIONS.map((c) => <option key={c}>{c}</option>)}
        </select>
        <HrInput
          className="flex-1 min-w-0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Mobile number"
        />
      </div>
    </div>
  );
}

function AddRowBtn({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start text-[12px] font-[700] text-[var(--brand)] border border-[var(--brand)] rounded-[8px] px-3 py-1.5 hover:bg-[var(--soft)] transition-colors"
    >
      + {label}
    </button>
  );
}

// --- Sidebar Nav ---
function WizardNav({ step, completedSteps, onGo }: { step: number; completedSteps: Set<number>; onGo: (n: number) => void }) {
  return (
    <aside className="onboard-section-nav-wrap">
      <nav aria-label="Onboard navigation">
        <ul className="onboard-section-nav-list">
          {STEP_GROUPS.map((group) => (
            <Fragment key={group.group}>
              <li className="onboard-nav-group-heading">{group.group}</li>
              {group.steps.map((s) => {
                const done = completedSteps.has(s.num) && s.num !== step;
                const active = s.num === step;
                return (
                  <li
                    key={s.num}
                    className={`onboard-nav-item${active ? " active" : done ? " done" : ""}`}
                  >
                    <button type="button" className="onboard-nav-item-inner" onClick={() => onGo(s.num)}>
                      <span className="onboard-nav-bullet">{done ? "✓" : s.num}</span>
                      <span className="onboard-nav-text">
                        <span className="onboard-nav-label">{s.label}</span>
                        <span className="onboard-nav-copy">{s.sub}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>

        <div className="onboard-heads-up-card">
          <p className="onboard-heads-up-title">Heads up</p>
          <p className="onboard-heads-up-body" style={{ lineHeight: 1.6 }}>
            <span style={{ color: "#dc2626", fontWeight: 700 }}>*</span> = <strong>Required</strong> — must be filled to onboard<br />
            <span style={{ background: "#fef3c7", color: "#92400e", borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>RECOMMENDED</span> = Strongly suggested but not mandatory<br />
            <span style={{ background: "#f3f4f6", color: "#6b7280", borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>suggested</span> = Role-sensitive fields stay visible but compact
          </p>
        </div>
      </nav>
    </aside>
  );
}

// --- Name quality guard ---
/** Adds `years` to a YYYY-MM-DD string, handling leap-day edge cases. */
function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr + "T00:00:00");
  try {
    d.setFullYear(d.getFullYear() + years);
  } catch {
    // Handles Feb-29 leap-day: fall back to Feb-28
    d.setMonth(1);
    d.setDate(28);
    d.setFullYear(d.getFullYear() + years);
  }
  return d.toISOString().split("T")[0];
}

// --- Per-step required-field validation ---
function step1Missing(f: FormData): Set<string> {
  const m = new Set<string>();
  if (!f.first_name?.trim())  m.add("first_name");
  if (!f.last_name?.trim())   m.add("last_name");
  if (!f.gender)              m.add("gender");
  if (!f.date_of_birth)       m.add("date_of_birth");
  if (!f.nationality)         m.add("nationality");
  // Inactive status is treated as an incomplete condition — staff cannot be onboarded as inactive
  if (f.status === "inactive") m.add("status_inactive");
  return m;
}

function step2Missing(f: FormData): Set<string> {
  const m = new Set<string>();
  if (!f.department)      m.add("department");
  if (!f.designation)     m.add("designation");
  if (!f.role)            m.add("role");
  if (!f.employment_type) m.add("employment_type");
  if (!f.joining_date)    m.add("joining_date");
  return m;
}

function step3Missing(f: FormData): Set<string> {
  const m = new Set<string>();
  if (!f.mobile?.trim())           m.add("mobile");
  if (!f.personal_email?.trim())   m.add("personal_email");
  if (!f.preferred_communication)  m.add("preferred_communication");
  if (!f.current_address?.trim())  m.add("current_address");
  if (!f.city?.trim())             m.add("city");
  if (!f.state?.trim())            m.add("state");
  if (!f.current_pin?.trim())      m.add("current_pin");
  return m;
}

/** Returns true when a step's required fields are all valid. */
function isStepComplete(
  n: number, f: FormData, todayDate: string, maxDobDate: string, minDobDate: string, highestStep: number,
): boolean {
  if (n === 1) {
    if (step1Missing(f).size > 0) return false;
    const dob = f.date_of_birth ?? "";
    if (!dob) return false;
    if (dob >= todayDate) return false;          // future date
    if (dob > maxDobDate) return false;          // under 18
    if (dob < minDobDate) return false;          // over 70
    if (!isValidPersonName(f.first_name ?? "") || !isValidPersonName(f.last_name ?? "")) return false;
    return true;
  }
  if (n === 2) {
    if (step2Missing(f).size > 0) return false;
    const joining = f.joining_date ?? "";
    if (joining) {
      if (joining > todayDate) return false;     // future joining date
      const dob = f.date_of_birth ?? "";
      if (dob) {
        if (joining <= dob) return false;        // joining before/on DOB
        if (joining < addYears(dob, 18)) return false; // person under 18 at joining
      }
    }
    return true;
  }
  if (n === 3) {
    if (step3Missing(f).size > 0) return false;
    if (!isValidEmail(f.personal_email ?? "")) return false;
    if (!isValidPhoneDigits(f.mobile ?? "")) return false;
    if (!isValidPin(f.current_pin ?? "")) return false;
    const wa = (f.whatsapp ?? "").trim();
    if (wa && !isValidPhoneDigits(wa)) return false;
    const addr = (f.current_address ?? "").trim();
    if (addr.length < 5 || !hasAlphanumeric(addr) || isGibberishAddress(addr)) return false;
    return true;
  }
  // Steps 4–10: mark complete once the user has moved forward past them
  return highestStep > n;
}

// --- Step 1: Staff Identity ---
function StepIdentity({
  f, set, photoPreview, onPhotoClick, onCameraClick, onPhotoRemove,
  languages, religions, countries,
  langLoading, relLoading, countryLoading,
  langError, relError, countryError,
  maxDob, minDob, todayDate, showErrors,
}: {
  f: FormData;
  set: (k: string, v: string) => void;
  photoPreview: string | null;
  onPhotoClick: () => void;
  onCameraClick: () => void;
  onPhotoRemove: () => void;
  languages: { id: number; name: string }[];
  religions: { id: number; name: string }[];
  countries: { id: number; name: string }[];
  langLoading: boolean;
  relLoading: boolean;
  countryLoading: boolean;
  langError: string | null;
  relError: string | null;
  countryError: string | null;
  maxDob: string;
  minDob: string;
  todayDate: string;
  showErrors: boolean;
}) {
  const dobFuture   = !!f.date_of_birth && f.date_of_birth >= todayDate;
  const dobTooYoung = !!f.date_of_birth && !dobFuture && f.date_of_birth > maxDob;
  const dobTooOld   = !!f.date_of_birth && !dobFuture && !dobTooYoung && f.date_of_birth < minDob;
  const dobError    = !f.date_of_birth && showErrors
    ? "Date of birth is required."
    : dobFuture
      ? "Date of birth cannot be today or a future date."
      : dobTooYoung
        ? "Staff age must be at least 18 years."
        : dobTooOld
          ? "Please enter a valid date of birth. Age cannot exceed 70 years."
          : null;
  const firstNameErr = !f.first_name?.trim() && showErrors
    ? "First name is required."
    : f.first_name?.trim() && !isValidPersonName(f.first_name)
      ? PERSON_NAME_ERR
      : null;
  const middleNameErr = f.middle_name?.trim() && !isValidPersonName(f.middle_name) ? PERSON_NAME_ERR : null;
  const lastNameErr = !f.last_name?.trim() && showErrors
    ? "Last name is required."
    : f.last_name?.trim() && !isValidPersonName(f.last_name)
      ? PERSON_NAME_ERR
      : null;

  // Auto-generate the Staff Code once name + joining date are available.
  // Accept both legacy ST-YYYY-#### and current numeric YYYY#### shapes as
  // auto-generated, so year changes can refresh the value safely.
  const staffNoRequestKeyRef = useRef("");
  const [staffNoLoading, setStaffNoLoading] = useState(false);
  useEffect(() => {
    if (!f.first_name?.trim()) return;
    if (!f.joining_date) return;

    const currentStaffNo = String(f.staff_no ?? "").trim();
    const isAutoGenerated = /^(ST-\d{4}-\d{4,}|\d{8,})$/.test(currentStaffNo);
    if (currentStaffNo && !isAutoGenerated) return;

    const requestKey = `${f.joining_date}|${f.first_name.trim().toLowerCase()}`;
    if (staffNoRequestKeyRef.current === requestKey && currentStaffNo) return;
    staffNoRequestKeyRef.current = requestKey;

    setStaffNoLoading(true);
    (async () => {
      try {
        const res = await apiRequestWithRefreshResponse(
          `/api/v1/hr/staff/next-staff-no/?joining_date=${encodeURIComponent(f.joining_date ?? "")}`,
          { silent401: true },
        );
        if (res.ok) {
          const j = (await res.json()) as { staff_no?: string };
          if (j?.staff_no) set("staff_no", j.staff_no);
        }
      } catch {
        // Silent — backend still auto-allocates a staff_no at submit time if this never resolves.
      } finally {
        setStaffNoLoading(false);
      }
    })();
  }, [f.first_name, f.joining_date, f.staff_no, set]);

  return (
    <div className="flex flex-col gap-8">
      {/* Photo upload */}
      <div className="onboard-photo-upload-block">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={onPhotoClick}
            className={photoPreview ? "onboard-photo-circle has-photo" : "onboard-photo-circle"}
          >
            {photoPreview ? (
              <img src={photoPreview} alt="Staff" />
            ) : (
              <>
                <span className="onboard-camera-icon">+</span>
                <span className="onboard-photo-label">ADD PHOTO</span>
              </>
            )}
          </button>
          {photoPreview && (
            <button
              type="button"
              onClick={onPhotoRemove}
              title="Remove photo"
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#EF4444] text-white flex items-center justify-center shadow hover:bg-[#DC2626] transition-colors"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <div>
          <p className="onboard-photo-title">Staff photo</p>
          <p className="onboard-photo-desc">
            Square JPG or PNG, at least 400x400px. Used for ID card, directory, payroll and attendance.
          </p>
          <div className="onboard-photo-actions">
            <button type="button" className="btn-upload-file" onClick={onPhotoClick}>{photoPreview ? "Change" : "Upload file"}</button>
            <button type="button" className="btn-take-photo" onClick={onCameraClick}>Take photo</button>
          </div>
        </div>
      </div>

      {/* Row 1: Staff Code | Biometric/RFID | Status */}
      <div className="grid grid-cols-3 gap-6">
        <HrField label="Staff Code" required>
          <HrInput
            value={f.staff_no ? f.staff_no : staffNoLoading ? "Generating…" : "Auto generated on save"}
            readOnly
            className="bg-[#F1F5F9] cursor-not-allowed !text-[#94A3B8]"
          />
        </HrField>
        <HrField label="Biometric / RFID Code" error={f.biometric_rfid && /[^A-Za-z0-9]/.test(f.biometric_rfid) ? "Only letters and numbers are allowed." : undefined}>
          <HrInput
            value={f.biometric_rfid ?? ""}
            onChange={(e) => set("biometric_rfid", e.target.value.replace(/[^A-Za-z0-9]/g, ""))}
            placeholder="Assigned later"
            maxLength={30}
          />
        </HrField>
        <HrField label="Status" required>
          <div className="flex rounded-[11px] overflow-hidden border border-[#E2E8F0] h-[44px]">
            <button
              type="button"
              onClick={() => set("status", "active")}
              className="flex-1 text-[12.5px] font-[700] transition-colors"
              style={{
                background: (f.status ?? "active") !== "inactive" ? "#15172A" : "white",
                color:      (f.status ?? "active") !== "inactive" ? "white" : "#64748B",
              }}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => set("status", "inactive")}
              className="flex-1 text-[12.5px] font-[700] transition-colors border-l border-[#E2E8F0]"
              style={{
                background: f.status === "inactive" ? "#15172A" : "white",
                color:      f.status === "inactive" ? "white" : "#64748B",
              }}
            >
              Inactive
            </button>
          </div>
          {showErrors && f.status === "inactive" && (
            <p className="mt-1 text-[11px] text-[#dc2626]">Inactive staff cannot continue onboarding. Change status to Active.</p>
          )}
        </HrField>
      </div>

      {/* Row 2: First Name | Middle Name | Last Name */}
      <div className="grid grid-cols-3 gap-6">
        <HrField label="First Name" required>
          <HrInput
            value={f.first_name ?? ""}
            onChange={(e) => set("first_name", e.target.value.replace(/[^a-zA-Z\s'\-.]/g, ""))}
            placeholder="e.g. Priya"
            maxLength={50}
          />
          {firstNameErr
            ? <p className="mt-1 text-[11px] text-[#dc2626]">{firstNameErr}</p>
            : (f.first_name?.length ?? 0) > 35
              ? <p className="mt-1 text-[11px]" style={{ color: (f.first_name?.length ?? 0) >= 50 ? "#dc2626" : "#94A3B8" }}>{f.first_name?.length ?? 0}/50</p>
              : null
          }
        </HrField>
        <HrField label="Middle Name">
          <HrInput
            value={f.middle_name ?? ""}
            onChange={(e) => set("middle_name", e.target.value.replace(/[^a-zA-Z\s'\-.]/g, ""))}
            placeholder="Optional"
            maxLength={50}
          />
          {middleNameErr
            ? <p className="mt-1 text-[11px] text-[#dc2626]">{middleNameErr}</p>
            : (f.middle_name?.length ?? 0) > 35
              ? <p className="mt-1 text-[11px]" style={{ color: (f.middle_name?.length ?? 0) >= 50 ? "#dc2626" : "#94A3B8" }}>{f.middle_name?.length ?? 0}/50</p>
              : null
          }
        </HrField>
        <HrField label="Last Name" required>
          <HrInput
            value={f.last_name ?? ""}
            onChange={(e) => set("last_name", e.target.value.replace(/[^a-zA-Z\s'\-.]/g, ""))}
            placeholder="e.g. Sharma"
            maxLength={50}
          />
          {lastNameErr
            ? <p className="mt-1 text-[11px] text-[#dc2626]">{lastNameErr}</p>
            : (f.last_name?.length ?? 0) > 35
              ? <p className="mt-1 text-[11px]" style={{ color: (f.last_name?.length ?? 0) >= 50 ? "#dc2626" : "#94A3B8" }}>{f.last_name?.length ?? 0}/50</p>
              : null
          }
        </HrField>
      </div>

      {/* Row 3: Date of Birth | Gender | Blood Group */}
      <div className="grid grid-cols-3 gap-6">
        <HrField label="Date of Birth" required>
          <HrInput
            type="date"
            value={f.date_of_birth ?? ""}
            onChange={(e) => set("date_of_birth", e.target.value)}
            placeholder="dd/mm/yyyy"
          />
          {dobError ? (
            <p className="mt-1 text-[11px] text-[#dc2626]">{dobError}</p>
          ) : f.date_of_birth ? (
            <p className="mt-1 text-[11px] text-[#16a34a]">✓ Valid</p>
          ) : null}
        </HrField>
        <HrField label="Gender" required>
          <HrSelect value={f.gender ?? ""} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Select</option>
            {GENDERS.map((g) => <option key={g}>{g}</option>)}
          </HrSelect>
          {showErrors && !f.gender && (
            <p className="mt-1 text-[11px] text-[#dc2626]">Gender is required.</p>
          )}
        </HrField>
        <HrField label="Blood Group">
          <HrSelect value={f.blood_group_input ?? ""} onChange={(e) => set("blood_group_input", e.target.value)}>
            <option value="">Select</option>
            {BLOOD_GROUPS.map((b) => <option key={b}>{b}</option>)}
          </HrSelect>
        </HrField>
      </div>

      {/* Row 4: Mother Tongue | Religion | Nationality */}
      <div className="grid grid-cols-3 gap-6">
        <HrField label="Mother Tongue">
          <SearchableSelect
            value={f.mother_tongue ?? ""}
            onChange={(v) => set("mother_tongue", v)}
            options={languages}
            placeholder="Select language"
            loading={langLoading}
            error={langError}
            customValue={f.mother_tongue_other ?? ""}
            onCustomChange={(v) => set("mother_tongue_other", v)}
            customPlaceholder="Specify language…"
          />
        </HrField>
        <HrField label="Religion">
          <SearchableSelect
            value={f.religion ?? ""}
            onChange={(v) => set("religion", v)}
            options={religions}
            placeholder="Select religion"
            loading={relLoading}
            error={relError}
            customValue={f.religion_other ?? ""}
            onCustomChange={(v) => set("religion_other", v)}
            customPlaceholder="Specify religion…"
          />
        </HrField>
        <HrField label="Nationality" required>
          <SearchableSelect
            value={f.nationality ?? ""}
            onChange={(v) => set("nationality", v)}
            options={countries}
            placeholder="Select country"
            loading={countryLoading}
            error={countryError}
            customValue={f.nationality_other ?? ""}
            onCustomChange={(v) => set("nationality_other", v)}
            customPlaceholder="Specify nationality…"
          />
          {showErrors && !f.nationality && (
            <p className="mt-1 text-[11px] text-[#dc2626]">Nationality is required.</p>
          )}
        </HrField>
      </div>
    </div>
  );
}

// --- Step 2: Role & Placement ---
function StepRole({
  f, set, departments, designations, roles, staffList,
  empTypes, empLoading, empError, showErrors, todayDate,
}: {
  f: FormData;
  set: (k: string, v: string) => void;
  departments: { id: number; name: string }[];
  designations: { id: number; name: string; department: number }[];
  roles: { id: number; name: string }[];
  staffList: { id: number; first_name: string; last_name: string }[];
  empTypes: { id: number; name: string }[];
  empLoading: boolean;
  empError: string | null;
  showErrors: boolean;
  todayDate: string;
}) {
  const filteredDesigs = designations.filter(
    (d) => !f.department || String(d.department) === String(f.department),
  );

  // Joining date cross-validation
  const joiningDate     = f.joining_date ?? "";
  const dob             = f.date_of_birth ?? "";
  const joiningFuture   = !!joiningDate && joiningDate > todayDate;
  const joiningBeforeDob = !!joiningDate && !!dob && joiningDate <= dob;
  const joiningTooYoung = !!joiningDate && !!dob && !joiningBeforeDob && joiningDate < addYears(dob, 18);
  const joiningDateErr  = !joiningDate && showErrors
    ? "Joining date is required."
    : joiningFuture
      ? "Joining date cannot be a future date."
      : joiningBeforeDob
        ? "Joining date cannot be earlier than date of birth."
        : joiningTooYoung
          ? "Staff must be at least 18 years old at the time of joining."
          : null;
  const joiningValid = !!joiningDate && !joiningFuture && !joiningBeforeDob && !joiningTooYoung;
  return (
    <div className="flex flex-col gap-6">
      {/* Row 1: Department | Designation | Role/access */}
      <div className="grid grid-cols-3 gap-6">
        <HrField label="Department" required>
          <HrDropdown
            value={String(f.department ?? "")}
            onChange={(v) => set("department", v)}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Select..."
          />
          {showErrors && !f.department && (
            <p className="mt-1 text-[11px] text-[#dc2626]">Department is required.</p>
          )}
        </HrField>
        <HrField label="Designation" required>
          <HrDropdown
            value={String(f.designation ?? "")}
            onChange={(v) => set("designation", v)}
            options={filteredDesigs.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Select..."
          />
          {showErrors && !f.designation && (
            <p className="mt-1 text-[11px] text-[#dc2626]">Designation is required.</p>
          )}
        </HrField>
        <HrField label="Role / Access" required>
          <HrDropdown
            value={String(f.role ?? "")}
            onChange={(v) => set("role", v)}
            options={roles.length
              ? roles.map((r) => ({ value: r.id, label: r.name }))
              : ROLES.map((r) => ({ value: r, label: r }))}
            placeholder="Select..."
          />
          {showErrors && !f.role && (
            <p className="mt-1 text-[11px] text-[#dc2626]">Role / Access is required.</p>
          )}
        </HrField>
      </div>

      {/* Row 2: Joining Date | Employment Type | Probation Period */}
      <div className="grid grid-cols-3 gap-6">
        <HrField label="Joining Date" required>
          <HrInput type="date" value={f.joining_date ?? ""} onChange={(e) => set("joining_date", e.target.value)} />
          {joiningDateErr
            ? <p className="mt-1 text-[11px] text-[#dc2626]">{joiningDateErr}</p>
            : joiningValid
              ? <p className="mt-1 text-[11px] text-[#16a34a]">✓ Valid</p>
              : null
          }
        </HrField>
        <HrField label="Employment Type" required>
          <SearchableSelect
            value={f.employment_type ?? ""}
            onChange={(v) => set("employment_type", v)}
            options={empTypes}
            placeholder="Select employment type..."
            loading={empLoading}
            error={empError}
            customValue={f.employment_type_other ?? ""}
            onCustomChange={(v) => set("employment_type_other", v)}
            customPlaceholder="Specify employment type..."
          />
          {showErrors && !f.employment_type && (
            <p className="mt-1 text-[11px] text-[#dc2626]">Employment type is required.</p>
          )}
        </HrField>
        {/* Probation Period: grouped input (value + unit share one border) */}
        {(() => {
          const probVal   = (f.probation_value ?? "").trim();
          const probUnit  = f.probation_unit || "months";
          const maxByUnit: Record<string, number> = { days: 365, months: 24, years: 5 };
          const probMax   = maxByUnit[probUnit] ?? 24;
          const probNum   = Number(probVal);
          const probErr   = probVal
            ? (!/^\d+$/.test(probVal) || probNum <= 0 || probNum > probMax)
              ? `Enter valid probation duration (max ${probMax} ${probUnit}).`
              : null
            : null;
          return (
            <HrField label="Probation Period">
              {/* Single-border grouped field: [value input] | [unit select] */}
              <div className="h-[44px] flex items-center border border-[var(--line)] rounded-[11px] bg-white focus-within:border-[#c4b5fd] overflow-hidden transition-colors">
                <input
                  className="flex-1 h-full px-3 bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[#94A3B8] min-w-0"
                  type="text"
                  inputMode="numeric"
                  value={f.probation_value ?? ""}
                  onChange={(e) => set("probation_value", e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="e.g. 6"
                  maxLength={3}
                />
                {/* vertical divider */}
                <div className="w-px h-[24px] bg-[var(--line)] shrink-0" />
                {/* unit select with custom arrow */}
                <div className="relative shrink-0 h-full flex items-center">
                  <select
                    className="h-full pl-3 pr-8 bg-transparent text-[13px] text-[var(--ink)] outline-none appearance-none cursor-pointer"
                    value={f.probation_unit || "months"}
                    onChange={(e) => set("probation_unit", e.target.value)}
                  >
                    <option value="days">Days</option>
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                  </select>
                  <span className="pointer-events-none absolute right-2 text-[#94A3B8] text-[10px] leading-none">▼</span>
                </div>
              </div>
              {probErr && <p className="mt-1 text-[11px] text-[#dc2626]">{probErr}</p>}
            </HrField>
          );
        })()}
      </div>

      {/* Full-width: Reporting Manager */}
      <HrField label="Reporting Manager">
        <HrDropdown
          value={String(f.reporting_manager ?? "")}
          onChange={(v) => set("reporting_manager", v)}
          options={staffList.map((s) => ({ value: s.id, label: `${s.first_name} ${s.last_name}` }))}
          placeholder="Select reporting manager..."
        />
      </HrField>
    </div>
  );
}

// --- Step 3: Contact & Address ---
function StepContact({
  f, set, showErrors,
}: {
  f: FormData;
  set: (k: string, v: string) => void;
  showErrors: boolean;
}) {
  const sameAddr = f.same_address === "true";
  const [mobileCc,   setMobileCc]   = useState("+91");
  const [whatsappCc, setWhatsappCc] = useState("+91");
  const [pinLoading,  setPinLoading]  = useState(false);
  const [pinAutoFilled, setPinAutoFilled] = useState(false);
  const prevPinRef = useRef("");

  const ccSel = [
    "h-[44px] px-3 border border-[var(--line)] rounded-[11px] bg-white text-[13px]",
    "text-[var(--ink)] outline-none focus:border-[#c4b5fd] shrink-0",
  ].join(" ");

  // ── Validation computed values ───────────────────────────────────────────
  const mobileRaw   = (f.mobile ?? "").trim();
  const mobileDigits = mobileRaw.replace(/\D/g, "");
  const mobileErr = !mobileRaw && showErrors
    ? "Mobile number is required."
    : mobileRaw && !/^\d+$/.test(mobileRaw)
      ? "Enter digits only."
      : mobileRaw && mobileDigits.length !== 10
        ? "Enter a valid 10-digit mobile number."
        : null;

  const emailRaw = (f.personal_email ?? "").trim();
  const emailErr = !emailRaw && showErrors
    ? "Personal email is required."
    : emailRaw && !isValidEmail(emailRaw)
      ? "Enter a valid email address."
      : null;

  const officialEmailRaw = (f.official_email ?? "").trim();
  const officialEmailErr = officialEmailRaw && !isValidEmail(officialEmailRaw)
    ? "Enter a valid email address."
    : null;

  const waRaw    = (f.whatsapp ?? "").trim();
  const waDigits = waRaw.replace(/\D/g, "");
  const waErr = waRaw && (!/^\d+$/.test(waRaw) || waDigits.length !== 10)
    ? "Enter a valid 10-digit mobile number."
    : null;

  const altMobRaw    = (f.alternate_mobile ?? "").trim();
  const altMobDigits = altMobRaw.replace(/\D/g, "");
  const altMobErr = altMobRaw && altMobDigits.length !== 10
    ? "Enter a valid 10-digit mobile number."
    : null;

  const commErr = !f.preferred_communication && showErrors
    ? "Select preferred communication method."
    : null;

  const addrRaw = (f.current_address ?? "").trim();
  const addrErr = !addrRaw && showErrors
    ? "Address line 1 is required."
    : addrRaw && addrRaw.length < 5
      ? "Address must be at least 5 characters."
      : addrRaw && !hasAlphanumeric(addrRaw)
        ? "Address cannot contain only special characters."
        : addrRaw && isGibberishAddress(addrRaw)
          ? "Enter a valid address (repeated characters not allowed)."
          : null;

  const addr2Raw = (f.current_address_line2 ?? "").trim();
  const addr2Err = addr2Raw && isGibberishAddress(addr2Raw)
    ? "Enter a valid address (repeated characters not allowed)."
    : null;

  const permAddrRaw = (f.permanent_address ?? "").trim();
  const permAddrErr = permAddrRaw && isGibberishAddress(permAddrRaw)
    ? "Enter a valid address (repeated characters not allowed)."
    : permAddrRaw && permAddrRaw.length < 5
      ? "Address must be at least 5 characters."
      : permAddrRaw && !hasAlphanumeric(permAddrRaw)
        ? "Address cannot contain only special characters."
        : null;

  const cityRaw  = (f.city ?? "").trim();
  const cityErr  = !cityRaw && showErrors
    ? "City is required."
    : cityRaw && isGibberishPlaceName(cityRaw)
      ? "Enter a valid city name."
      : null;

  const stateRaw = (f.state ?? "").trim();
  const stateErr = !stateRaw && showErrors
    ? "State is required."
    : stateRaw && isGibberishPlaceName(stateRaw)
      ? "Enter a valid state name."
      : null;

  const countryRaw = (f.current_country ?? "").trim();
  const countryErr = countryRaw && isGibberishPlaceName(countryRaw)
    ? "Enter a valid country name."
    : null;

  const permCityRaw = (f.permanent_city ?? "").trim();
  const permCityErr = permCityRaw && isGibberishPlaceName(permCityRaw)
    ? "Enter a valid city name."
    : null;

  const permStateRaw = (f.permanent_state ?? "").trim();
  const permStateErr = permStateRaw && isGibberishPlaceName(permStateRaw)
    ? "Enter a valid state name."
    : null;

  const permCountryRaw = (f.permanent_country ?? "").trim();
  const permCountryErr = permCountryRaw && isGibberishPlaceName(permCountryRaw)
    ? "Enter a valid country name."
    : null;

  const pinRaw = (f.current_pin ?? "").trim();
  const pinErr = !pinRaw && showErrors
    ? "PIN code is required."
    : pinRaw && !/^\d{5,6}$/.test(pinRaw)
      ? "Enter a valid PIN code (5–6 digits)."
      : null;
  const pinIsValid = isValidPin(pinRaw);

  // ── PIN code lookup ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!pinIsValid || pinRaw === prevPinRef.current) return;
    prevPinRef.current = pinRaw;
    setPinLoading(true);
    setPinAutoFilled(false);
    void (async () => {
      try {
        const { lookupPincode } = await import("@/hooks/useHrApi");
        const result = await lookupPincode(pinRaw);
        if (result) {
          set("city",            result.city);
          set("state",           result.state);
          set("current_country", result.country);
          setPinAutoFilled(true);
        }
      } catch { /* ignore lookup errors silently */ }
      finally { setPinLoading(false); }
    })();
  }, [pinRaw]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Same-address sync ────────────────────────────────────────────────────
  useEffect(() => {
    if (!sameAddr) return;
    set("permanent_address", f.current_address ?? "");
    set("permanent_city",    f.city            ?? "");
    set("permanent_state",   f.state           ?? "");
    set("permanent_pin",     f.current_pin     ?? "");
    set("permanent_country", f.current_country ?? "");
  }, [ // eslint-disable-line react-hooks/exhaustive-deps
    sameAddr,
    f.current_address, f.city, f.state, f.current_pin, f.current_country,
  ]);

  const errTxt = (msg: string | null) =>
    msg ? <p className="mt-1 text-[11px] text-[#dc2626]">{msg}</p> : null;

  return (
    <div className="flex flex-col gap-8">

      {/* ── 01 · CONTACT ─────────────────────────────── */}
      <div className="flex flex-col gap-5">
        <div className="text-[10.5px] font-[900] text-[#94A3B8] uppercase tracking-[0.1em] pb-3 border-b border-[#F1F5F9]">
          01 · Contact
        </div>

        {/* Row 1: Mobile | Alternate Mobile | Official Email */}
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Mobile <span className="text-[var(--red)]">*</span>
            </label>
            <div className="flex gap-2">
              <select className={ccSel} value={mobileCc} onChange={(e) => setMobileCc(e.target.value)}>
                {CC_OPTIONS.map((cc) => <option key={cc}>{cc}</option>)}
              </select>
              <HrInput
                className="flex-1 min-w-0"
                value={f.mobile ?? ""}
                onChange={(e) => set("mobile", e.target.value.replace(/[^\d]/g, ""))}
                placeholder="Mobile number"
                maxLength={10}
              />
            </div>
            {mobileErr
              ? errTxt(mobileErr)
              : <span className="text-[11px] text-[#94A3B8] -mt-1">Used for WhatsApp</span>}
          </div>

          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Alternate Mobile</label>
            <HrInput
              value={f.alternate_mobile ?? ""}
              onChange={(e) => set("alternate_mobile", e.target.value.replace(/[^\d]/g, ""))}
              placeholder="Optional"
              maxLength={10}
            />
            {errTxt(altMobErr)}
          </div>

          <HrField label="Official Email">
            <HrInput type="email" value={f.official_email ?? ""} onChange={(e) => set("official_email", e.target.value.replace(/\s/g, ""))} placeholder="name@school.edu.in" maxLength={254} />
            {errTxt(officialEmailErr)}
          </HrField>
        </div>

        {/* Row 2: Personal Email | WhatsApp | Preferred Communication */}
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Personal Email <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput type="email" value={f.personal_email ?? ""} onChange={(e) => set("personal_email", e.target.value.replace(/\s/g, ""))} placeholder="personal@gmail.com" maxLength={254} />
            {errTxt(emailErr)}
          </div>

          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">WhatsApp</label>
            <div className="flex gap-2">
              <select className={ccSel} value={whatsappCc} onChange={(e) => setWhatsappCc(e.target.value)}>
                {CC_OPTIONS.map((cc) => <option key={cc}>{cc}</option>)}
              </select>
              <HrInput
                className="flex-1 min-w-0"
                value={f.whatsapp ?? ""}
                onChange={(e) => set("whatsapp", e.target.value.replace(/[^\d]/g, ""))}
                placeholder=""
                maxLength={10}
              />
            </div>
            <label className="flex items-center gap-[7px] text-[12px] text-[#64748B] cursor-pointer -mt-1">
              <input
                type="checkbox"
                checked={!!f.mobile && f.whatsapp === f.mobile}
                onChange={(e) => set("whatsapp", e.target.checked ? (f.mobile ?? "") : "")}
                className="accent-[var(--brand)] w-[13px] h-[13px] shrink-0"
              />
              Same as mobile
            </label>
            {errTxt(waErr)}
          </div>

          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Preferred Communication <span className="text-[var(--red)]">*</span>
            </label>
            <HrSelect value={f.preferred_communication ?? ""} onChange={(e) => set("preferred_communication", e.target.value)}>
              <option value="">Select...</option>
              <option value="mobile">Mobile</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="personal_email">Personal Email</option>
              <option value="official_email">Official Email</option>
            </HrSelect>
            {errTxt(commErr)}
          </div>
        </div>
      </div>

      {/* ── 02 · CURRENT ADDRESS ─────────────────────── */}
      <div className="flex flex-col gap-5">
        <div className="text-[10.5px] font-[900] text-[#94A3B8] uppercase tracking-[0.1em] pb-3 border-b border-[#F1F5F9]">
          02 · Current Address
        </div>
        <div className="flex flex-col gap-[9px]">
          <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
            Address Line 1 <span className="text-[var(--red)]">*</span>
          </label>
          <HrInput value={f.current_address ?? ""} onChange={(e) => set("current_address", e.target.value)} placeholder="House no., Building, Street" maxLength={150} />
          {errTxt(addrErr)}
        </div>
        <HrField label="Address Line 2">
          <HrInput value={f.current_address_line2 ?? ""} onChange={(e) => set("current_address_line2", e.target.value)} placeholder="Area / Locality (optional)" maxLength={100} />
          {errTxt(addr2Err)}
        </HrField>
        <div className="grid grid-cols-4 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              City <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput value={f.city ?? ""} onChange={(e) => set("city", e.target.value.replace(/[^a-zA-Z\s'\-]/g, ""))} placeholder="City" />
            {errTxt(cityErr)}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              State <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput value={f.state ?? ""} onChange={(e) => set("state", e.target.value.replace(/[^a-zA-Z\s'\-]/g, ""))} placeholder="State" />
            {errTxt(stateErr)}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              PIN Code <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput
              value={f.current_pin ?? ""}
              onChange={(e) => { set("current_pin", e.target.value.replace(/\D/g, "")); setPinAutoFilled(false); }}
              placeholder="560001"
              maxLength={6}
            />
            {pinErr
              ? errTxt(pinErr)
              : pinLoading
                ? <p className="mt-1 text-[11px] text-[#94A3B8]">Looking up location…</p>
                : pinAutoFilled
                  ? <p className="mt-1 text-[11px] text-[#22c55e]">✓ Location auto-filled</p>
                  : null}
          </div>
          <HrField label="Country">
            <HrInput value={f.current_country ?? ""} onChange={(e) => set("current_country", e.target.value.replace(/[^a-zA-Z\s'\-]/g, ""))} placeholder="India" />
            {errTxt(countryErr)}
          </HrField>
        </div>
      </div>

      {/* ── 03 · PERMANENT ADDRESS ───────────────────── */}
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
          <div className="text-[10.5px] font-[900] text-[#94A3B8] uppercase tracking-[0.1em]">
            03 · Permanent Address
          </div>
          <label className="flex items-center gap-[7px] text-[12.5px] text-[#475569] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sameAddr}
              onChange={(e) => {
                const checked = e.target.checked;
                set("same_address", checked ? "true" : "false");
                if (checked) {
                  set("permanent_address", f.current_address ?? "");
                  set("permanent_city",    f.city            ?? "");
                  set("permanent_state",   f.state           ?? "");
                  set("permanent_pin",     f.current_pin     ?? "");
                  set("permanent_country", f.current_country ?? "");
                }
              }}
              className="accent-[var(--brand)] w-[13px] h-[13px] shrink-0"
            />
            Same as current address
          </label>
        </div>
        <HrField label="Address Line 1">
          <HrInput
            value={f.permanent_address ?? ""}
            onChange={(e) => set("permanent_address", e.target.value)}
            placeholder="House no., Building, Street"
            maxLength={150}
            disabled={sameAddr}
          />
          {errTxt(permAddrErr)}
        </HrField>
        <div className="grid grid-cols-4 gap-6">
          <HrField label="City">
            <HrInput
              value={f.permanent_city ?? ""}
              onChange={(e) => set("permanent_city", e.target.value.replace(/[^a-zA-Z\s'\-]/g, ""))}
              placeholder="City"
              disabled={sameAddr}
            />
            {errTxt(permCityErr)}
          </HrField>
          <HrField label="State">
            <HrInput
              value={f.permanent_state ?? ""}
              onChange={(e) => set("permanent_state", e.target.value.replace(/[^a-zA-Z\s'\-]/g, ""))}
              placeholder="State"
              disabled={sameAddr}
            />
            {errTxt(permStateErr)}
          </HrField>
          <HrField label="Pin Code">
            <HrInput
              value={f.permanent_pin ?? ""}
              onChange={(e) => set("permanent_pin", e.target.value.replace(/\D/g, ""))}
              placeholder="560001"
              maxLength={6}
              disabled={sameAddr}
            />
          </HrField>
          <HrField label="Country">
            <HrInput
              value={f.permanent_country ?? ""}
              onChange={(e) => set("permanent_country", e.target.value.replace(/[^a-zA-Z\s'\-]/g, ""))}
              placeholder="India"
              disabled={sameAddr}
            />
            {errTxt(permCountryErr)}
          </HrField>
        </div>
      </div>

    </div>
  );
}

// --- Step 4: Family & Emergency ---
function StepFamily({ f, set, showErrors, validatorRef }: {
  f: FormData;
  set: (k: string, v: string) => void;
  showErrors: boolean;
  validatorRef: React.MutableRefObject<() => string | null>;
}) {
  type EC = { name: string; relation: string; mobileCc: string; mobile: string; alt_mobile: string; email: string };
  type Nominee = { name: string; relation: string; share: string };
  const [ecs, setEcs] = useState<EC[]>(() => {
    try {
      if ((f as any).emergency_contacts) {
        return typeof (f as any).emergency_contacts === "string" ? JSON.parse((f as any).emergency_contacts) : (f as any).emergency_contacts;
      }
    } catch(e) {}
    return [{
      name: f.emergency_name ?? "",
      relation: f.emergency_relation ?? "",
      mobileCc: "+91",
      mobile: f.emergency_phone ?? "",
      alt_mobile: "",
      email: "",
    }];
  });
  const [nominees, setNominees] = useState<Nominee[]>(() => {
    try {
      if ((f as any).nominees) {
        return typeof (f as any).nominees === "string" ? JSON.parse((f as any).nominees) : (f as any).nominees;
      }
    } catch(e) {}
    return [{ name: "", relation: "", share: "" }];
  });

  useEffect(() => { set("emergency_contacts", JSON.stringify(ecs)); }, [ecs]);
  useEffect(() => { set("nominees", JSON.stringify(nominees)); }, [nominees]);

  const setEc = (i: number, k: keyof EC, v: string) => {
    setEcs((prev) => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
    // Keep first EC in sync with parent form for goNext validation.
    // Done OUTSIDE the setEcs updater so the parent setForm reliably commits.
    if (i === 0) {
      if (k === "name")     set("emergency_name",     v);
      if (k === "relation") set("emergency_relation", v);
      if (k === "mobile")   set("emergency_phone",    v);
    }
  };
  const setNom = (i: number, k: keyof Nominee, v: string) => setNominees((p) => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const errTxt = (msg: string | null) =>
    msg ? <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">{msg}</p> : null;

  const status   = (f.marital_status ?? "").trim();
  const isSingle = status === "Single";
  const isMarried = status === "Married";

  // ── Marital section errors ──────────────────────────────────────────────
  const spouseRaw = (f.spouse_parent_name ?? "").trim();
  const spouseErr = spouseRaw && !isValidPersonName(spouseRaw) ? PERSON_NAME_ERR : null;

  const childrenRaw = String(f.num_children ?? "").trim();
  const childrenErr = childrenRaw && (!/^\d+$/.test(childrenRaw) || Number(childrenRaw) > 15)
    ? "Please enter a valid number of children (0–15)."
    : null;

  // ── Per-EC inline errors ────────────────────────────────────────────────
  const ecErrors = ecs.map((ec, i) => {
    const isFirst  = i === 0;
    const nameTrim = ec.name.trim();
    const nameErr  = !nameTrim && isFirst && showErrors
      ? "Name is required."
      : nameTrim && !isValidPersonName(nameTrim)
        ? PERSON_NAME_ERR
        : null;
    const relErr = !ec.relation && isFirst && showErrors
      ? "Relationship is required."
      : null;
    const mobDigits = ec.mobile.replace(/\D/g, "");
    const mobErr = !ec.mobile.trim() && isFirst && showErrors
      ? "Please enter a valid mobile number."
      : ec.mobile.trim() && !isValidIndianMobile(mobDigits)
        ? "Please enter a valid mobile number."
        : null;
    const altDigits     = ec.alt_mobile.replace(/\D/g, "");
    const primaryDigits = ec.mobile.replace(/\D/g, "");
    const altMobErr = ec.alt_mobile.trim() && !isValidIndianMobile(altDigits)
      ? "Please enter a valid mobile number."
      : ec.alt_mobile.trim() && altDigits === primaryDigits && primaryDigits.length === 10
        ? "Alternate mobile cannot be the same as primary mobile."
        : null;
    const emailErr = ec.email.trim() && !isValidEmail(ec.email.trim())
      ? "Please enter a valid email address."
      : null;
    return { nameErr, relErr, mobErr, altMobErr, emailErr };
  });

  // ── Nominee share validation (exposed via ref for goNext) ───────────────
  const totalShare = nominees.reduce((s, n) => s + (Number(n.share) || 0), 0);
  const hasAnyShare = nominees.some((n) => n.share.trim() !== "");
  const totalShareErr =
    hasAnyShare && nominees.length > 1 && totalShare !== 100
      ? "Total nominee share must equal 100%."
      : null;

  validatorRef.current = () => {
    if (!hasAnyShare) return null;
    for (const n of nominees) {
      if (n.share.trim()) {
        const v = Number(n.share);
        if (!Number.isInteger(v) || v < 1 || v > 100) return "Nominee share cannot exceed 100%.";
      }
    }
    if (nominees.length > 1 && totalShare !== 100) return "Total nominee share must equal 100%.";
    return null;
  };

  return (
    <div className="flex flex-col gap-8">

      {/* 01 · Marital & family */}
      <WizardBlock title="01 · Marital &amp; family">
        <div className="grid grid-cols-3 gap-6">
          <HrField label="Marital Status">
            <HrSelect
              value={f.marital_status ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                set("marital_status", v);
                if (v === "Single") {
                  set("spouse_parent_name", "");
                  set("num_children", "");
                }
              }}
            >
              <option value="">Select...</option>
              {MARITAL_STATUS.map((m) => <option key={m}>{m}</option>)}
            </HrSelect>
          </HrField>

          {!isSingle && (
            <HrField label="No. of Children">
              <HrInput
                value={f.num_children ?? ""}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "");
                  if (raw === "" || Number(raw) <= 15) set("num_children", raw);
                }}
                placeholder="0"
                maxLength={2}
              />
              {errTxt(childrenErr)}
            </HrField>
          )}

          {!isSingle && (
            <div className="flex flex-col gap-[9px]">
              <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
                {isMarried ? "Spouse Name" : "Spouse / Parent Name"}
              </label>
              <HrInput
                value={f.spouse_parent_name ?? ""}
                onChange={(e) => set("spouse_parent_name", e.target.value.replace(/[^a-zA-Z ]/g, ""))}
                placeholder="Full name"
                maxLength={40}
              />
              {errTxt(spouseErr)}
            </div>
          )}
        </div>
      </WizardBlock>

      {/* 02 · Emergency contacts */}
      <WizardBlock title="02 · Emergency contacts">
        {ecs.map((ec, i) => {
          const errs = ecErrors[i];
          return (
            <div key={i} className="flex flex-col gap-5 pb-5 border-b border-[#F1F5F9] last:border-0 last:pb-0">
              <div className="grid grid-cols-3 gap-6">
                <div className="flex flex-col gap-[9px]">
                  <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
                    Name <span className="text-[var(--red)]">*</span>
                  </label>
                  <HrInput
                    value={ec.name}
                    onChange={(e) => setEc(i, "name", e.target.value.replace(/[^a-zA-Z ]/g, ""))}
                    placeholder="Full name"
                    maxLength={40}
                  />
                  {errTxt(errs.nameErr)}
                </div>
                <div className="flex flex-col gap-[9px]">
                  <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
                    Relationship <span className="text-[var(--red)]">*</span>
                  </label>
                  <HrSelect value={ec.relation} onChange={(e) => setEc(i, "relation", e.target.value)}>
                    <option value="">Select...</option>
                    {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                  </HrSelect>
                  {errTxt(errs.relErr)}
                </div>
                <div className="flex flex-col gap-[9px]">
                  <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
                    Mobile <span className="text-[var(--red)]">*</span>
                  </label>
                  <div className="flex gap-2">
                    <select
                      className={CC_SEL_CLS}
                      value={ec.mobileCc}
                      onChange={(e) => setEc(i, "mobileCc", e.target.value)}
                    >
                      {CC_OPTIONS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                    <HrInput
                      className="flex-1 min-w-0"
                      value={ec.mobile}
                      onChange={(e) => setEc(i, "mobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
                      placeholder="Mobile number"
                      maxLength={10}
                    />
                  </div>
                  {errTxt(errs.mobErr)}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div className="flex flex-col gap-[9px]">
                  <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Alternate Mobile</label>
                  <HrInput
                    value={ec.alt_mobile}
                    onChange={(e) => setEc(i, "alt_mobile", e.target.value.replace(/\D/g, "").slice(0, 10))}
                    placeholder="Optional"
                    maxLength={10}
                  />
                  {errTxt(errs.altMobErr)}
                </div>
                <div className="flex flex-col gap-[9px]">
                  <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Email</label>
                  <HrInput
                    type="email"
                    value={ec.email}
                    onChange={(e) => setEc(i, "email", e.target.value)}
                    placeholder="email@example.com"
                  />
                  {errTxt(errs.emailErr)}
                </div>
              </div>
            </div>
          );
        })}
        <AddRowBtn onClick={() => setEcs((p) => [...p, { name: "", relation: "", mobileCc: "+91", mobile: "", alt_mobile: "", email: "" }])} label="Add emergency contact" />
      </WizardBlock>

      {/* 03 · Nominees */}
      <WizardBlock title="03 · Nominees">
        <TipBox type="info">
          Nominees are used for PF, gratuity and group insurance. Ensure percentages add up to 100%.
        </TipBox>
        {nominees.map((nom, i) => {
          const nomNameTrim = nom.name.trim();
          const nomNameErr = nomNameTrim && !isValidPersonName(nomNameTrim) ? PERSON_NAME_ERR : null;
          const shareVal = nom.share.trim();
          const shareNum = Number(shareVal);
          const shareErr = shareVal && (!/^\d+$/.test(shareVal) || shareNum < 1 || shareNum > 100)
            ? "Nominee share cannot exceed 100%."
            : null;
          return (
            <div key={i} className="grid grid-cols-3 gap-6 items-start">
              <HrField label="Nominee Name" required>
                <HrInput
                  value={nom.name}
                  onChange={(e) => setNom(i, "name", e.target.value.replace(/[^a-zA-Z .'\-]/g, ""))}
                  placeholder="Full name"
                  maxLength={100}
                />
                {errTxt(nomNameErr)}
              </HrField>
              <HrField label="Relationship">
                <HrSelect value={nom.relation} onChange={(e) => setNom(i, "relation", e.target.value)}>
                  <option value="">Select...</option>
                  {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
                </HrSelect>
              </HrField>
              <div className="flex gap-2 items-end">
                <div className="flex flex-col gap-[9px] flex-1">
                  <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Share %</label>
                  <HrInput
                    value={nom.share}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, "");
                      if (raw === "" || Number(raw) <= 100) setNom(i, "share", raw);
                    }}
                    placeholder="e.g. 50"
                    maxLength={3}
                  />
                  {errTxt(shareErr)}
                </div>
                {nominees.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setNominees((p) => p.filter((_, idx) => idx !== i))}
                    className="h-[44px] w-[36px] flex items-center justify-center rounded-[11px] border border-[#fecaca] text-[#dc2626] hover:bg-[#fef2f2] shrink-0 mt-[22px]"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {totalShareErr && (
          <p className="text-[12px] text-[var(--red)] font-[600] flex items-center gap-1">
            <span>⚠</span> {totalShareErr} <span className="text-[#94a3b8] font-[400]">(Current total: {totalShare}%)</span>
          </p>
        )}
        <AddRowBtn onClick={() => setNominees((p) => [...p, { name: "", relation: "", share: "" }])} label="Add nominee" />
      </WizardBlock>
    </div>
  );
}

// --- Step 5: Government Identity ---
type IfscLookupStatus = "idle" | "loading" | "found" | "error";
type IfscApiResponse = { BANK?: string; BRANCH?: string; CENTRE?: string; DISTRICT?: string; STATE?: string };

function StepGovId({ f, set, showErrors, apiFieldErrors }: { f: FormData; set: (k: string, v: string) => void; showErrors: boolean; apiFieldErrors?: Record<string, string> }) {
  const errTxt = (msg: string | null) =>
    msg ? <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">{msg}</p> : null;

  // ── IFSC lookup state ─────────────────────────────────────────────────────
  const [ifscStatus, setIfscStatus] = useState<IfscLookupStatus>("idle");
  const [ifscLookupErr, setIfscLookupErr] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

  const clearBankLookup = () => {
    set("bank_name", ""); set("bank_branch", ""); set("bank_city", ""); set("bank_state", "");
    setIfscStatus("idle"); setIfscLookupErr(null);
  };

  const handleIfscChange = (raw: string) => {
    const v = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 11);
    set("ifsc_code", v);
    // Reset auto-populated fields when IFSC changes
    if (ifscStatus === "found") {
      set("bank_name", ""); set("bank_branch", ""); set("bank_city", ""); set("bank_state", "");
    }
    setIfscStatus("idle"); setIfscLookupErr(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (IFSC_RE.test(v)) {
      debounceRef.current = setTimeout(async () => {
        setIfscStatus("loading");
        try {
          const res = await fetch(`https://ifsc.razorpay.com/${v}`);
          if (!res.ok) throw new Error("not_found");
          const data: IfscApiResponse = await res.json();
          set("bank_name",   data.BANK   ?? "");
          set("bank_branch", data.BRANCH ?? "");
          set("bank_city",   data.CENTRE || data.DISTRICT || "");
          set("bank_state",  data.STATE  ?? "");
          setIfscStatus("found"); setIfscLookupErr(null);
        } catch {
          setIfscStatus("error");
          setIfscLookupErr("IFSC code not found or service unavailable. Please verify and try again.");
        }
      }, 700);
    }
  };

  const bankLocked = ifscStatus === "found";

  // ── Validation errors ────────────────────────────────────────────────────
  const IFSC_FMT_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  const ninRaw      = (f.nin             ?? "").trim();
  const panRaw      = (f.pan             ?? "").trim();
  const passportRaw = (f.passport_no     ?? "").trim();
  const dlRaw       = (f.driving_licence ?? "").trim();
  const uanRaw      = (f.uan             ?? "").trim();
  const esiRaw      = (f.esi_no          ?? "").trim();
  const ptRaw       = (f.pt_registration ?? "").trim();
  const accNoRaw    = (f.bank_account_no ?? "").trim();
  const ifscRaw     = (f.ifsc_code       ?? "").trim();

  const ninErr      = ninRaw      && !/^\d{12}$/.test(ninRaw)           ? "Please enter a valid 12-digit Aadhaar number." : null;
  const panErr      = panRaw      && !/^[A-Z]{5}\d{4}[A-Z]$/.test(panRaw) ? "Please enter a valid PAN number." : null;
  const passportErr = passportRaw && !/^[A-Z]\d{7}$/.test(passportRaw)  ? "Please enter a valid passport number." : null;
  const dlErr       = dlRaw       && !/^[A-Z0-9]{15,18}$/.test(dlRaw)   ? "Please enter a valid Driving Licence number." : null;
  const uanErr      = uanRaw      && !/^\d{12}$/.test(uanRaw)           ? "Please enter a valid 12-digit UAN number." : null;
  const esiErr      = esiRaw      && !/^\d{17}$/.test(esiRaw)           ? "Please enter a valid ESI number." : null;
  const ptErr       = ptRaw       && !/^[A-Z0-9]{8,20}$/i.test(ptRaw)  ? "Please enter a valid PT Registration number." : null;
  const accNoErr    = apiFieldErrors?.bank_account_no
    ? apiFieldErrors.bank_account_no
    : !accNoRaw && showErrors
      ? "Account Number is required."
      : accNoRaw && !/^\d{9,18}$/.test(accNoRaw) ? "Please enter a valid bank account number." : null;
  const ifscFmtErr  = ifscRaw     && !IFSC_FMT_RE.test(ifscRaw)        ? "Please enter a valid IFSC code." : null;

  // ── Auto-populated read-only field ────────────────────────────────────────
  const AutoField = ({ label, value, required }: { label: string; value: string; required?: boolean }) => (
    <div className="flex flex-col gap-[9px]">
      <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
        {label}{required && <span className="text-[var(--red)] ml-0.5">*</span>}
      </label>
      <div
        className={[
          "h-9 flex items-center px-3 rounded-[8px] border text-[13px] font-[500] transition-colors",
          bankLocked && value
            ? "bg-[#f0fdf4] border-[#bbf7d0] text-[#15803d]"
            : "bg-[#f8fafc] border-[var(--line)] text-[#b0b7c3]",
        ].join(" ")}
      >
        {value || <span className="text-[12px] italic">Auto-filled when IFSC is entered</span>}
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <TipBox type="warn">
        <strong>Documents verified by HR</strong> · Aadhaar, PAN &amp; bank details are mandatory for payroll processing and statutory compliance. Ensure information matches government records exactly.
      </TipBox>

      {/* 01 · Identity documents */}
      <WizardBlock title="01 · Identity documents">
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Aadhaar Number <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput value={f.nin ?? ""} onChange={(e) => set("nin", e.target.value.replace(/\D/g, "").slice(0, 12))} maxLength={12} placeholder="12-digit number" />
            {errTxt(ninErr)}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              PAN Number <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput value={f.pan ?? ""} onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10); set("pan", v); }} maxLength={10} placeholder="e.g. ABCDE1234F" />
            {errTxt(panErr)}
          </div>
        </div>
        <FHG hints={["12-digit Aadhaar. Masked after save.", "Required for TDS (Section 192)"]} />
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Passport Number</label>
            <HrInput value={f.passport_no ?? ""} onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); set("passport_no", v); }} maxLength={8} placeholder="e.g. A1234567" />
            {errTxt(passportErr)}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Driving Licence</label>
            <HrInput value={f.driving_licence ?? ""} onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 18); set("driving_licence", v); }} maxLength={18} placeholder="e.g. TS0120190001234" />
            {errTxt(dlErr)}
          </div>
        </div>
        <FHG hints={["Format: 1 letter + 7 digits (A1234567)", "Format: State code + RTO + year + serial (15–18 chars)"]} />
      </WizardBlock>

      {/* 02 · Statutory IDs */}
      <WizardBlock title="02 · Statutory IDs">
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">UAN (PF)</label>
            <HrInput value={f.uan ?? ""} onChange={(e) => set("uan", e.target.value.replace(/\D/g, "").slice(0, 12))} maxLength={12} placeholder="12-digit UAN" />
            {errTxt(uanErr)}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">ESI Number</label>
            <HrInput value={f.esi_no ?? ""} onChange={(e) => set("esi_no", e.target.value.replace(/\D/g, "").slice(0, 17))} maxLength={17} placeholder="17-digit ESI number" />
            {errTxt(esiErr)}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">PT Registration</label>
            <HrInput value={f.pt_registration ?? ""} onChange={(e) => { const v = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20); set("pt_registration", v); }} maxLength={20} placeholder="State PT no." />
            {errTxt(ptErr)}
          </div>
        </div>
        <FHG hints={["Universal Account Number · EPFO · 12 digits", "If gross salary ≤ ₹21,000/month · 17 digits", "Professional Tax · State-specific · 8–20 chars"]} />
      </WizardBlock>

      {/* 03 · Bank details */}
      <WizardBlock title="03 · Bank details">
        {/* Row A — IFSC (triggers lookup) + Account Number */}
        <div className="grid grid-cols-2 gap-6">
          {/* IFSC */}
          <div className="flex flex-col gap-[9px]">
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
                IFSC Code <span className="text-[var(--red)]">*</span>
              </label>
              {bankLocked && (
                <button type="button" onClick={clearBankLookup} className="text-[10px] text-[var(--brand)] font-[700] hover:underline leading-none">
                  Clear &amp; re-enter
                </button>
              )}
            </div>
            <div className="relative">
              <HrInput
                value={f.ifsc_code ?? ""}
                onChange={(e) => handleIfscChange(e.target.value)}
                maxLength={11}
                placeholder="e.g. SBIN0001234"
                className="pr-8"
              />
              {ifscStatus === "loading" && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <span className="block animate-spin h-[15px] w-[15px] rounded-full border-2 border-[var(--brand)] border-t-transparent" />
                </span>
              )}
              {ifscStatus === "found" && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#16a34a] font-[700] text-[14px]">✓</span>
              )}
              {ifscStatus === "error" && (
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--red)] font-[700] text-[14px]">✕</span>
              )}
            </div>
            {errTxt(ifscFmtErr ?? ifscLookupErr)}
            {ifscStatus === "loading" && <p className="text-[11px] text-[var(--muted)]">Looking up bank details...</p>}
            {bankLocked && <p className="text-[11px] text-[#16a34a] font-[600]">✓ Bank details verified via IFSC lookup.</p>}
          </div>
          {/* Account Number */}
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Account Number <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput
              value={f.bank_account_no ?? ""}
              onChange={(e) => set("bank_account_no", e.target.value.replace(/\D/g, "").slice(0, 18))}
              maxLength={18}
              placeholder="9–18 digit account number"
            />
            {errTxt(accNoErr)}
          </div>
        </div>

        {/* Row B — Bank Name + Branch: auto-filled on a successful IFSC lookup,
            editable manually when the lookup hasn't succeeded (e.g. IFSC service
            unavailable) so a valid IFSC code isn't blocked by an unrelated outage. */}
        <div className="grid grid-cols-2 gap-6">
          {bankLocked ? (
            <AutoField label="Bank Name" value={f.bank_name ?? ""} required />
          ) : (
            <div className="flex flex-col gap-[9px]">
              <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
                Bank Name <span className="text-[var(--red)]">*</span>
              </label>
              <HrInput value={f.bank_name ?? ""} onChange={(e) => set("bank_name", e.target.value)} placeholder="Enter bank name" />
              {apiFieldErrors?.bank_name
                ? <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">{apiFieldErrors.bank_name}</p>
                : !((f.bank_name ?? "").trim()) && showErrors
                  ? <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">Bank Name is required.</p>
                  : ifscStatus === "error" && <p className="text-[11px] text-[var(--muted)]">IFSC lookup unavailable — enter bank details manually.</p>}
            </div>
          )}
          {bankLocked ? (
            <AutoField label="Branch" value={f.bank_branch ?? ""} />
          ) : (
            <div className="flex flex-col gap-[9px]">
              <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Branch</label>
              <HrInput value={f.bank_branch ?? ""} onChange={(e) => set("bank_branch", e.target.value)} placeholder="Enter branch name" />
            </div>
          )}
        </div>

        {/* Row C — Auto-populated: City + State */}
        <div className="grid grid-cols-2 gap-6">
          <AutoField label="City"  value={f.bank_city  ?? ""} />
          <AutoField label="State" value={f.bank_state ?? ""} />
        </div>

        {/* Row D — Account Holder Name */}
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Account Holder Name <span className="text-[var(--red)]">*</span>
            </label>
            <HrInput
              value={f.bank_account_name ?? ""}
              onChange={(e) => set("bank_account_name", e.target.value.replace(/[^A-Za-z\s'\-]/g, ""))}
              placeholder="Name as printed on cheque / passbook"
              maxLength={50}
            />
            {(() => {
              const v = (f.bank_account_name ?? "").trim();
              if (apiFieldErrors?.bank_account_name) return <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">{apiFieldErrors.bank_account_name}</p>;
              if (!v && showErrors) return <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">Account Holder Name is required.</p>;
              return v && !isValidBankAccountName(v)
                ? <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">{BANK_ACCOUNT_NAME_ERR}</p>
                : null;
            })()}
          </div>
        </div>

        <FHG hints={[
          "Enter IFSC to auto-fill bank & branch details · Supports all Indian banks",
          "Digits only · 9–18 characters · Masked after save",
          null,
          null,
          null,
          null,
          "Must match the name on the bank account",
        ]} />
      </WizardBlock>
    </div>
  );
}

// --- Step 6: Qualifications ---
function StepQualifications({ f, set, validatorRef }: { f: FormData; set: (k: string, v: string) => void; validatorRef?: React.MutableRefObject<() => string | null> }) {
  type Qual = { degree: string; university: string; year: string; spec: string; pct: string };
  type Prev = { employer: string; designation: string; experience: string; from: string; to: string; salary: string };
  const [quals, setQuals] = useState<Qual[]>(() => {
    try { if ((f as any).qualifications) return typeof (f as any).qualifications === 'string' ? JSON.parse((f as any).qualifications) : (f as any).qualifications; } catch(e){}
    return [{ degree: "", university: "", year: "", spec: "", pct: "" }];
  });
  const [prevs, setPrevs] = useState<Prev[]>(() => {
    try { if ((f as any).previous_employment) return typeof (f as any).previous_employment === 'string' ? JSON.parse((f as any).previous_employment) : (f as any).previous_employment; } catch(e){}
    return [{ employer: "", designation: "", experience: "", from: "", to: "", salary: "" }];
  });

  useEffect(() => { set("qualifications", JSON.stringify(quals)); }, [quals]);
  useEffect(() => { set("previous_employment", JSON.stringify(prevs)); }, [prevs]);

  const setQ = (i: number, k: keyof Qual, v: string) => setQuals((p) => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));
  const setP = (i: number, k: keyof Prev, v: string) => setPrevs((p) => p.map((r, idx) => idx === i ? { ...r, [k]: v } : r));

  const errTxt = (msg: string | null) =>
    msg ? <p className="mt-1 text-[11px] text-[var(--red)] font-[500]">{msg}</p> : null;

  const THIS_YEAR = new Date().getFullYear();

  // ── Per-row validators ────────────────────────────────────────────────────
  function uniErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 2 || t.length > 100) return "University / Board must be 2–100 characters.";
    if (!/^[A-Za-z\s.&'-]+$/.test(t)) return "Use letters, spaces, dots, & or hyphens only.";
    if (/^[^A-Za-z]+$/.test(t)) return "Must contain at least one letter.";
    if (/(.)\1{2,}/i.test(t)) return "University / Board contains repeated characters.";
    return null;
  }
  function yearErr(v: string): string | null {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!/^\d{4}$/.test(v.trim()) || n < 1950 || n > THIS_YEAR + 1) return "Please enter a valid year.";
    return null;
  }
  function specErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 2 || t.length > 50) return "Specialisation must be 2–50 characters.";
    if (!/^[A-Za-z\s]+$/.test(t)) return "Letters and spaces only.";
    if (/(.)\1{2,}/i.test(t)) return "Specialisation contains repeated characters.";
    return null;
  }
  function pctErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length > 5) return "Please enter a valid Percentage or CGPA.";
    const n = parseFloat(t);
    if (isNaN(n) || !/^\d+(\.\d+)?$/.test(t)) return "Please enter a valid Percentage or CGPA.";
    if (n < 0 || n > 100) return "Please enter a valid Percentage or CGPA.";
    return null;
  }
  function employerErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 2 || t.length > 100) return "Employer name must be 2\u2013100 characters.";
    if (!/^[A-Za-z\s.&'\-]+$/.test(t)) return "Employer name can only contain letters, spaces, dots, & or hyphens.";
    if (!/[A-Za-z]/.test(t)) return "Enter a valid employer name.";
    if (/(.)\1{2,}/i.test(t)) return "Enter a valid employer name.";
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(t)) return "Enter a valid employer name.";
    if (/(..)\1{2,}/i.test(t)) return "Enter a valid employer name.";
    return null;
  }
  function desigErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 2 || t.length > 80) return "Designation must be 2\u201380 characters.";
    if (!/^[A-Za-z\s.&\-]+$/.test(t)) return "Enter a valid designation.";
    if (!/[A-Za-z]/.test(t)) return "Enter a valid designation.";
    if (/(.)\1{2,}/i.test(t)) return "Enter a valid designation.";
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(t)) return "Enter a valid designation.";
    if (/(..)\1{2,}/i.test(t)) return "Enter a valid designation.";
    return null;
  }
  function expErr(v: string): string | null {
    if (!v.trim()) return null;
    const n = parseFloat(v);
    if (isNaN(n) || !/^\d+(\.\d)?$/.test(v.trim())) return "Enter a number (e.g. 1 or 1.5).";
    if (n < 0 || n > 50) return "Experience must be between 0 and 50 years.";
    return null;
  }
  function salaryErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Enter a valid salary amount.";
    const intPart = t.split(".")[0];
    if (intPart.length > 8) return "Salary exceeds the maximum allowed value.";
    const n = parseFloat(t);
    if (n < 1) return "Enter a valid salary amount.";
    if (n > 9999999) return "Salary exceeds the maximum allowed value.";
    if (/^(\d)\1+(\.\1+)?$/.test(t)) return "Salary cannot contain repeated digits only.";
    return null;
  }
  const todayIso = new Date().toISOString().split("T")[0];
  const dob18Min = f.date_of_birth
    ? (() => { const d = new Date(f.date_of_birth!); d.setFullYear(d.getFullYear() + 18); return d.toISOString().split("T")[0]; })()
    : "";

  function fromDateErr(from: string, employer: string): string | null {
    if (!from && employer.trim()) return "From Date is required when Previous Employer is entered.";
    if (!from) return null;
    if (from > todayIso) return "From Date cannot be a future date.";
    if (dob18Min && from < dob18Min) return "Employment start date is not valid based on employee age.";
    if (f.joining_date && from >= f.joining_date) return "Previous employment start date must be before Joining Date.";
    return null;
  }
  function toDateErr(from: string, to: string, employer: string): string | null {
    if (!to && employer.trim()) return "To Date is required when Previous Employer is entered.";
    if (!to) return null;
    if (to > todayIso) return "To Date cannot be a future date.";
    if (from && to < from) return "To Date must be greater than or equal to From Date.";
    if (f.joining_date && to >= f.joining_date) return "Previous employment end date must be before Joining Date.";
    return null;
  }

  // Register validator so parent goNext can check date errors on step 6
  useEffect(() => {
    if (!validatorRef) return;
    validatorRef.current = () => {
      for (const pe of prevs) {
        const fe = fromDateErr(pe.from, pe.employer);
        if (fe) return fe;
        const te = toDateErr(pe.from, pe.to, pe.employer);
        if (te) return te;
      }
      return null;
    };
  });

  function subjQualErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 2 || t.length > 100) return "Subjects must be 2–100 characters.";
    if (!/^[A-Za-z,\s]+$/.test(t)) return "Use letters, commas, and spaces only.";
    if (/(.)\1{2,}/i.test(t)) return "Contains repeated characters.";
    return null;
  }
  function bedErr(v: string): string | null {
    const t = v.trim().toUpperCase();
    if (!t) return null;
    if (t.length < 5 || t.length > 30) return "B.Ed Registration No. must be 5–30 characters.";
    if (!/^[A-Z0-9/\-]{5,30}$/.test(t)) return "Enter a valid B.Ed Registration Number.";
    if (!/[A-Z]/.test(t)) return "Enter a valid B.Ed Registration Number.";
    if (/^(.)\1+$/.test(t)) return "Enter a valid B.Ed Registration Number.";
    return null;
  }
  function ctetErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length > 7) return "Please enter a valid CTET / STET score.";
    if (!/^\d{1,3}(\/\d{1,3})?$/.test(t)) return "Please enter a valid CTET / STET score (e.g. 115 or 115/150).";
    return null;
  }

  return (
    <div className="flex flex-col gap-8">

      {/* 01 · Academic qualifications */}
      <WizardBlock
        title="01 · Academic qualifications"
        right={<AddRowBtn onClick={() => setQuals((p) => [...p, { degree: "", university: "", year: "", spec: "", pct: "" }])} label="Add qualification" />}
      >
        {quals.map((q, i) => (
          <div key={i} className="flex flex-col gap-5 pb-5 border-b border-[#F1F5F9] last:border-0 last:pb-0">
            <div className="grid grid-cols-3 gap-6">
              <HrField label="Degree / Qualification" required>
                <HrSelect value={q.degree} onChange={(e) => setQ(i, "degree", e.target.value)}>
                  <option value="">Select...</option>
                  {DEGREES.map((d) => <option key={d}>{d}</option>)}
                </HrSelect>
              </HrField>
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">University / Board</label>
                <HrInput
                  value={q.university}
                  onChange={(e) => setQ(i, "university", e.target.value.slice(0, 100))}
                  placeholder="University or board name"
                  maxLength={100}
                />
                {errTxt(uniErr(q.university))}
              </div>
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Year of Passing</label>
                <HrInput
                  value={q.year}
                  onChange={(e) => setQ(i, "year", e.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder={`e.g. ${THIS_YEAR - 2}`}
                  maxLength={4}
                />
                {errTxt(yearErr(q.year))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-6">
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Specialisation / Subject</label>
                <HrInput
                  value={q.spec}
                  onChange={(e) => setQ(i, "spec", e.target.value.replace(/[^A-Za-z\s]/g, "").slice(0, 50))}
                  placeholder="e.g. Mathematics"
                  maxLength={50}
                />
                {errTxt(specErr(q.spec))}
              </div>
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Percentage / CGPA</label>
                <HrInput
                  value={q.pct}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, "");
                    if ((v.match(/\./g) || []).length > 1) return;
                    const sliced = v.slice(0, 5);
                    const num = parseFloat(sliced);
                    if (!isNaN(num) && num > 100) return;
                    setQ(i, "pct", sliced);
                  }}
                  placeholder="e.g. 78% or 8.5 CGPA"
                  maxLength={5}
                />
                {errTxt(pctErr(q.pct))}
              </div>
            </div>
          </div>
        ))}
      </WizardBlock>

      {/* 02 · Teaching certifications */}
      <WizardBlock title="02 · Teaching certifications">
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">B.Ed Registration No.</label>
            <HrInput
              value={f.bed_reg_no ?? ""}
              onChange={(e) => {
                const v = e.target.value.toUpperCase().replace(/[^A-Z0-9/\-]/g, "").slice(0, 30);
                set("bed_reg_no", v);
              }}
              placeholder="Registration number"
              maxLength={30}
            />
            {errTxt(bedErr(f.bed_reg_no ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">CTET / STET Score</label>
            <HrInput
              value={f.ctet_score ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9/]/g, "").slice(0, 7);
                set("ctet_score", v);
              }}
              placeholder="e.g. 115 / 150"
              maxLength={7}
            />
            {errTxt(ctetErr(f.ctet_score ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Subjects Qualified</label>
            <HrInput
              value={f.subjects_qualified ?? ""}
              onChange={(e) => set("subjects_qualified", e.target.value.replace(/[^A-Za-z,\s]/g, "").slice(0, 100))}
              placeholder="e.g. Maths, Science"
              maxLength={100}
            />
            {errTxt(subjQualErr(f.subjects_qualified ?? ""))}
          </div>
        </div>
      </WizardBlock>

      {/* 03 · Previous employment */}
      <WizardBlock
        title="03 · Previous employment"
        right={<AddRowBtn onClick={() => setPrevs((p) => [...p, { employer: "", designation: "", experience: "", from: "", to: "", salary: "" }])} label="Add employer" />}
      >
        {prevs.map((pe, i) => (
          <div key={i} className="flex flex-col gap-5 pb-5 border-b border-[#F1F5F9] last:border-0 last:pb-0">
            <div className="grid grid-cols-3 gap-6">
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Previous Employer</label>
                <HrInput
                  value={pe.employer}
                  onChange={(e) => setP(i, "employer", e.target.value.slice(0, 100))}
                  placeholder="School / Organisation"
                  maxLength={100}
                />
                {errTxt(employerErr(pe.employer))}
              </div>
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Designation Held</label>
                <HrInput
                  value={pe.designation}
                  onChange={(e) => setP(i, "designation", e.target.value.replace(/[^A-Za-z\s.&\-]/g, "").slice(0, 80))}
                  placeholder="e.g. Senior Teacher"
                  maxLength={80}
                />
                {errTxt(desigErr(pe.designation))}
              </div>
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Total Experience (yrs)</label>
                <HrInput
                  value={pe.experience}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, "");
                    if ((v.match(/\./g) || []).length <= 1) setP(i, "experience", v.slice(0, 4));
                  }}
                  placeholder="e.g. 3"
                  maxLength={4}
                />
                {errTxt(expErr(pe.experience))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-6">
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">From Date</label>
                <HrInput type="date" value={pe.from} onChange={(e) => setP(i, "from", e.target.value)} max={todayIso} />
                {errTxt(fromDateErr(pe.from, pe.employer))}
              </div>
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">To Date</label>
                <HrInput type="date" value={pe.to} onChange={(e) => setP(i, "to", e.target.value)} max={todayIso} />
                {errTxt(toDateErr(pe.from, pe.to, pe.employer))}
              </div>
              <div className="flex flex-col gap-[9px]">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Last Drawn Salary</label>
                <HrInput
                  value={pe.salary}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9.]/g, "");
                    const parts = v.split(".");
                    if (parts.length > 2) return;
                    if (parts[0].length > 8) return;
                    if (parts[1] !== undefined && parts[1].length > 2) return;
                    setP(i, "salary", v);
                  }}
                  placeholder="Monthly gross"
                />
                {errTxt(salaryErr(pe.salary))}
              </div>
            </div>
          </div>
        ))}
      </WizardBlock>
    </div>
  );
}

// --- Step 7: Medical & Fitness ---
function StepMedical({
  f,
  set,
  validatorRef,
}: {
  f: FormData;
  set: (k: string, v: string) => void;
  validatorRef?: React.MutableRefObject<() => string | null>;
}) {
  const todayIso = new Date().toISOString().split("T")[0];
  const dob = f.date_of_birth ?? "";

  function addYears(isoDate: string, years: number): string {
    const d = new Date(isoDate);
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().split("T")[0];
  }
  const [medCertFile,     setMedCertFile]     = useState<File | null>(null);
  const [medCertFileErr,  setMedCertFileErr]  = useState<string>("");
  const [disabCertFile,   setDisabCertFile]   = useState<File | null>(null);
  const [disabCertFileErr,setDisabCertFileErr]= useState<string>("");
  const medCertFileRef  = useRef<HTMLInputElement>(null);
  const disabCertFileRef= useRef<HTMLInputElement>(null);

  const ALLOWED_FILE_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
  const ALLOWED_EXT_PATTERN = /\.(pdf|jpg|jpeg|png)$/i;
  const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
  const FILE_ERR = "Only PDF, JPG, JPEG, PNG files up to 5 MB are allowed.";

  function validateFile(file: File): string {
    if (!ALLOWED_FILE_TYPES.includes(file.type) && !ALLOWED_EXT_PATTERN.test(file.name))
      return FILE_ERR;
    if (file.size > MAX_FILE_BYTES) return FILE_ERR;
    return "";
  }

  function handleMedCertFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const err = validateFile(file);
    setMedCertFileErr(err);
    if (!err) setMedCertFile(file);
    e.target.value = "";
  }
  function handleDisabCertFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (!file) return;
    const err = validateFile(file);
    setDisabCertFileErr(err);
    if (!err) setDisabCertFile(file);
    e.target.value = "";
  }

  // ---- Validators ----
  const isAllSame = (v: string) => /^([A-Za-z0-9])\1+$/.test(v);

  function medCertNoErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 5 || t.length > 30) return "Enter a valid Medical Fitness Certificate Number.";
    if (!/^[A-Za-z0-9/\-]+$/.test(t)) return "Enter a valid Medical Fitness Certificate Number.";
    if (!/[A-Za-z]/.test(t)) return "Enter a valid Medical Fitness Certificate Number.";
    if (/(.)\1{2,}/i.test(t)) return "Enter a valid Medical Fitness Certificate Number.";
    if (isAllSame(t)) return "Enter a valid Medical Fitness Certificate Number.";
    return null;
  }

  function medExamDateErr(v: string): string | null {
    if (!v) return null;
    if (v > todayIso) return "Medical examination date cannot be in the future.";
    if (dob) {
      if (v < dob) return "Medical examination date cannot be before date of birth.";
      const eighteenth = addYears(dob, 18);
      if (v < eighteenth) return "Medical examination date must be after the employee's 18th birthday.";
    }
    return null;
  }

  function certValidTillErr(examDate: string, till: string): string | null {
    if (!till) return null;
    if (examDate && till <= examDate) return "Certificate validity date must be after the medical examination date.";
    return null;
  }

  function dlMedDateErr(v: string, examDate: string): string | null {
    if (!v) return null;
    if (v > todayIso) return "Last DL Medical Exam date is invalid.";
    if (dob && v < dob) return "Last DL Medical Exam date is invalid.";
    if (examDate && v < examDate) return "Last DL Medical Exam date is invalid.";
    return null;
  }

  function disabilityCertErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 5 || t.length > 30) return "Enter a valid Disability Certificate Number.";
    if (!/^[A-Za-z0-9/\-]+$/.test(t)) return "Enter a valid Disability Certificate Number.";
    if (!/[A-Za-z]/.test(t)) return "Enter a valid Disability Certificate Number.";
    if (/(.)\1{2,}/i.test(t)) return "Enter a valid Disability Certificate Number.";
    if (isAllSame(t)) return "Enter a valid Disability Certificate Number.";
    return null;
  }

  function disabilityPctErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (!/^\d{1,3}$/.test(t)) return "Disability percentage must be between 1 and 100.";
    const n = parseInt(t, 10);
    if (n < 1 || n > 100) return "Disability percentage must be between 1 and 100.";
    return null;
  }

  function issuedByErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 2 || t.length > 100) return "Enter a valid issuing authority.";
    if (!/^[A-Za-z\s.'&\-]+$/.test(t)) return "Enter a valid issuing authority.";
    if (!/[A-Za-z]/.test(t)) return "Enter a valid issuing authority.";
    if (/(.)\1{2,}/i.test(t)) return "Enter a valid issuing authority.";
    if (/[bcdfghjklmnpqrstvwxyz]{5,}/i.test(t)) return "Enter a valid issuing authority.";
    if (/(..)\1{2,}/i.test(t)) return "Enter a valid issuing authority.";
    return null;
  }

  function accommodationsErr(v: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (t.length < 2 || t.length > 250) return "Enter valid accommodation details.";
    if (!/^[A-Za-z\s,.\-]+$/.test(t)) return "Enter valid accommodation details.";
    if (!/[A-Za-z]/.test(t)) return "Enter valid accommodation details.";
    if (/(.)\1{2,}/i.test(t)) return "Enter valid accommodation details.";
    if (/(..)\1{2,}/i.test(t)) return "Enter valid accommodation details.";
    return null;
  }

  function eyeExamErr(v: string): string | null {
    if (!v) return null;
    if (v !== "Pass" && v !== "Fail") return "Select Pass or Fail.";
    return null;
  }

  // Cross-field: disability required fields
  const isDisabled = f.disability_status && f.disability_status !== "None" && f.disability_status !== "";
  function crossFieldErr(): string | null {
    if (isDisabled) {
      if (!(f.disability_cert_no ?? "").trim()) return "Disability Certificate Number is required when disability status is set.";
      if (!(f.disability_pct ?? "").trim()) return "Disability Percentage is required when disability status is set.";
      if (!(f.disability_authority ?? "").trim()) return "Issuing Authority is required when disability status is set.";
      if (!disabCertFile) return "Disability Certificate upload is required when disability status is set.";
    }
    return null;
  }

  // Register validator for goNext gate
  useEffect(() => {
    if (!validatorRef) return;
    validatorRef.current = () => {
      const errs = [
        medCertNoErr(f.med_cert_no ?? ""),
        medExamDateErr(f.med_exam_date ?? ""),
        certValidTillErr(f.med_exam_date ?? "", f.cert_valid_till ?? ""),
        dlMedDateErr(f.dl_medical_exam ?? "", f.med_exam_date ?? ""),
        disabilityCertErr(f.disability_cert_no ?? ""),
        disabilityPctErr(f.disability_pct ?? ""),
        issuedByErr(f.disability_authority ?? ""),
        accommodationsErr(f.workplace_accommodations ?? ""),
        eyeExamErr(f.eye_exam_result ?? ""),
        medCertFileErr || null,
        disabCertFileErr || null,
        crossFieldErr(),
      ].find(Boolean);
      return errs ?? null;
    };
  });

  const errTxt = (msg: string | null) =>
    msg ? <p className="text-[11px] text-[#ef4444] mt-1">{msg}</p> : null;

  return (
    <div className="flex flex-col gap-8">

      {/* hidden file inputs */}
      <input ref={medCertFileRef}   type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleMedCertFile} />
      <input ref={disabCertFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleDisabCertFile} />

      {/* 01 · Medical fitness */}
      <WizardBlock title="01 · Medical fitness">
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Medical Fitness Certificate No.</label>
            <HrInput
              value={f.med_cert_no ?? ""}
              onChange={(e) => set("med_cert_no", e.target.value.toUpperCase().replace(/[^A-Za-z0-9/\-]/g, "").slice(0, 30))}
              placeholder="Certificate no."
            />
            {errTxt(medCertNoErr(f.med_cert_no ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Date of Medical Exam</label>
            <HrInput type="date" value={f.med_exam_date ?? ""} onChange={(e) => set("med_exam_date", e.target.value)} max={todayIso} />
            {errTxt(medExamDateErr(f.med_exam_date ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Certificate Valid Till</label>
            <HrInput type="date" value={f.cert_valid_till ?? ""} onChange={(e) => set("cert_valid_till", e.target.value)} min={f.med_exam_date ?? undefined} />
            {errTxt(certValidTillErr(f.med_exam_date ?? "", f.cert_valid_till ?? ""))}
            {f.cert_valid_till && !certValidTillErr(f.med_exam_date ?? "", f.cert_valid_till) && f.cert_valid_till < todayIso && (
              <p className="text-[11px] text-[#f59e0b] mt-1">&#9888; Certificate has expired.</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 mt-1">
          <button
            type="button"
            onClick={() => medCertFileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[#E2E8F0] text-[12.5px] font-[600] text-[#475569] bg-white hover:bg-[#f8fafc]"
          >
            <Upload size={13} /> Upload PDF / JPG
          </button>
          {medCertFile ? (
            <span className="flex items-center gap-1 text-[11.5px] text-[#15803d] font-[600]">
              {medCertFile.name}
              <button type="button" onClick={() => setMedCertFile(null)} className="ml-1 text-[#94A3B8] hover:text-[#ef4444]"><X size={11} /></button>
            </span>
          ) : (
            <span className="text-[11px] text-[#94A3B8]">No file chosen</span>
          )}
        </div>
        {medCertFileErr && <p className="text-[11px] text-[#ef4444] mt-0.5">{medCertFileErr}</p>}
      </WizardBlock>

      {/* 02 · Accessibility & special needs */}
      <WizardBlock title="02 · Accessibility &amp; special needs">
        <TipBox type="info">
          This information is confidential and used only for providing appropriate workplace support. It does not affect employment status.
        </TipBox>
        <div className="grid grid-cols-2 gap-6">
          <HrField label="Accessibility / Disability Status">
            <HrSelect value={f.disability_status ?? ""} onChange={(e) => set("disability_status", e.target.value)}>
              <option value="">Select...</option>
              {DISABILITY_STATUSES.map((d) => <option key={d}>{d}</option>)}
            </HrSelect>
          </HrField>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Disability Certificate No.{isDisabled ? " *" : ""}
            </label>
            <HrInput
              value={f.disability_cert_no ?? ""}
              onChange={(e) => set("disability_cert_no", e.target.value.toUpperCase().replace(/[^A-Za-z0-9/\-]/g, "").slice(0, 30))}
              placeholder="Certificate number"
            />
            {errTxt(disabilityCertErr(f.disability_cert_no ?? ""))}
            {isDisabled && !(f.disability_cert_no ?? "").trim() && <p className="text-[11px] text-[#ef4444] mt-1">Required when disability status is set.</p>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Disability Percentage (%) {isDisabled ? "*" : ""}
            </label>
            <HrInput
              value={f.disability_pct ?? ""}
              onChange={(e) => {
                const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
                set("disability_pct", v);
              }}
              placeholder="e.g. 40"
              maxLength={3}
            />
            {errTxt(disabilityPctErr(f.disability_pct ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Issued by (Authority) {isDisabled ? "*" : ""}
            </label>
            <HrInput
              value={f.disability_authority ?? ""}
              onChange={(e) => set("disability_authority", e.target.value.replace(/[^A-Za-z\s.'&\-]/g, "").slice(0, 100))}
              placeholder="Issuing authority"
            />
            {errTxt(issuedByErr(f.disability_authority ?? ""))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => disabCertFileRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 rounded-[10px] border border-[#E2E8F0] text-[12.5px] font-[600] text-[#475569] bg-white hover:bg-[#f8fafc]"
          >
            <Upload size={13} /> Upload disability certificate {isDisabled ? "*" : ""}
          </button>
          {disabCertFile ? (
            <span className="flex items-center gap-1 text-[11.5px] text-[#15803d] font-[600]">
              {disabCertFile.name}
              <button type="button" onClick={() => setDisabCertFile(null)} className="ml-1 text-[#94A3B8] hover:text-[#ef4444]"><X size={11} /></button>
            </span>
          ) : (
            <span className="text-[11px] text-[#94A3B8]">No file chosen</span>
          )}
        </div>
        {disabCertFileErr && <p className="text-[11px] text-[#ef4444] mt-0.5">{disabCertFileErr}</p>}
        <div className="flex flex-col gap-[9px]">
          <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Workplace Accommodations Required</label>
          <HrInput
            value={f.workplace_accommodations ?? ""}
            onChange={(e) => set("workplace_accommodations", e.target.value.replace(/[^A-Za-z\s,.\-]/g, "").slice(0, 250))}
            placeholder="Describe any accommodations needed..."
          />
          {errTxt(accommodationsErr(f.workplace_accommodations ?? ""))}
        </div>
      </WizardBlock>

      {/* 03 · Transport staff — additional */}
      <WizardBlock title="03 · Transport staff — additional">
        <TipBox type="info">
          Applicable if role is Driver / Transport Staff. Leave blank for other staff.
        </TipBox>
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Eye Exam Result</label>
            <HrSelect value={f.eye_exam_result ?? ""} onChange={(e) => set("eye_exam_result", e.target.value)}>
              <option value="">Select...</option>
              <option value="Pass">Pass</option>
              <option value="Fail">Fail</option>
            </HrSelect>
            {errTxt(eyeExamErr(f.eye_exam_result ?? ""))}
          </div>
          <HrField label="Colour Blindness Test">
            <HrSelect value={f.colour_blindness ?? ""} onChange={(e) => set("colour_blindness", e.target.value)}>
              <option value="">Select...</option>
              <option>Normal</option>
              <option>Mild</option>
              <option>Moderate</option>
              <option>Severe</option>
            </HrSelect>
          </HrField>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Last DL Medical Exam</label>
            <HrInput type="date" value={f.dl_medical_exam ?? ""} onChange={(e) => set("dl_medical_exam", e.target.value)} max={todayIso} />
            {errTxt(dlMedDateErr(f.dl_medical_exam ?? "", f.med_exam_date ?? ""))}
          </div>
        </div>
      </WizardBlock>
    </div>
  );
}

// --- Step 8: Payroll Setup ---
function StepPayroll({
  f,
  set,
  validatorRef,
}: {
  f: FormData;
  set: (k: string, v: string) => void;
  validatorRef?: React.MutableRefObject<() => string | null>;
}) {
  type CustomLine = { label: string; amount: string; labelErr: string; amountErr: string };
  const [customEarnings, setCustomEarnings] = useState<CustomLine[]>(() => {
    try { if ((f as any).custom_earnings) return typeof (f as any).custom_earnings === 'string' ? JSON.parse((f as any).custom_earnings) : (f as any).custom_earnings; } catch(e){}
    return [];
  });
  const [customDeductions, setCustomDeductions] = useState<CustomLine[]>(() => {
    try { if ((f as any).custom_deductions) return typeof (f as any).custom_deductions === 'string' ? JSON.parse((f as any).custom_deductions) : (f as any).custom_deductions; } catch(e){}
    return [];
  });

  useEffect(() => { set("custom_earnings", JSON.stringify(customEarnings)); }, [customEarnings]);
  useEffect(() => { set("custom_deductions", JSON.stringify(customDeductions)); }, [customDeductions]);

  // ── Salary amount constants / sanitizer ─────────────────────────────
  const MAX_PAY  = 999_999;                              // ₹9,99,999
  const AMT_RE   = /^\d{1,6}(\.\d{0,2})?$/;            // max 6 integer digits
  // Hard-cap on keystroke: strip non-numeric, keep first dot only,
  // cap integer part to 6 digits and decimal to 2 digits.
  const CLEAN_AMT = (v: string): string => {
    const clean = v.replace(/[^0-9.]/g, "").replace(/(\..*?)\./g, "$1");
    const [intPart, decPart] = clean.split(".");
    const intCapped = (intPart ?? "").slice(0, 6);
    return decPart !== undefined ? `${intCapped}.${decPart.slice(0, 2)}` : intCapped;
  };

  // ── Name regex ─────────────────────────────────────────────────────
  const NAME_RE  = /^[A-Za-z\s]+$/;
  const REPEAT_RE = /(.)\1{2,}/i;
  const ALTPAT_RE = /(..)\1{2,}/i;

  // ── Field validators ───────────────────────────────────────────────
  function basicSalaryErr(v: string): string | null {
    const t = v.trim();
    if (!t) return "Basic Salary is required.";
    if (/[^0-9.]/.test(t)) return "Basic Salary must contain numbers only.";
    if (!AMT_RE.test(t)) return `Basic Salary cannot exceed ₹9,99,999 per month.`;
    const n = parseFloat(t);
    if (n <= 0) return "Basic Salary must be greater than zero.";
    if (n > MAX_PAY) return `Basic Salary cannot exceed ₹9,99,999 per month.`;
    return null;
  }

  function optionalAmountErr(v: string, label: string): string | null {
    const t = v.trim();
    if (!t) return null;
    if (/[^0-9.]/.test(t)) return `${label} must contain numbers only.`;
    if (!AMT_RE.test(t)) return `${label} cannot exceed ₹9,99,999.`;
    const n = parseFloat(t);
    if (n < 0) return `${label} must be a valid numeric amount.`;
    if (n > MAX_PAY) return `${label} cannot exceed ₹9,99,999.`;
    return null;
  }

  // ── Cross-field salary-ratio validators ───────────────────────────
  // All return null when basic is 0/empty (ratio check is skipped until basic is entered).
  function hraErr(v: string): string | null {
    const base = optionalAmountErr(v, "HRA");
    if (base) return base;
    if (!basic || !v.trim()) return null;
    const limit = Math.round(basic * 0.50);  // Metro cap (generous)
    const n = parseFloat(v);
    if (n > limit)
      return `HRA cannot exceed 50% of Basic Salary (max ₹${limit.toLocaleString("en-IN")}).`;
    return null;
  }

  function daErr(v: string): string | null {
    const base = optionalAmountErr(v, "DA");
    if (base) return base;
    if (!basic || !v.trim()) return null;
    const limit = Math.round(basic * 0.50);
    const n = parseFloat(v);
    if (n > limit)
      return `DA cannot exceed 50% of Basic Salary (max ₹${limit.toLocaleString("en-IN")}).`;
    return null;
  }

  function taErr(v: string): string | null {
    const base = optionalAmountErr(v, "Travel Allowance");
    if (base) return base;
    if (!basic || !v.trim()) return null;
    const limit = Math.round(basic * 0.25);
    const n = parseFloat(v);
    if (n > limit)
      return `Travel Allowance cannot exceed 25% of Basic Salary (max ₹${limit.toLocaleString("en-IN")}).`;
    return null;
  }

  function medErr(v: string): string | null {
    const base = optionalAmountErr(v, "Medical Allowance");
    if (base) return base;
    if (!basic || !v.trim()) return null;
    const limit = Math.round(basic * 0.20);
    const n = parseFloat(v);
    if (n > limit)
      return `Medical Allowance cannot exceed 20% of Basic Salary (max ₹${limit.toLocaleString("en-IN")}).`;
    return null;
  }

  function specialErr(v: string): string | null {
    const base = optionalAmountErr(v, "Special Allowance");
    if (base) return base;
    if (!basic || !v.trim()) return null;
    const limit = Math.round(basic * 1.00);
    const n = parseFloat(v);
    if (n > limit)
      return `Special Allowance cannot exceed 100% of Basic Salary (max ₹${limit.toLocaleString("en-IN")}).`;
    return null;
  }

  function customNameErr(v: string, kind: "Allowance" | "Deduction"): string | null {
    const t = v.trim();
    if (!t) return `${kind} Name is required.`;
    if (t.length < 2 || t.length > 50)
      return `${kind} Name must be 2–50 characters.`;
    if (!NAME_RE.test(t))
      return `${kind} Name must contain alphabetic characters only.`;
    if (REPEAT_RE.test(t) || ALTPAT_RE.test(t))
      return `Please enter a valid ${kind.toLowerCase()} name.`;
    return null;
  }

  function customAmountErr(v: string, kind: "Allowance" | "Deduction"): string | null {
    const t = v.trim();
    if (!t) return `${kind} Amount is required.`;
    if (/[^0-9.]/.test(t)) return `${kind} Amount must contain numbers only.`;
    if (!AMT_RE.test(t)) return `${kind} Amount cannot exceed ₹9,99,999.`;
    const n = parseFloat(t);
    if (n <= 0) return `${kind} Amount must be greater than zero.`;
    if (n > MAX_PAY) return `${kind} Amount cannot exceed ₹9,99,999.`;
    return null;
  }

  const errTxt = (msg: string | null) =>
    msg ? <p className="text-[11px] text-[#ef4444] mt-1">{msg}</p> : null;

  // ── Register validator gate ────────────────────────────────────────
  useEffect(() => {
    if (!validatorRef) return;
    validatorRef.current = () => {
      const bErr = basicSalaryErr(f.basic_salary_input ?? "");
      if (bErr) return bErr;
      const ratioChecks: (() => string | null)[] = [
        () => hraErr(f.hra_input ?? ""),
        () => daErr(f.da_input ?? ""),
        () => taErr(f.travel_allowance_input ?? ""),
        () => medErr(f.medical_allowance_input ?? ""),
        () => specialErr(f.special_allowance_input ?? ""),
      ];
      for (const check of ratioChecks) {
        const e = check();
        if (e) return e;
      }
      for (const ce of customEarnings) {
        const ne = customNameErr(ce.label, "Allowance");
        if (ne) return ne;
        const ae = customAmountErr(ce.amount, "Allowance");
        if (ae) return ae;
      }
      for (const cd of customDeductions) {
        const ne = customNameErr(cd.label, "Deduction");
        if (ne) return ne;
        const ae = customAmountErr(cd.amount, "Deduction");
        if (ae) return ae;
      }
      return null;
    };
  });

  // ── Computed totals ────────────────────────────────────────────────
  const basic   = parseFloat(f.basic_salary_input || "0") || 0;
  const hra     = parseFloat(f.hra_input || "0") || 0;
  const da      = parseFloat(f.da_input || "0") || 0;
  const ta      = parseFloat(f.travel_allowance_input || "1600") || 0;
  const med     = parseFloat(f.medical_allowance_input || "1250") || 0;
  const special = parseFloat(f.special_allowance_input || "0") || 0;

  const gross = basic + hra + da + ta + med + special +
    customEarnings.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const pf       = Math.round(basic * 0.12);
  const esi      = gross <= 21000 ? Math.round(gross * 0.0075) : 0;
  const pt       = gross > 15000 ? 200 : 0;
  const tds      = 0;
  const totalDed = pf + esi + pt + tds +
    customDeductions.reduce((s, l) => s + (parseFloat(l.amount) || 0), 0);
  const netHome  = gross - totalDed;

  return (
    <div className="flex flex-col gap-8">

      {/* 01 · CTC structure */}
      <WizardBlock title="01 · CTC structure">
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Basic Salary / Month <span className="text-[#ef4444]">*</span></label>
            <HrInput
              value={f.basic_salary_input ?? ""}
              onChange={(e) => set("basic_salary_input", CLEAN_AMT(e.target.value).slice(0, 10))}
              placeholder="0.00"
              maxLength={10}
            />
            {errTxt(basicSalaryErr(f.basic_salary_input ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              HRA
              {basic > 0 && (
                <span className="ml-1 normal-case font-[500] text-[#94a3b8]">
                  (metro ₹{Math.round(basic * 0.50).toLocaleString("en-IN")} / non-metro ₹{Math.round(basic * 0.40).toLocaleString("en-IN")})
                </span>
              )}
            </label>
            <HrInput
              value={f.hra_input ?? ""}
              onChange={(e) => set("hra_input", CLEAN_AMT(e.target.value).slice(0, 10))}
              placeholder="0.00"
              maxLength={10}
            />
            {errTxt(hraErr(f.hra_input ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              DA
              {basic > 0 && (
                <span className="ml-1 normal-case font-[500] text-[#94a3b8]">(max ₹{Math.round(basic * 0.50).toLocaleString("en-IN")})</span>
              )}
            </label>
            <HrInput
              value={f.da_input ?? ""}
              onChange={(e) => set("da_input", CLEAN_AMT(e.target.value).slice(0, 10))}
              placeholder="0.00"
              maxLength={10}
            />
            {errTxt(daErr(f.da_input ?? ""))}
          </div>
        </div>
        <FHG hints={[null, "Metro = 50%, Non-metro = 40% of Basic", "Dearness Allowance"]} />
        <div className="grid grid-cols-3 gap-6">
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Travel Allowance
              {basic > 0 && (
                <span className="ml-1 normal-case font-[500] text-[#94a3b8]">(max ₹{Math.round(basic * 0.25).toLocaleString("en-IN")})</span>
              )}
            </label>
            <HrInput
              value={f.travel_allowance_input ?? "1600"}
              onChange={(e) => set("travel_allowance_input", CLEAN_AMT(e.target.value).slice(0, 10))}
              placeholder="1600"
              maxLength={10}
            />
            {errTxt(taErr(f.travel_allowance_input ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Medical Allowance
              {basic > 0 && (
                <span className="ml-1 normal-case font-[500] text-[#94a3b8]">(max ₹{Math.round(basic * 0.20).toLocaleString("en-IN")})</span>
              )}
            </label>
            <HrInput
              value={f.medical_allowance_input ?? "1250"}
              onChange={(e) => set("medical_allowance_input", CLEAN_AMT(e.target.value).slice(0, 10))}
              placeholder="1250"
              maxLength={10}
            />
            {errTxt(medErr(f.medical_allowance_input ?? ""))}
          </div>
          <div className="flex flex-col gap-[9px]">
            <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">
              Special Allowance
              {basic > 0 && (
                <span className="ml-1 normal-case font-[500] text-[#94a3b8]">(max ₹{Math.round(basic * 1.0).toLocaleString("en-IN")})</span>
              )}
            </label>
            <HrInput
              value={f.special_allowance_input ?? ""}
              onChange={(e) => set("special_allowance_input", CLEAN_AMT(e.target.value).slice(0, 10))}
              placeholder="0.00"
              maxLength={10}
            />
            {errTxt(specialErr(f.special_allowance_input ?? ""))}
          </div>
        </div>
      </WizardBlock>

      {/* 02 · Custom allowances */}
      <WizardBlock
        title="02 · Custom allowances"
        right={<AddRowBtn onClick={() => setCustomEarnings((p) => [...p, { label: "", amount: "", labelErr: "", amountErr: "" }])} label="Add allowance" />}
      >
        {customEarnings.length === 0 ? (
          <div className="text-[12.5px] text-[#94A3B8]">No custom allowances added. Click &quot;+ Add allowance&quot; to add one.</div>
        ) : (
          customEarnings.map((ce, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex flex-col gap-[9px] flex-1">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Allowance Name</label>
                <HrInput
                  value={ce.label}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^A-Za-z\s]/g, "").slice(0, 50);
                    setCustomEarnings((p) => p.map((r, idx) =>
                      idx === i ? { ...r, label: v, labelErr: customNameErr(v, "Allowance") ?? "" } : r
                    ));
                  }}
                  placeholder="e.g. Shift Allowance"
                />
                {ce.labelErr && <p className="text-[11px] text-[#ef4444] mt-1">{ce.labelErr}</p>}
              </div>
              <div className="flex flex-col gap-[9px]" style={{ width: 160 }}>
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Amount (₹ / month)</label>
                <HrInput
                  value={ce.amount}
                  onChange={(e) => {
                    const v = CLEAN_AMT(e.target.value).slice(0, 10);
                    setCustomEarnings((p) => p.map((r, idx) =>
                      idx === i ? { ...r, amount: v, amountErr: customAmountErr(v, "Allowance") ?? "" } : r
                    ));
                  }}
                  placeholder="0"
                  maxLength={10}
                />
                {ce.amountErr && <p className="text-[11px] text-[#ef4444] mt-1">{ce.amountErr}</p>}
              </div>
              <button
                type="button"
                onClick={() => setCustomEarnings((p) => p.filter((_, idx) => idx !== i))}
                className="h-[44px] w-[36px] flex items-center justify-center rounded-[11px] border border-[#fecaca] text-[#dc2626] hover:bg-[#fef2f2] shrink-0 mt-[28px]"
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </WizardBlock>

      {/* 03 · Custom deductions */}
      <WizardBlock
        title="03 · Custom deductions"
        right={<AddRowBtn onClick={() => setCustomDeductions((p) => [...p, { label: "", amount: "", labelErr: "", amountErr: "" }])} label="Add deduction" />}
      >
        {customDeductions.length === 0 ? (
          <div className="text-[12.5px] text-[#94A3B8]">No custom deductions added. Click &quot;+ Add deduction&quot; to add one.</div>
        ) : (
          customDeductions.map((cd, i) => (
            <div key={i} className="flex gap-3 items-start">
              <div className="flex flex-col gap-[9px] flex-1">
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Deduction Name</label>
                <HrInput
                  value={cd.label}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^A-Za-z\s]/g, "").slice(0, 50);
                    setCustomDeductions((p) => p.map((r, idx) =>
                      idx === i ? { ...r, label: v, labelErr: customNameErr(v, "Deduction") ?? "" } : r
                    ));
                  }}
                  placeholder="e.g. Loan EMI"
                />
                {cd.labelErr && <p className="text-[11px] text-[#ef4444] mt-1">{cd.labelErr}</p>}
              </div>
              <div className="flex flex-col gap-[9px]" style={{ width: 160 }}>
                <label className="text-[11px] uppercase tracking-[0.07em] text-[#64748b] font-[850]">Amount (₹ / month)</label>
                <HrInput
                  value={cd.amount}
                  onChange={(e) => {
                    const v = CLEAN_AMT(e.target.value).slice(0, 10);
                    setCustomDeductions((p) => p.map((r, idx) =>
                      idx === i ? { ...r, amount: v, amountErr: customAmountErr(v, "Deduction") ?? "" } : r
                    ));
                  }}
                  placeholder="0"
                  maxLength={10}
                />
                {cd.amountErr && <p className="text-[11px] text-[#ef4444] mt-1">{cd.amountErr}</p>}
              </div>
              <button
                type="button"
                onClick={() => setCustomDeductions((p) => p.filter((_, idx) => idx !== i))}
                className="h-[44px] w-[36px] flex items-center justify-center rounded-[11px] border border-[#fecaca] text-[#dc2626] hover:bg-[#fef2f2] shrink-0 mt-[28px]"
              >
                <X size={14} />
              </button>
            </div>
          ))
        )}
      </WizardBlock>

      {/* Live CTC Preview */}
      {(() => {
        const payrollInvalid = !!(basicSalaryErr(f.basic_salary_input ?? "") ||
          hraErr(f.hra_input ?? "") ||
          daErr(f.da_input ?? "") ||
          taErr(f.travel_allowance_input ?? "") ||
          medErr(f.medical_allowance_input ?? "") ||
          specialErr(f.special_allowance_input ?? "") ||
          customEarnings.some((ce) => customAmountErr(ce.amount, "Allowance") || customNameErr(ce.label, "Allowance")) ||
          customDeductions.some((cd) => customAmountErr(cd.amount, "Deduction") || customNameErr(cd.label, "Deduction")));
        if (payrollInvalid) return (
          <div className="rounded-[14px] p-[16px_24px] flex items-center gap-3" style={{ background: "#fef2f2", border: "1.5px solid #fecaca" }}>
            <span className="text-[#dc2626] text-[18px]">⚠️</span>
            <p className="text-[13px] font-[600] text-[#dc2626]">Please correct payroll validation errors to view CTC preview.</p>
          </div>
        );
        if (!basic) return null;
        return (
        <div className="rounded-[14px] p-[20px_24px]" style={{ background: "var(--soft)", border: "1.5px solid var(--brand)" }}>
          <div className="text-[14px] font-[700] mb-5" style={{ fontFamily: PF, color: "var(--brand)" }}>
            Live CTC Preview
          </div>
          <div className="grid grid-cols-2 gap-6">
            {/* Earnings */}
            <div>
              <div className="text-[10.5px] font-[800] uppercase tracking-[0.08em] text-[#64748B] mb-3">Earnings</div>
              <div className="flex flex-col gap-2">
                {[
                  ["Basic", basic],
                  ["HRA", hra],
                  ["DA", da],
                  ["Travel Allowance", ta],
                  ["Medical Allowance", med],
                  ["Special Allowance", special],
                  ...customEarnings.map((ce) => [ce.label || "Custom", parseFloat(ce.amount) || 0]),
                ].map(([label, amount], i) => (
                  <div key={i} className="flex justify-between text-[12.5px]">
                    <span className="text-[#64748B]">{label as string}</span>
                    <span className="font-[600]">{(amount as number).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between text-[12.5px] font-[800] border-t border-[#e2e8f0] pt-2 mt-1">
                  <span>Gross</span>
                  <span>{gross.toLocaleString()}</span>
                </div>
              </div>
            </div>
            {/* Deductions */}
            <div>
              <div className="text-[10.5px] font-[800] uppercase tracking-[0.08em] text-[#64748B] mb-3">Deductions</div>
              <div className="flex flex-col gap-2">
                {[
                  ["PF (12%)", pf],
                  ["ESI (0.75%)", esi],
                  ["PT", pt],
                  ["TDS", tds],
                  ...customDeductions.map((cd) => [cd.label || "Custom", parseFloat(cd.amount) || 0]),
                ].map(([label, amount], i) => (
                  <div key={i} className="flex justify-between text-[12.5px]">
                    <span className="text-[#64748B]">{label as string}</span>
                    <span className="font-[600]">{(amount as number).toLocaleString()}</span>
                  </div>
                ))}
                <div className="flex justify-between text-[12.5px] font-[800] border-t border-[#e2e8f0] pt-2 mt-1">
                  <span>Total Ded.</span>
                  <span>{totalDed.toLocaleString()}</span>
                </div>
              </div>
              {/* Net take home */}
              <div
                className="mt-4 rounded-[10px] px-4 py-3 text-white"
                style={{ background: "#15172A" }}
              >
                <div className="text-[10px] uppercase tracking-[0.08em] opacity-70">Net Take Home</div>
                <div className="text-[24px] font-[800] leading-tight mt-0.5">
                  ₹{netHome.toLocaleString()}
                </div>
                <div className="text-[11px] opacity-60">per month</div>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}

// --- Step 9: Documents ---
const ALL_DOCS = [
  { key: "signature",           label: "Signature (scanned image)",                    required: true  },
  { key: "aadhaar",             label: "Aadhaar Card (self-attested copy)",           required: true  },
  { key: "pan",                 label: "PAN Card",                                     required: false },
  { key: "passport_photo",      label: "Passport-size photographs (3 copies)",         required: false },
  { key: "bank_proof",          label: "Bank cancelled cheque or passbook copy",       required: false },
  { key: "address_proof",       label: "Address proof (Aadhaar / utility bill)",       required: false },
  { key: "marksheet_10",        label: "10th Marksheet and certificate",               required: false },
  { key: "marksheet_12",        label: "12th Marksheet and certificate",               required: false },
  { key: "degree",              label: "Degree / graduation certificate",              required: false },
  { key: "bed",                 label: "B.Ed / D.El.Ed certificate (teaching staff)", required: false },
  { key: "experience",          label: "Experience letter (previous employer)",        required: false },
  { key: "noc",                 label: "No-objection certificate (previous employer)", required: false },
  { key: "medical_cert",        label: "Medical fitness certificate",                  required: false },
  { key: "police_verification", label: "Police verification certificate",              required: false },
  { key: "signed_onboarding_form", label: "Signed Onboarding Acknowledgment",           required: false },
] as const;

const MANDATORY_DOC_KEYS = ALL_DOCS.filter((d) => d.required).map((d) => d.key);

// StaffDocument.document_type -> onboarding doc_key, for the few document types that
// predate the onboarding wizard and kept their original legacy names (backend mirror:
// StaffOnboardDocument.TO_STAFF_DOCUMENT_TYPE in apps/hr/models.py). Every other
// document_type value now matches its doc_key 1:1.
const STAFF_DOCUMENT_TYPE_TO_ONBOARD_KEY: Record<string, string> = {
  aadhar_card: "aadhaar",
  tenth_certificate: "marksheet_10",
  eleventh_certificate: "marksheet_12",
};

type OnboardDocRecord = { id: number; doc_key: string; file_name: string; status: string };

function StepDocuments({
  validatorRef,
  externalDocs,
  editingStaffId,
}: {
  validatorRef: React.MutableRefObject<() => string | null>;
  externalDocs?: StaffDocument[];
  editingStaffId?: number | null;
}) {
  const [uploads, setUploads] = useState<Record<string, OnboardDocRecord>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMime, setPreviewMime] = useState<string>("application/pdf");
  const { toast } = useHrToast();
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const externalDocMapRef = useRef<Record<string, StaffDocument>>({});
  // Guards against a slower, earlier "Preview" fetch (e.g. Aadhaar) resolving after a
  // newer action and overwriting the shared previewUrl/previewMime with stale content.
  const activePreviewKeyRef = useRef<string | null>(null);

  // Load existing uploads on mount — scoped to the staff being edited (or the
  // brand-new-hire pool when not editing) so a concurrently in-progress
  // onboarding/edit of a DIFFERENT staff member by the same HR user doesn't leak in.
  useEffect(() => {
    void (async () => {
      try {
        const qs = editingStaffId ? `?staff_id=${editingStaffId}` : "";
        const res = await apiRequestWithRefreshResponse(`/api/v1/hr/onboard/documents/${qs}`, { method: "GET", silent401: true });
        if (res.ok) {
          const json = (await res.json()) as { data: OnboardDocRecord[] };
          const map: Record<string, OnboardDocRecord> = {};
          for (const doc of json.data ?? []) map[doc.doc_key] = doc;
          setUploads(map);
        }
      } catch {
        // silently ignore — user will see pending state and can re-upload
      }
    })();
  }, [editingStaffId]);

  // Merge external staff documents (read-only) into uploads mapping
  useEffect(() => {
    if (!externalDocs || externalDocs.length === 0) return;
    // build lookup and merge into uploads without overwriting existing onboard uploads
    const lookup: Record<string, StaffDocument> = {};
    for (const d of externalDocs) {
      const rawKey = (d.doc_type || d.name || "").toString();
      if (!rawKey) continue;
      // StaffDocument.document_type predates a few onboarding doc_keys and still
      // uses its own legacy names for them (e.g. "aadhar_card" vs "aadhaar") —
      // translate those back so already-uploaded staff documents are recognized.
      const key = STAFF_DOCUMENT_TYPE_TO_ONBOARD_KEY[rawKey] ?? rawKey;
      lookup[key] = d;
    }
    externalDocMapRef.current = lookup;
    setUploads((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(lookup)) {
        if (!next[k]) {
          const d = lookup[k];
          const fileName = d.name || (d.file_url ? d.file_url.split("/").pop() || String(d.id) : String(d.id));
          next[k] = { id: -d.id, doc_key: k, file_name: fileName, status: d.status };
        }
      }
      return next;
    });
  }, [externalDocs]);

  // Register validator (no dep array → always reads latest uploads)
  useEffect(() => {
    validatorRef.current = () => {
      const missing = MANDATORY_DOC_KEYS.filter((k) => !uploads[k]);
      if (missing.length > 0) {
        return "Please upload all mandatory documents before completing onboarding.";
      }
      return null;
    };
  });

  const mandatoryDone = MANDATORY_DOC_KEYS.filter((k) => uploads[k]).length;
  const totalUploaded = Object.keys(uploads).length;
  const allMandatoryDone = mandatoryDone === MANDATORY_DOC_KEYS.length;

  async function handleUpload(doc: { key: string; label: string; required: boolean }, file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast("File size must be 5 MB or less.", "error");
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.type)) {
      toast("Only PDF, JPEG, and PNG files are allowed.", "error");
      return;
    }
    setUploading((p) => ({ ...p, [doc.key]: true }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_key", doc.key);
      fd.append("doc_label", doc.label);
      if (editingStaffId) fd.append("staff_id", String(editingStaffId));
      const res = await apiRequestWithRefreshResponse("/api/v1/hr/onboard/documents/upload/", {
        method: "POST",
        body: fd,
        silent401: true,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({})) as Record<string, unknown>;
        toast((errJson.message as string) || "Upload failed.", "error");
        return;
      }
      const json = (await res.json()) as { data: OnboardDocRecord };
      setUploads((p) => ({ ...p, [doc.key]: json.data }));
    } catch {
      toast("Upload failed. Please try again.", "error");
    } finally {
      setUploading((p) => ({ ...p, [doc.key]: false }));
    }
  }

  async function handleDelete(doc: { key: string; label: string }) {
    const record = uploads[doc.key];
    if (!record) return;
    // Prevent deletion of external staff documents (id < 0 marker)
    if (record.id < 0) {
      toast("Cannot delete a staff document from onboarding. Remove it from the staff documents section.", "error");
      return;
    }
    try {
      await apiRequestWithRefreshResponse(`/api/v1/hr/onboard/documents/${record.id}/`, { method: "DELETE", silent401: true });
      setUploads((p) => {
        const next = { ...p };
        delete next[doc.key];
        return next;
      });
    } catch {
      toast("Failed to delete document.", "error");
    }
  }

  async function handlePreview(doc: { key: string }) {
    const record = uploads[doc.key];
    if (!record) return;
    activePreviewKeyRef.current = doc.key;
    try {
      if (record.id < 0) {
        // external staff document — open file_url in new tab when available
        const ext = externalDocMapRef.current[doc.key];
        if (ext?.file_url) {
          window.open(ext.file_url, "_blank");
          return;
        }
        toast("Preview not available.", "error");
        return;
      }
      const res = await apiRequestWithRefreshResponse(
        `/api/v1/hr/onboard/documents/${record.id}/preview/`,
        { method: "GET", silent401: true },
      );
      if (!res.ok) { toast("Preview not available.", "error"); return; }
      const blob = await res.blob();
      // A slower, earlier preview request (e.g. Aadhaar) can resolve after the
      // user has already moved on (e.g. uploaded Signature) — discard it so it
      // doesn't clobber whatever is now the active preview.
      if (activePreviewKeyRef.current !== doc.key) return;
      setPreviewMime(blob.type || "application/pdf");
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      toast("Preview not available.", "error");
    }
  }

  function closePreview() {
    activePreviewKeyRef.current = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Preview modal */}
      {previewUrl && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.72)" }}
          onClick={closePreview}
        >
          <div
            className="relative bg-white rounded-[14px] overflow-hidden shadow-2xl"
            style={{ width: "min(90vw, 860px)", height: "min(90vh, 640px)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              type="button"
              onClick={closePreview}
              className="absolute top-3 right-3 z-10 flex items-center justify-center w-8 h-8 rounded-full bg-white shadow text-[#374151] hover:bg-[#f3f4f6] text-[20px] font-[700] leading-none"
              aria-label="Close preview"
            >
              &times;
            </button>
            {previewMime.startsWith("image/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Document preview"
                className="w-full h-full object-contain p-2"
              />
            ) : (
              <iframe
                src={previewUrl}
                title="Document preview"
                className="w-full h-full border-0"
              />
            )}
          </div>
        </div>
      )}
      <TipBox type={allMandatoryDone ? "success" : "warn"}>
        Documents marked <strong>Required</strong> must be uploaded before completing onboarding.{" "}
        <strong>{mandatoryDone}/{MANDATORY_DOC_KEYS.length}</strong> mandatory and{" "}
        <strong>{totalUploaded}</strong> total uploaded.
      </TipBox>
      {!allMandatoryDone && (
        <div
          className="flex items-start gap-2 px-4 py-3 rounded-[10px] text-[13px] font-[500]"
          style={{ background: "#fef3c7", border: "1px solid #fcd34d", color: "#92400e" }}
        >
          <span className="mt-px">⚠️</span>
          Please upload all mandatory documents before completing onboarding.
        </div>
      )}
      <div className="flex flex-col divide-y divide-[#F1F5F9] border border-[#E8E8F0] rounded-[12px] overflow-hidden">
        {ALL_DOCS.map((doc, i) => {
          const record = uploads[doc.key];
          const isUploaded = !!record;
          const isLoading = !!uploading[doc.key];
          return (
            <div key={doc.key} className="flex items-center gap-3 px-4 py-3 bg-white">
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                ref={(el) => { fileRefs.current[doc.key] = el; }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(doc, file);
                  e.target.value = "";
                }}
              />
              <span className="text-[12px] text-[#94A3B8] w-[20px] shrink-0 font-[600]">{i + 1}.</span>
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <span className="text-[13px] font-[600] text-[#15172A] truncate">{doc.label}</span>
                {doc.required ? (
                  <span className="shrink-0 text-[10px] font-[700] px-1.5 py-0.5 rounded-[5px] text-[#b91c1c] bg-[#fee2e2]">
                    Required
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] font-[600] px-1.5 py-0.5 rounded-[5px] text-[#64748b] bg-[#F1F5F9]">
                    Optional
                  </span>
                )}
                {isUploaded && (
                  <span className="shrink-0 text-[11px] text-[#475569] truncate max-w-[140px]" title={record.file_name}>
                    {record.file_name.length > 22 ? `${record.file_name.slice(0, 19)}\u2026` : record.file_name}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isUploaded && (
                  <button
                    type="button"
                    onClick={() => void handlePreview(doc)}
                    className="text-[11.5px] font-[600] px-3 py-1.5 rounded-[8px] border border-[#E2E8F0] text-[#475569] bg-white hover:bg-[#f8fafc]"
                  >
                    Preview
                  </button>
                )}
                <button
                  type="button"
                  disabled={isLoading}
                  onClick={() => fileRefs.current[doc.key]?.click()}
                  className="text-[11.5px] font-[600] px-3 py-1.5 rounded-[8px] border transition-colors"
                  style={{
                    background: isUploaded ? "var(--soft)" : "white",
                    borderColor: isUploaded ? "var(--brand)" : "#E2E8F0",
                    color: isUploaded ? "var(--brand)" : "#475569",
                    opacity: isLoading ? 0.6 : 1,
                  }}
                >
                  {isLoading ? "Uploading\u2026" : isUploaded ? "Re-upload" : "Upload"}
                </button>
                <span
                  className="text-[11px] font-[600] px-2.5 py-1 rounded-[6px] shrink-0"
                  style={{
                    background: isUploaded ? "#dcfce7" : "#fef3c7",
                    color: isUploaded ? "#15803d" : "#92400e",
                  }}
                >
                  {isUploaded ? "Done \u2713" : "Pending"}
                </span>
                {isUploaded && (
                  <button
                    type="button"
                    onClick={() => void handleDelete(doc)}
                    className="text-[11.5px] font-[600] px-3 py-1.5 rounded-[8px] border border-[#fecaca] text-[#dc2626] hover:bg-[#fef2f2]"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Step 10: Review & Onboard ---
function StepReview({
  f, set, departments, designations,
}: {
  f: FormData;
  set: (k: string, v: string) => void;
  departments: { id: number; name: string }[];
  designations: { id: number; name: string }[];
}) {
  const deptName  = departments.find((d) => String(d.id) === String(f.department))?.name;
  const desigName = designations.find((d) => String(d.id) === String(f.designation))?.name;
  const fullName  = [f.first_name, f.middle_name, f.last_name].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-6">
      {/* Ready to onboard banner */}
      <div className="rounded-[12px] p-[16px_20px]" style={{ background: "#ecfdf5", border: "1px solid #bbf7d0" }}>
        <div className="text-[14px] font-[800] text-[#065f46] mb-1" style={{ fontFamily: PF }}>Ready to onboard</div>
        <div className="text-[12.5px] text-[#065f46] opacity-80">
          Review identity, role, contact, documents and payroll before enrolling the staff member. You can still edit each section after saving.
        </div>
      </div>

      {/* Profile + Operational summary */}
      <div className="grid grid-cols-2 gap-5">
        <div className="rounded-[12px] border border-[#E8E8F0] p-[16px_18px] bg-white">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[12.5px] font-[700] text-[#15172A]" style={{ fontFamily: PF }}>Profile summary</div>
            <span className="text-[10px] font-[800] uppercase tracking-[0.06em] px-2 py-0.5 rounded-[5px] bg-[#fef3c7] text-[#92400e]">Required</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {[
              ["Full Name",  fullName || "—"],
              ["Gender",     f.gender || "—"],
              ["DOB",        f.date_of_birth || "—"],
              ["Mobile",     f.mobile || "—"],
              ["Email",      f.official_email || f.personal_email || "—"],
              ["Nationality",f.nationality || "—"],
            ].map(([k, v]) => (
              <div key={k as string} className="flex gap-2 text-[12px]">
                <span className="text-[#94A3B8] w-[90px] shrink-0">{k}</span>
                <span className="font-[600] text-[#15172A]">{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[12px] border border-[#E8E8F0] p-[16px_18px] bg-white">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[12.5px] font-[700] text-[#15172A]" style={{ fontFamily: PF }}>Operational summary</div>
            <span className="text-[10px] font-[800] uppercase tracking-[0.06em] px-2 py-0.5 rounded-[5px] bg-[#fef3c7] text-[#92400e]">Required</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {[
              ["Department",  deptName || "—"],
              ["Designation", desigName || "—"],
              ["Emp. Type",   f.employment_type || "—"],
              ["Joining",     f.joining_date || "—"],
              ["Basic Salary",f.basic_salary_input ? `₹${Number(f.basic_salary_input).toLocaleString()}` : "—"],
              ["Bank",        f.bank_name ? `${f.bank_name}${f.bank_branch ? ` · ${f.bank_branch}` : ""}` : "—"],
            ].map(([k, v]) => (
              <div key={k as string} className="flex gap-2 text-[12px]">
                <span className="text-[#94A3B8] w-[90px] shrink-0">{k}</span>
                <span className="font-[600] text-[#15172A]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Send welcome | Activate attendance */}
      <div className="grid grid-cols-2 gap-6">
        <HrField label="Send Welcome Message">
          <HrSelect value={f.send_welcome ?? ""} onChange={(e) => set("send_welcome", e.target.value)}>
            <option value="">Select...</option>
            <option value="email">Email</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="both">Both</option>
            <option value="no">No</option>
          </HrSelect>
        </HrField>
        <HrField label="Activate Attendance">
          <HrSelect value={f.activate_attendance ?? ""} onChange={(e) => set("activate_attendance", e.target.value)}>
            <option value="">Select...</option>
            <option value="immediately">Immediately</option>
            <option value="joining_date">From joining date</option>
            <option value="manual">Activate manually later</option>
          </HrSelect>
        </HrField>
      </div>
    </div>
  );
}

// --- Main Page ---
type OnboardProps = {
  popupStaffId?: number | null;
  popupStep?: number | null;
  popupDeptId?: number | string | null;
  onClose?: () => void;
  isPopup?: boolean;
};

// Local safety-net snapshot key — protects unsaved wizard progress against an
// accidental refresh/tab close. Separate from the backend "Save draft" feature,
// which is an explicit, named, cross-device save the user triggers deliberately.
const HR_ONBOARD_LOCAL_DRAFT_KEY = "hr_onboard_local_draft_v1";

export default function HrOnboardPage(props: any) {
  const router = useRouter();
  const isPopup = "isPopup" in props ? props.isPopup : false;
  const popupStaffId = "popupStaffId" in props ? props.popupStaffId : null;
  const popupStep = "popupStep" in props ? props.popupStep : null;
  const popupDeptId = "popupDeptId" in props ? props.popupDeptId : null;
  const onClose = "onClose" in props ? props.onClose : undefined;

  // The fixed footer bar (Progress + up to 8 buttons, flex-wrap) can wrap onto a
  // second line at common laptop/narrow-desktop widths, but the page body only
  // ever reserved a hardcoded 72px of bottom padding sized for a single-row
  // footer — so a wrapped footer's real height exceeded the reserved space and
  // visually overlapped whatever content sat at the bottom of the current step
  // (QA saw this on Contact & Address, but it's not step-specific: the footer is
  // rendered outside the step switch, so any step whose last field lands near
  // the fold can show the same overlap). Measure the footer's actual rendered
  // height instead of assuming a fixed number.
  const footerRef = useRef<HTMLDivElement | null>(null);
  const [footerHeight, setFooterHeight] = useState(72);
  useEffect(() => {
    const el = footerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setFooterHeight(Math.ceil(height));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const [step,                 setStep]                 = useState(1);
  const [form,                 setForm]                 = useState<FormData>({ status: "active" });
  const [saving,               setSaving]               = useState(false);
  const [done,                 setDone]                 = useState(false);
  const [showQrBanner,         setShowQrBanner]         = useState(true);
  const [photoPreview,         setPhotoPreview]         = useState<string | null>(null);
  const [photoFile,            setPhotoFile]            = useState<File | null>(null);
  const [showCameraModal,      setShowCameraModal]      = useState(false);
  const [cameraStream,         setCameraStream]         = useState<MediaStream | null>(null);
  const [cameraErr,            setCameraErr]            = useState<string | null>(null);
  const [showErrors,           setShowErrors]           = useState(false);
  // Server-side-only errors (e.g. "this bank account number is already
  // registered for another staff member") that have no client-side check to
  // mirror, keyed by backend field name. Rendered inline on the owning field
  // once the user is routed to that step; cleared as soon as they edit it.
  const [apiFieldErrors,       setApiFieldErrors]       = useState<Record<string, string>>({});
  const [highestStep,          setHighestStep]          = useState(1);
  const [editingStaffId,       setEditingStaffId]       = useState<number | null>(null);
  const [isLoadingStaff,       setIsLoadingStaff]       = useState(false);
  // Draft state
  const [draftId,              setDraftId]              = useState<number | null>(null);
  const [draftSaving,          setDraftSaving]          = useState(false);
  const [showDraftsModal,      setShowDraftsModal]      = useState(false);
  const [deletingDraftId,      setDeletingDraftId]      = useState<number | null>(null);
  // Blank form download state
  const [blankFormDownloading, setBlankFormDownloading] = useState(false);
  // Filled form PDF state
  const [filledFormDownloading, setFilledFormDownloading] = useState(false);
  // Scan & fill modal state
  const [scanFillOpen, setScanFillOpen] = useState(false);
  // Verification form preview state (shown before any PDF is actually downloaded)
  const [verificationFormOpen, setVerificationFormOpen] = useState(false);
  // Signed onboarding acknowledgment upload state
  const [signedFormUploading, setSignedFormUploading] = useState(false);
  const signedFormInputRef = useRef<HTMLInputElement>(null);
  // Navigate-away guard state (mirrors the student enrollment flow's unsaved-changes prompt)
  const [unsavedNavModalOpen,  setUnsavedNavModalOpen]  = useState(false);
  const [discardConfirmOpen,   setDiscardConfirmOpen]   = useState(false);
  const pendingNavRef = useRef<(() => void) | null>(null);
  const suppressNavGuardRef = useRef(false);
  const photoInputRef    = useRef<HTMLInputElement>(null);
  const cameraVideoRef   = useRef<HTMLVideoElement>(null);
  const nomValidatorRef  = useRef<() => string | null>(() => null);
  const prevDateValidatorRef = useRef<() => string | null>(() => null);
  const medValidatorRef  = useRef<() => string | null>(() => null);
  const payrollValidatorRef = useRef<() => string | null>(() => null);
  const docValidatorRef = useRef<() => string | null>(() => null);

  const { data: allDeptData } = useAllDepartments();
  const { data: desigData }   = useDesignations();
  const { data: staffData }   = useStaffList();
  // Prefill form when opened with query params (edit or department shortcut)
  useEffect(() => {
    try {
      let staffId: string | null = null;
      let dept: string | null = null;
      let stepParam: string | null = null;

      if (typeof window !== "undefined" && !isPopup) {
        const params = new URLSearchParams(window.location.search);
        staffId = params.get("staff_id");
        dept = params.get("department");
        stepParam = params.get("step");
      }

      if (popupStaffId !== null && popupStaffId !== undefined) {
        staffId = String(popupStaffId);
      }

      if (popupStep !== null && popupStep !== undefined) {
        stepParam = String(popupStep);
      }

      if (popupDeptId !== null && popupDeptId !== undefined) {
        dept = String(popupDeptId);
      }

      if (stepParam) {
        const n = Number(stepParam);
        if (!Number.isNaN(n) && n >= 1 && n <= TOTAL) setStep(n);
      }
      if (dept) {
        setForm((f) => ({ ...f, department: Number(dept) }));
      }
      if (staffId) {
        const id = Number(staffId);
        if (!Number.isNaN(id)) {
          setEditingStaffId(id);
          // Block the wizard from rendering until the fetch below resolves —
          // several step components (StepFamily's emergency contacts/nominees,
          // qualifications, previous employment, custom payroll rows) seed
          // their local state from `form` via a one-time useState initializer.
          // If a step mounted before `setForm(mapped)` ran, that state would
          // permanently default to blank even after the real data arrived.
          setIsLoadingStaff(true);
          (async () => {
            try {
              const resp = await apiRequestWithRefreshResponse(`/api/v1/hr/staff/${id}/`, { silent401: true });
              if (resp.ok) {
                const json = await resp.json();
                // Reset the form state for edit mode, then map backend keys to frontend form keys.
                const mapped: Record<string, any> = { ...(json || {}) };
                if (!Object.prototype.hasOwnProperty.call(mapped, "status")) mapped.status = "active";

                // Ensure empty email fields do not preserve stale values from previous staff loads.
                mapped.official_email = mapped.official_email ?? "";
                mapped.personal_email = mapped.personal_email ?? "";
                mapped.email = mapped.email ?? "";

                // Dates
                if (json?.join_date && !json?.joining_date) mapped.joining_date = String(json.join_date).slice(0, 10);
                if (json?.joining_date && !mapped.joining_date) mapped.joining_date = String(json.joining_date).slice(0, 10);
                if (json?.date_of_birth) mapped.date_of_birth = String(json.date_of_birth).slice(0, 10);
                if (json?.dob && !mapped.date_of_birth) mapped.date_of_birth = String(json.dob).slice(0, 10);

                // Phone / email
                if (json?.phone && !json?.mobile) mapped.mobile = json.phone;
                if (json?.phone_number && !mapped.mobile) mapped.mobile = json.phone_number;
                if (json?.official_email && !mapped.official_email) mapped.official_email = json.official_email;
                if (json?.email && !json?.official_email && !mapped.personal_email) mapped.personal_email = json.email;
                if (json?.personal_email && !mapped.personal_email) mapped.personal_email = json.personal_email;
                if (!mapped.personal_email && json?.custom_field?.personal_email) mapped.personal_email = json.custom_field.personal_email;
                if (!mapped.official_email && json?.custom_field?.official_email) mapped.official_email = json.custom_field.official_email;
                if (!mapped.whatsapp && json?.custom_field?.whatsapp) mapped.whatsapp = json.custom_field.whatsapp;
                if (!mapped.alternate_mobile && json?.custom_field?.alternate_mobile) mapped.alternate_mobile = json.custom_field.alternate_mobile;
                if (!mapped.current_address_line2 && json?.custom_field?.current_address_line2) mapped.current_address_line2 = json.custom_field.current_address_line2;
                if (!mapped.permanent_address_line2 && json?.custom_field?.permanent_address_line2) mapped.permanent_address_line2 = json.custom_field.permanent_address_line2;
                if (!mapped.city && json?.custom_field?.city) mapped.city = json.custom_field.city;
                if (!mapped.city && json?.custom_field?.current_city) mapped.city = json.custom_field.current_city;
                if (!mapped.state && json?.custom_field?.state) mapped.state = json.custom_field.state;
                if (!mapped.state && json?.custom_field?.current_state) mapped.state = json.custom_field.current_state;
                if (!mapped.current_country && json?.custom_field?.current_country) mapped.current_country = json.custom_field.current_country;
                if (!mapped.current_pin && json?.custom_field?.current_pin) mapped.current_pin = json.custom_field.current_pin;
                if (!mapped.current_pin && json?.custom_field?.pincode) mapped.current_pin = json.custom_field.pincode;
                if (!mapped.current_pin && json?.custom_field?.pin) mapped.current_pin = json.custom_field.pin;
                if (!mapped.current_pin && json?.custom_field?.postal_code) mapped.current_pin = json.custom_field.postal_code;
                if (!mapped.permanent_city && json?.custom_field?.permanent_city) mapped.permanent_city = json.custom_field.permanent_city;
                if (!mapped.permanent_state && json?.custom_field?.permanent_state) mapped.permanent_state = json.custom_field.permanent_state;
                if (!mapped.permanent_country && json?.custom_field?.permanent_country) mapped.permanent_country = json.custom_field.permanent_country;
                if (!mapped.permanent_pin && json?.custom_field?.permanent_pin) mapped.permanent_pin = json.custom_field.permanent_pin;

                // Identity fields
                if (json?.gender) {
                  const g = String(json.gender).trim().toLowerCase();
                  // Backend stores as lowercase: "male", "female", "other"
                  if (g === "male" || g === "m") mapped.gender = "Male";
                  else if (g === "female" || g === "f") mapped.gender = "Female";
                  else if (g === "other") mapped.gender = "Other";
                  else if (g === "prefer not to say" || g.includes("prefer")) mapped.gender = "Prefer not to say";
                  else if (g) mapped.gender = String(json.gender).trim(); // fallback to raw value
                }
                if (json?.nationality && !mapped.nationality) mapped.nationality = json.nationality;

                // Blood group: map from backend 'blood_group' to frontend 'blood_group_input'
                if ((json as any).blood_group && !mapped.blood_group_input) mapped.blood_group_input = String((json as any).blood_group).trim();

                // Payroll: map backend 'basic_salary' (a Decimal, e.g. 37000.00) to the
                // frontend's '_input' string field the Payroll step actually reads —
                // without this the field silently renders blank on edit even though the
                // value is saved, and re-submitting without noticing wipes it to 0.
                if ((json as any).basic_salary !== undefined && (json as any).basic_salary !== null && !mapped.basic_salary_input) {
                  const salaryNum = Number((json as any).basic_salary);
                  if (!Number.isNaN(salaryNum)) mapped.basic_salary_input = String(salaryNum);
                }
                // Payroll components (HRA/DA/allowances) and bank lookup extras
                // (IFSC/city/state) all live in custom_field on the backend but the
                // Payroll/Government-identity steps read flat '_input'-suffixed (or
                // plain) form keys — same class of gap as basic_salary_input above.
                if (!mapped.hra_input && json?.custom_field?.hra) mapped.hra_input = String(json.custom_field.hra);
                if (!mapped.da_input && json?.custom_field?.da) mapped.da_input = String(json.custom_field.da);
                if (!mapped.travel_allowance_input && json?.custom_field?.travel_allowance) mapped.travel_allowance_input = String(json.custom_field.travel_allowance);
                if (!mapped.medical_allowance_input && json?.custom_field?.medical_allowance) mapped.medical_allowance_input = String(json.custom_field.medical_allowance);
                if (!mapped.special_allowance_input && json?.custom_field?.special_allowance) mapped.special_allowance_input = String(json.custom_field.special_allowance);
                if (!mapped.custom_earnings && Array.isArray(json?.custom_field?.custom_earnings) && json.custom_field.custom_earnings.length > 0) {
                  mapped.custom_earnings = JSON.stringify(json.custom_field.custom_earnings);
                }
                if (!mapped.custom_deductions && Array.isArray(json?.custom_field?.custom_deductions) && json.custom_field.custom_deductions.length > 0) {
                  mapped.custom_deductions = JSON.stringify(json.custom_field.custom_deductions);
                }
                if (!mapped.ifsc_code && json?.custom_field?.ifsc_code) mapped.ifsc_code = String(json.custom_field.ifsc_code);
                if (!mapped.bank_city && json?.custom_field?.bank_city) mapped.bank_city = String(json.custom_field.bank_city);
                if (!mapped.bank_state && json?.custom_field?.bank_state) mapped.bank_state = String(json.custom_field.bank_state);

                // Mother tongue, religion: map directly
                if ((json as any).mother_tongue && !mapped.mother_tongue) mapped.mother_tongue = String((json as any).mother_tongue).trim();
                if ((json as any).religion && !mapped.religion) mapped.religion = String((json as any).religion).trim();

                // Designation: prefer numeric id fields; fall back to lookup by name
                if ((json as any).designation && !mapped.designation) mapped.designation = (json as any).designation;
                if ((json as any).designation_id && !mapped.designation) mapped.designation = (json as any).designation_id;
                if (!mapped.designation && (json as any).designation_name && desigData?.results) {
                  const found = desigData.results.find((d: any) => String(d.name).toLowerCase() === String((json as any).designation_name).toLowerCase());
                  if (found) mapped.designation = found.id;
                }

                // Employment type / contract_type => map to readable label
                if (!mapped.employment_type) {
                  if (json?.employment_type) mapped.employment_type = String(json.employment_type).trim();
                  else if (json?.contract_type) {
                    const ct = String(json.contract_type).toLowerCase();
                    mapped.employment_type = ct === "contract" ? "Contract" : ct === "permanent" ? "Full-time" : String(json.contract_type);
                  }
                }

                // Fallback: ensure employment_type is a string, not an object
                if (mapped.employment_type && typeof mapped.employment_type === 'object') {
                  mapped.employment_type = String(mapped.employment_type).trim();
                }

                // Preferred communication
                if ((json as any).preferred_communication) mapped.preferred_communication = String((json as any).preferred_communication).trim();
                if (!mapped.preferred_communication && (json as any).preferred_comm) mapped.preferred_communication = String((json as any).preferred_comm).trim();

                // Address fields
                if (json?.city && !mapped.city) mapped.city = json.city;
                if (json?.state && !mapped.state) mapped.state = json.state;
                if ((json as any).current_city && !mapped.city) mapped.city = (json as any).current_city;
                if ((json as any).current_state && !mapped.state) mapped.state = (json as any).current_state;
                // PIN / postal code
                if ((json as any).current_pin && !mapped.current_pin) mapped.current_pin = (json as any).current_pin;
                if ((json as any).pin && !mapped.current_pin) mapped.current_pin = (json as any).pin;
                if ((json as any).pincode && !mapped.current_pin) mapped.current_pin = (json as any).pincode;
                if ((json as any).postal_code && !mapped.current_pin) mapped.current_pin = (json as any).postal_code;

                // Marital status, children
                if ((json as any).marital_status && !mapped.marital_status) mapped.marital_status = json.marital_status;
                if ((json as any).num_children !== undefined && mapped.num_children === undefined) mapped.num_children = String((json as any).num_children);

                // Some backends return `staff_no` vs `staff_id` / `id` — keep both
                if (json?.staff_no && !mapped.staff_no) mapped.staff_no = json.staff_no;
                if (json?.id && !mapped.id) mapped.id = json.id;

                // Strip backend-only/derived fields that have no UI control. Keeping
                // them in form state round-trips backend-shaped data (a nested dict
                // for custom_field, a pre-normalized array for other_document) back
                // out on submit, where it collides with the frontend's own string/array
                // conversion and fails validation ("Value must be valid JSON.",
                // "Not a valid string."). All useful nested values were already pulled
                // out into flat fields above; other_document is reconstructed fresh
                // from the onboarding-documents endpoint at submit time regardless.
                delete mapped.custom_field;
                delete mapped.other_document;

                setForm(mapped);
                // The photo preview is separate local state (not part of `form`),
                // so it has to be hydrated explicitly — otherwise the uploader
                // looks empty on edit even though a photo is saved.
                if (json?.staff_photo) setPhotoPreview(String(json.staff_photo));
                setHighestStep(1);
              } else {
                console.error("❌ Failed to fetch staff:", resp.status, resp.statusText);
              }
            } catch (err) {
              console.error("❌ Error fetching staff:", err);
              // ignore load errors; user can continue manually
            } finally {
              setIsLoadingStaff(false);
            }
          })();
        }
      }
    } catch {
      // ignore when running server-side or in non-browser env
    }
  }, []);
  const { data: langData,    loading: langLoading,    error: langError    } = useMasterLanguages();
  const { data: relData,     loading: relLoading,     error: relError     } = useMasterReligions();
  const { data: countryData, loading: countryLoading, error: countryError } = useMasterCountries();
  const { data: empTypeData, loading: empTypeLoading, error: empTypeError } = useMasterEmploymentTypes();
  const { data: formOptsData } = useStaffFormOptions();
  const { data: draftsData, refetch: refetchDrafts } = useOnboardDrafts();
  const { toast }             = useHrToast();

  const departments  = allDeptData?.results ?? [];
  const designations = desigData?.results ?? [];
  const roles        = formOptsData?.data?.roles ?? [];
  const staffList    = (staffData?.results ?? []) as { id: number; first_name: string; last_name: string }[];
  const staffCount   = staffData?.count ?? 0;
  const draftList    = draftsData?.results ?? [];

  const setField = (k: string, v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    setApiFieldErrors((prev) => {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      delete next[k];
      return next;
    });
  };

  const { data: staffDocumentsData } = useStaffDocuments(Number(editingStaffId ?? 0));

  // Wire camera stream to video element when modal opens
  useEffect(() => {
    if (showCameraModal && cameraStream && cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = cameraStream;
    }
  }, [showCameraModal, cameraStream]);

  // Restore in-progress form from a local snapshot after an accidental refresh —
  // only for a fresh "add new staff" visit; an explicit staff_id load (handled in
  // the query-param effect above) always takes priority over this local safety net.
  useEffect(() => {
    if (isPopup || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("staff_id")) return;
    try {
      const raw = window.localStorage.getItem(HR_ONBOARD_LOCAL_DRAFT_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw) as { form?: FormData; step?: number; highestStep?: number };
      if (snapshot.form && Object.keys(snapshot.form).length > 1) {
        setForm(snapshot.form);
        if (snapshot.step) setStep(snapshot.step);
        if (snapshot.highestStep) setHighestStep(snapshot.highestStep);
        toast("Restored your unsaved progress from before the page reloaded.", "info");
      }
    } catch {
      // corrupt/unavailable snapshot — ignore, user starts fresh
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Continuously snapshot the in-progress form to localStorage so an accidental
  // refresh or browser crash doesn't wipe out unsaved onboarding progress. This
  // is separate from (and lighter-weight than) the explicit backend "Save draft".
  useEffect(() => {
    if (isPopup || typeof window === "undefined" || editingStaffId) return;
    try {
      window.localStorage.setItem(
        HR_ONBOARD_LOCAL_DRAFT_KEY,
        JSON.stringify({ form, step, highestStep }),
      );
    } catch {
      // storage unavailable/full — local snapshot is best-effort only
    }
  }, [form, step, highestStep, isPopup, editingStaffId]);

  // True once the user has entered anything beyond the default blank form
  // (which is just `{ status: "active" }`) or picked a photo.
  const isFormDirty = Object.keys(form).length > 1 || !!photoFile;

  const resetFormToBlank = () => {
    try { window.localStorage.removeItem(HR_ONBOARD_LOCAL_DRAFT_KEY); } catch { /* ignore */ }
    setForm({ status: "active" });
    setStep(1);
    setPhotoPreview(null);
    setPhotoFile(null);
    setDraftId(null);
    setHighestStep(1);
    setShowErrors(false);
  };

  // Browser-level guard: warn on tab close / refresh while the form has unsaved content.
  // suppressNavGuardRef is flipped just before the post-submit redirect below, since that
  // redirect happens synchronously (window.location.href) before React can re-render and
  // clear isFormDirty — without it, a successful submit would still trigger this dialog.
  useEffect(() => {
    if (isPopup || typeof window === "undefined" || !isFormDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (suppressNavGuardRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isFormDirty, isPopup]);

  // App-level guard: the shared BackButton checks window.__navGuard before navigating,
  // so an in-app "Back" click also gets the same unsaved-changes prompt.
  useEffect(() => {
    if (isPopup || typeof window === "undefined") return;
    const w = window as unknown as { __navGuard?: (proceed: () => void) => boolean };
    if (!isFormDirty) {
      delete w.__navGuard;
      return;
    }
    w.__navGuard = (proceed: () => void) => {
      pendingNavRef.current = proceed;
      setUnsavedNavModalOpen(true);
      return true; // block default navigation until the user chooses
    };
    return () => { delete w.__navGuard; };
  }, [isFormDirty, isPopup]);

  // DOB limits: must be ≥ 18 years old, cannot be a future date
  const maxDobDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 18);
    return d.toISOString().split("T")[0];
  })();
  // Staff age must not exceed 70 years
  const minDobDate = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 70);
    return d.toISOString().split("T")[0];
  })();
  const todayDate = new Date().toISOString().split("T")[0];

  // Pre-compute which steps show a green checkmark
  const completedSteps = new Set<number>();
  for (let n = 1; n <= TOTAL; n++) {
    if (isStepComplete(n, form, todayDate, maxDobDate, minDobDate, highestStep)) completedSteps.add(n);
  }

  const navigateTo = (n: number) => {
    setShowErrors(false);
    setHighestStep((h) => Math.max(h, n));
    setStep(n);
  };

  /** Unconditionally advances to the next step (called after all guards pass). */
  const advanceStep = () => {
    setShowErrors(false);
    setHighestStep((h) => Math.max(h, step + 1));
    setStep((s) => Math.min(s + 1, TOTAL));
  };

  /**
   * Validates step `n`'s required fields (same rules the "Next" button has always
   * enforced), surfacing a toast + inline highlighting via `showErrors` on failure.
   * Pulled out of `goNext` so both the Next button and jumping via the sidebar nav
   * (`attemptNavigate`) — and the final Submit safety net — share one source of truth
   * instead of the sidebar silently skipping validation the Next button enforces.
   * Returns true when the step is NOT complete (guard fails, caller should stop).
   */
  const stepGuardFails = (n: number): boolean => {
    if (n === 1) {
      const dob = form.date_of_birth ?? "";
      if (dob && dob >= todayDate) {
        setShowErrors(true);
        toast("Date of birth cannot be today or a future date.", "error");
        return true;
      }
      if (dob && dob > maxDobDate) {
        setShowErrors(true);
        toast("Staff age must be at least 18 years.", "error");
        return true;
      }
      if (dob && dob < minDobDate) {
        setShowErrors(true);
        toast("Please enter a valid date of birth. Age cannot exceed 70 years.", "error");
        return true;
      }
    }
    if (n === 2) {
      const joining = form.joining_date ?? "";
      const dob = form.date_of_birth ?? "";
      if (joining && joining > todayDate) {
        setShowErrors(true);
        toast("Joining date cannot be a future date.", "error");
        return true;
      }
      if (joining && dob && joining <= dob) {
        setShowErrors(true);
        toast("Joining date cannot be earlier than date of birth.", "error");
        return true;
      }
      if (joining && dob && joining < addYears(dob, 18)) {
        setShowErrors(true);
        toast("Staff must be at least 18 years old at the time of joining.", "error");
        return true;
      }
    }
    if (n === 3) {
      const mob = (form.mobile ?? "").trim();
      if (mob && !/^\d+$/.test(mob)) { setShowErrors(true); toast("Enter a valid mobile number.", "error"); return true; }
      if (mob && mob.length < 10)    { setShowErrors(true); toast("Enter a valid mobile number.", "error"); return true; }
      const wa  = (form.whatsapp ?? "").trim();
      if (wa && (!/^\d+$/.test(wa) || wa.replace(/\D/g,"").length < 10)) {
        setShowErrors(true); toast("Enter a valid WhatsApp number.", "error"); return true;
      }
      const pe = (form.personal_email ?? "").trim();
      if (pe && !isValidEmail(pe)) { setShowErrors(true); toast("Enter a valid email address.", "error"); return true; }
    }
    if (n === 4) {
      const ecName   = (form.emergency_name     ?? "").trim();
      const ecRel    = (form.emergency_relation  ?? "").trim();
      const ecMobile = (form.emergency_phone     ?? "").trim();
      if (!ecName || !ecRel || !ecMobile) {
        setShowErrors(true);
        toast("Please fill in required emergency contact fields (name, relationship, mobile).", "error");
        return true;
      }
      if (!isValidPersonName(ecName)) {
        setShowErrors(true);
        toast(PERSON_NAME_ERR, "error");
        return true;
      }
      if (!isValidIndianMobile(ecMobile.replace(/\D/g, ""))) {
        setShowErrors(true);
        toast("Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.", "error");
        return true;
      }
      if (form.marital_status === "Married") {
        const spouse = (form.spouse_parent_name ?? "").trim();
        if (spouse && !isValidPersonName(spouse)) {
          setShowErrors(true);
          toast(PERSON_NAME_ERR, "error");
          return true;
        }
      }
      const nomErr = nomValidatorRef.current();
      if (nomErr) {
        setShowErrors(true);
        toast(nomErr, "error");
        return true;
      }
    }
    if (n === 5) {
      const missing: string[] = [];
      if (!(form.bank_account_no ?? "").trim())   missing.push("Account Number");
      if (!(form.bank_name ?? "").trim())         missing.push("Bank Name");
      if (!(form.bank_account_name ?? "").trim()) missing.push("Account Holder Name");
      if (missing.length > 0) {
        setShowErrors(true);
        toast(`Please fill in required bank details: ${missing.join(", ")}.`, "error");
        return true;
      }
      const accNo = (form.bank_account_no ?? "").trim();
      if (accNo && !/^\d{9,18}$/.test(accNo)) {
        setShowErrors(true);
        toast("Please enter a valid bank account number.", "error");
        return true;
      }
      const holder = (form.bank_account_name ?? "").trim();
      if (holder && !isValidBankAccountName(holder)) {
        setShowErrors(true);
        toast(BANK_ACCOUNT_NAME_ERR, "error");
        return true;
      }
    }
    if (n === 6) {
      const dateErr = prevDateValidatorRef.current();
      if (dateErr) {
        setShowErrors(true);
        toast(dateErr, "error");
        return true;
      }
    }
    if (n === 7) {
      const medErr = medValidatorRef.current();
      if (medErr) {
        setShowErrors(true);
        toast(medErr, "error");
        return true;
      }
    }
    if (n === 8) {
      const payErr = payrollValidatorRef.current();
      if (payErr) {
        setShowErrors(true);
        toast(payErr, "error");
        return true;
      }
    }
    if (n === 9) {
      const docErr = docValidatorRef.current();
      if (docErr) {
        setShowErrors(true);
        toast(docErr, "error");
        return true;
      }
    }
    if (n <= 3 && !isStepComplete(n, form, todayDate, maxDobDate, minDobDate, highestStep)) {
      setShowErrors(true);
      // Give a specific message when inactive status is the only blocker
      if (n === 1 && form.status === "inactive" && step1Missing({ ...form, status: "active" }).size === 0) {
        toast("Inactive staff cannot continue onboarding. Change status to Active.", "error");
      } else {
        toast("Please fill in all required fields before continuing.", "error");
      }
      return true;
    }
    return false;
  };

  const goNext = () => {
    if (stepGuardFails(step)) return;
    advanceStep();
  };
  const goPrev = () => { setShowErrors(false); setStep((s) => Math.max(s - 1, 1)); };

  /**
   * Jump directly to step `n` via the sidebar. Forward jumps must first clear the
   * step being left — the same rule "Next" already enforces — so a required field
   * can no longer be skipped by clicking ahead in the nav instead of clicking Next.
   * Jumping backward (or re-clicking the current step) stays unrestricted.
   */
  const attemptNavigate = (n: number) => {
    if (n > step && stepGuardFails(step)) return;
    navigateTo(n);
  };

  const currentStep = ALL_STEPS.find((s: StepDef) => s.num === step) ?? ALL_STEPS[0];
  const progress    = Math.round((step / TOTAL) * 100);

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/jpg", "image/png"].includes(file.type)) {
      toast("Only JPG and PNG files are allowed for the staff photo.", "error");
      e.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast("Staff photo must be 2 MB or less.", "error");
      e.target.value = "";
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    e.target.value = "";
  };

  const openCamera = async () => {
    setCameraErr(null);
    setShowCameraModal(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } },
      });
      setCameraStream(stream);
    } catch {
      setCameraErr("Camera access denied or not available. Please allow camera permission and try again.");
    }
  };

  const closeCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    }
    setShowCameraModal(false);
    setCameraErr(null);
  };

  const capturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video || !video.videoWidth) {
      setCameraErr("Camera not ready. Please wait a moment and try again.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setCameraErr("Unable to process the image. Try uploading a file instead."); return; }
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) { setCameraErr("Failed to capture photo. Please try again."); return; }
      if (blob.size > 2 * 1024 * 1024) {
        setCameraErr("Captured photo exceeds 2 MB. Move closer or improve lighting, then try again.");
        return;
      }
      const file = new File([blob], `staff-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(blob));
      cameraStream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
      setShowCameraModal(false);
      setCameraErr(null);
      toast("Photo captured successfully!", "success");
    }, "image/jpeg", 0.92);
  };

  const handleSaveDraft = async (onSuccess?: () => void) => {
    const firstName = (form.first_name ?? "").trim();
    if (!firstName) {
      toast("Please enter the staff member's first name before saving a draft.", "error");
      return;
    }
    setDraftSaving(true);
    try {
      // Strip any keys whose values are undefined so JSON serialises cleanly
      const cleanForm = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== undefined)
      ) as Record<string, unknown>;
      const saved = await saveOnboardDraft({ id: draftId, form_data: cleanForm, current_step: step });
      setDraftId(saved.id);
      await refetchDrafts();
      toast(`Draft "${saved.draft_name}" saved at Step ${step}.`, "success");
      onSuccess?.();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to save draft.", "error");
    } finally {
      setDraftSaving(false);
    }
  };

  const runPendingNav = () => {
    const proceed = pendingNavRef.current;
    pendingNavRef.current = null;
    proceed?.();
  };

  const saveDraftAndLeave = () => {
    void handleSaveDraft(() => {
      setUnsavedNavModalOpen(false);
      runPendingNav();
    });
  };

  const discardAndLeave = () => {
    resetFormToBlank();
    setUnsavedNavModalOpen(false);
    runPendingNav();
  };

  const handleLoadDraft = (draft: OnboardDraft) => {
    const fd = draft.form_data as Record<string, string>;
    setForm({ status: "active", ...fd });
    setStep(draft.current_step);
    setHighestStep(draft.current_step);
    setDraftId(draft.id);
    setShowDraftsModal(false);
    setShowErrors(false);
    setPhotoPreview(null);
    setPhotoFile(null);
    toast(`Draft "${draft.draft_name}" loaded — continuing from Step ${draft.current_step}.`, "success");
  };

  const handleDeleteDraft = async (id: number) => {
    setDeletingDraftId(id);
    try {
      await deleteOnboardDraft(id);
      await refetchDrafts();
      if (draftId === id) setDraftId(null);
      toast("Draft deleted.", "success");
    } catch {
      toast("Failed to delete draft.", "error");
    } finally {
      setDeletingDraftId(null);
    }
  };

  const handleBlankForm = async () => {
    setBlankFormDownloading(true);
    try {
      await downloadBlankForm(1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to download blank form.";
      toast(msg, "error");
    } finally {
      setBlankFormDownloading(false);
    }
  };

  const handleFilledForm = async () => {
    const firstName = (form.first_name ?? "").trim();
    if (!firstName) {
      toast("Enter the staff member's first name before generating a PDF.", "error");
      return;
    }
    setFilledFormDownloading(true);
    try {
      const cleanForm = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== undefined),
      ) as Record<string, unknown>;
      // The PDF just prints these as text — resolve FK ids to their display names
      // here rather than making the backend do a second round of DB lookups.
      const deptName = departments.find((d) => String(d.id) === String(form.department))?.name;
      const desigName = designations.find((d) => String(d.id) === String(form.designation))?.name;
      const roleMatch = roles.find((r) => String(r.id) === String(form.role))?.name;
      const managerMatch = staffList.find((s) => String(s.id) === String(form.reporting_manager));
      const empLabel = String(form.employment_type ?? "").trim().toLowerCase();
      if (deptName) cleanForm.department = deptName;
      if (desigName) cleanForm.designation = desigName;
      if (roleMatch) cleanForm.role = roleMatch;
      if (managerMatch) cleanForm.reporting_manager = `${managerMatch.first_name} ${managerMatch.last_name}`.trim();
      cleanForm.contract_type = empLabel.includes("contract") ? "contract" : (empLabel ? "permanent" : "");
      await downloadFilledForm(cleanForm);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to generate PDF.";
      toast(msg, "error");
    } finally {
      setFilledFormDownloading(false);
    }
  };

  const handleSignedFormUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast("File size must be 5 MB or less.", "error");
      return;
    }
    const allowed = ["application/pdf", "image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.type)) {
      toast("Only PDF, JPEG, and PNG files are allowed.", "error");
      return;
    }
    setSignedFormUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_key", "signed_onboarding_form");
      fd.append("doc_label", "Signed Onboarding Acknowledgment");
      if (editingStaffId) fd.append("staff_id", String(editingStaffId));
      const res = await apiRequestWithRefreshResponse("/api/v1/hr/onboard/documents/upload/", {
        method: "POST",
        body: fd,
        silent401: true,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({})) as Record<string, unknown>;
        toast((errJson.message as string) || "Upload failed.", "error");
        return;
      }
      toast("Signed acknowledgment uploaded.", "success");
    } catch {
      toast("Upload failed. Please try again.", "error");
    } finally {
      setSignedFormUploading(false);
    }
  };

  const handleSubmit = async () => {
    // Primary check for the fields every wizard entry point reaches (name/department/etc).
    // These extra checks close the gap for later-step required fields (photo, bank, salary)
    // that a resumed draft could otherwise skip past — previously a missing field here only
    // surfaced as a toast, leaving the user to hunt across 10 steps for what to fix. Now it
    // jumps straight to the earliest incomplete step and highlights it, same as `goNext`.
    const missing: Array<{ label: string; step: number }> = [];
    if (!form.first_name) missing.push({ label: "First Name", step: 1 });
    if (!form.last_name) missing.push({ label: "Last Name", step: 1 });
    if (!editingStaffId && !photoFile) missing.push({ label: "Staff Photo", step: 1 });
    if (!form.department) missing.push({ label: "Department", step: 2 });
    if (!form.designation) missing.push({ label: "Designation", step: 2 });
    if (!form.joining_date) missing.push({ label: "Joining Date", step: 2 });
    if (!form.bank_account_name?.trim()) missing.push({ label: "Bank Account Holder Name", step: 5 });
    if (!form.bank_account_no?.trim()) missing.push({ label: "Bank Account Number", step: 5 });
    if (!form.bank_name?.trim()) missing.push({ label: "Bank Name", step: 5 });
    if (!form.basic_salary_input?.trim()) missing.push({ label: "Basic Salary", step: 8 });
    if (missing.length > 0) {
      const targetStep = missing.reduce((min, m) => Math.min(min, m.step), TOTAL);
      const labelsForStep = missing.filter((m) => m.step === targetStep).map((m) => m.label);
      setHighestStep((h) => Math.max(h, targetStep));
      setStep(targetStep);
      setShowErrors(true);
      toast(`Fill in required fields: ${labelsForStep.join(", ")}`, "error");
      return;
    }
    setSaving(true);
    try {
      // Auto-allocate staff_no for create flow using the joining date year
      // (format: ST-YYYY-####). This keeps year/sequence consistent even when
      // the staff number preview was loaded before joining date was chosen.
      let staffNo = (form as Record<string, unknown>).staff_no as string | undefined;
      if (!editingStaffId) {
        try {
          const joiningDate = String((form as Record<string, unknown>).joining_date ?? "").trim();
          const query = joiningDate ? `?joining_date=${encodeURIComponent(joiningDate)}` : "";
          const res = await apiRequestWithRefreshResponse(`/api/v1/hr/staff/next-staff-no/${query}`, { silent401: true });
          if (res.ok) {
            const j = (await res.json()) as { staff_no?: string };
            staffNo = j?.staff_no ?? "";
          }
        } catch { /* fall through; backend will error if still missing */ }
      } else if (!staffNo || !String(staffNo).trim()) {
        try {
          const res = await apiRequestWithRefreshResponse("/api/v1/hr/staff/next-staff-no/", { silent401: true });
          if (res.ok) {
            const j = (await res.json()) as { staff_no?: string };
            staffNo = j?.staff_no ?? "";
          }
        } catch { /* fall through; backend will error if still missing */ }
      }

      // Backend choice fields are lowercase; frontend captures Title Case labels.
      const lower = (v: unknown) => (typeof v === "string" ? v.trim().toLowerCase() : v);

      // Map frontend employment_type label → backend contract_type key
      // (model choices: "permanent" / "contract")
      const empLabel = String((form as Record<string, unknown>).employment_type ?? "").trim().toLowerCase();
      const contractType = empLabel.includes("contract") ? "contract" : (empLabel ? "permanent" : "");

      const fAny = form as Record<string, unknown>;
      const { joining_date, mobile, personal_email, official_email, employment_type, blood_group_input, ...rest } = fAny;
      void employment_type; // mapped to contract_type below

      // "" (empty/unset "No. of Children") fails DRF's IntegerField with
      // "A valid integer is required." — null is the correct empty representation.
      const numChildrenRaw = String(fAny.num_children ?? "").trim();
      const numChildren = numChildrenRaw ? Number(numChildrenRaw) : null;

      const payload: Record<string, unknown> = {
        ...rest,
        staff_no: staffNo,
        join_date: joining_date,
        // Field-name mapping (frontend → backend)
        email: (official_email as string) || (personal_email as string) || "",
        phone: mobile,
        contract_type: contractType,
        blood_group: blood_group_input ?? rest.blood_group,
        // Carry through originals too so other consumers/saved drafts keep working.
        mobile,
        personal_email,
        official_email,
        // Fallback: if user didn't fill permanent_address, reuse current_address.
        permanent_address: (fAny.permanent_address as string) || (fAny.current_address as string) || "",
        gender: lower(form.gender),
        marital_status: lower(form.marital_status),
        basic_salary: form.basic_salary_input ? Number(form.basic_salary_input) : 0,
        num_children: numChildren,
      };

      // Pull uploaded onboarding docs and surface signature filename via other_document,
      // which the backend requires as the "Signature upload". Scoped to this staff
      // (or the brand-new-hire pool when not editing) — without staff_id here, editing
      // one staff member could pick up a signature left over from a different,
      // unfinished onboarding/edit by the same HR user.
      try {
        const docsQs = editingStaffId ? `?staff_id=${editingStaffId}` : "";
        const docsRes = await apiRequestWithRefreshResponse(`/api/v1/hr/onboard/documents/${docsQs}`, { silent401: true });
        if (docsRes.ok) {
          const docsJson = (await docsRes.json()) as { data?: { doc_key: string; file_name: string }[] };
          const sig = (docsJson.data ?? []).find((d) => d.doc_key === "signature");
          if (sig?.file_name) {
            payload.other_document = [sig.file_name];
          }
        } else {
          toast("Could not verify uploaded signature — please confirm it was uploaded before submitting.", "error");
        }
      } catch {
        toast("Could not verify uploaded signature — please confirm it was uploaded before submitting.", "error");
      }

      if (editingStaffId) {
        await updateStaff(editingStaffId, payload as Partial<Staff>, photoFile ?? undefined);
        toast("Staff updated successfully!");
      } else {
        await createStaff(payload as Partial<Staff>, photoFile ?? undefined);
        toast("Staff onboarded successfully!");
      }
      try { window.localStorage.removeItem(HR_ONBOARD_LOCAL_DRAFT_KEY); } catch { /* ignore */ }
      suppressNavGuardRef.current = true;

      if (onClose) {
        onClose();
      } else {
        router.push("/hr/directory");
      }
    } catch (err) {
      let msg = err instanceof Error ? err.message : "Failed to save staff. Please check the form.";
      if (err instanceof HrApiError && err.errors) {
        const fieldNames = Object.keys(err.errors);
        if (fieldNames.length > 0) {
          // Surface the backend's actual field-level message (e.g. "This bank
          // account number is already registered for another staff member.")
          // instead of a generic string with just the raw field name tacked
          // on — that told the user *something* was wrong but never *what*,
          // which is exactly what read as "only SBI is accepted" confusion
          // when the real cause was an unrelated duplicate account number.
          const detailFor = (field: string): string => {
            const raw = err.errors![field];
            const first = Array.isArray(raw) ? raw[0] : raw;
            return typeof first === "string" && first.trim() ? first : "";
          };
          const messages = fieldNames.map((f) => detailFor(f)).filter(Boolean);
          msg = messages.length > 0 ? messages.join(" ") : `${msg} (${fieldNames.join(", ")})`;

          const nextApiErrors: Record<string, string> = {};
          for (const f of fieldNames) {
            const d = detailFor(f);
            if (d) nextApiErrors[f] = d;
          }
          setApiFieldErrors(nextApiErrors);

          // Jump to + highlight the earliest step that owns one of the failing
          // fields, same as the client-side pre-submit check above.
          const steps = fieldNames.map((f) => BACKEND_FIELD_STEP_MAP[f]).filter((n): n is number => !!n);
          if (steps.length > 0) {
            const targetStep = Math.min(...steps);
            setHighestStep((h) => Math.max(h, targetStep));
            setStep(targetStep);
            setShowErrors(true);
          }
        }
      }
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  // Loading screen
  if (isLoadingStaff) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <div className="animate-spin h-8 w-8 border-4 border-[var(--brand)] border-t-transparent rounded-full" />
      </div>
    );
  }

  // Success screen
  if (done) {
    return (
      <div
        className="bg-white border border-[#E8E8F0] rounded-[14px] p-[72px_28px] text-center"
        style={{ boxShadow: "0 2px 8px -2px rgba(15,18,34,0.07)" }}
      >
        <div className="text-[56px] mb-4">🎉</div>
        <h2 className="text-[28px] font-[800] m-0 text-[#15172A]">
          Staff{" "}
          <em className="not-italic" style={{ fontFamily: "var(--serif)", color: "var(--brand)" }}>Onboarded!</em>
        </h2>
        <p className="text-[var(--muted)] mt-3 mb-6">
          {[form.first_name, form.last_name].filter(Boolean).join(" ")} has been successfully onboarded and added to your staff directory.
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => { try { window.localStorage.removeItem(HR_ONBOARD_LOCAL_DRAFT_KEY); } catch { /* ignore */ } setForm({ status: "active" }); setStep(1); setDone(false); setPhotoPreview(null); setPhotoFile(null); setDraftId(null); setHighestStep(1); setShowErrors(false); }}
            className="px-5 py-2 rounded-[10px] text-[13px] font-[600] border border-[#E2E8F0] text-[#475569] bg-white hover:bg-[#f8fafc]"
          >
            Onboard another
          </button>
          <button
            onClick={() => { if (onClose) onClose(); else router.push("/hr/directory"); }}
            className="px-5 py-2 rounded-[10px] text-[13px] font-[700] text-white"
            style={{ background: "var(--brand)" }}
          >
            {isPopup ? "Close" : "View Directory"}
          </button>
        </div>
      </div>
    );
  }

  // Main layout
  return (
    <div className="flex flex-col" style={isPopup ? { paddingBottom: "20px" } : { paddingBottom: `${footerHeight}px`, marginLeft: "-20px", marginRight: "-20px", marginBottom: "-40px" }}>
      {/* Hidden photo file input */}
      <input ref={photoInputRef} type="file" accept="image/jpeg,image/jpg,image/png" className="hidden" onChange={handlePhotoChange} />

      {/* Camera capture modal */}
      {showCameraModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70" onClick={(e) => { if (e.target === e.currentTarget) closeCamera(); }}>
          <div className="bg-white rounded-[16px] p-6 w-[480px] max-w-[95vw] flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-[700] text-[#15172A]">Take Staff Photo</h3>
              <button
                type="button"
                onClick={closeCamera}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#F1F5F9] text-[#94A3B8] hover:text-[#475569]"
              >
                <X size={16} />
              </button>
            </div>

            {cameraErr ? (
              <div className="p-4 rounded-[10px] bg-[#FFF5F5] border border-[#FCA5A5] text-[13px] text-[#DC2626]">
                {cameraErr}
              </div>
            ) : (
              <div className="relative bg-black rounded-[10px] overflow-hidden" style={{ aspectRatio: "4/3" }}>
                <video
                  ref={cameraVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                />
                {/* Face guide overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-44 h-44 rounded-full border-2 border-white/50 border-dashed" />
                </div>
              </div>
            )}

            <p className="text-[12px] text-[#94A3B8] text-center -mt-1">
              Position the staff member&apos;s face within the circle, then tap Capture.
            </p>
            <p className="text-[11px] text-[#94A3B8] text-center -mt-3">
              JPG output · max 2 MB · min 100×100 px
            </p>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={closeCamera}
                className="px-4 py-2 rounded-[8px] text-[13px] font-[600] border border-[#E2E8F0] text-[#475569] bg-white hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={capturePhoto}
                disabled={!!cameraErr || !cameraStream}
                className="flex items-center gap-2 px-4 py-2 rounded-[8px] text-[13px] font-[700] text-white disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: "var(--brand)" }}
              >
                <Camera size={14} /> Capture
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Discard confirmation modal */}
      {discardConfirmOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setDiscardConfirmOpen(false); }}
        >
          <div className="bg-white rounded-[16px] p-6 w-[420px] max-w-[95vw] flex flex-col gap-3 shadow-2xl">
            <h3 className="text-[16px] font-[700] text-[#15172A]">Discard this staff onboarding?</h3>
            <p className="text-[13px] text-[#5B5E72] m-0">
              Everything you&apos;ve entered will be cleared and can&apos;t be recovered. Consider &quot;Save draft&quot; instead if you want to finish later.
            </p>
            <div className="flex gap-3 justify-end mt-2">
              <button
                type="button"
                onClick={() => setDiscardConfirmOpen(false)}
                className="px-4 py-2 rounded-[8px] text-[13px] font-[600] border border-[#E2E8F0] text-[#475569] bg-white hover:bg-[#f8fafc]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { resetFormToBlank(); setDiscardConfirmOpen(false); }}
                className="px-4 py-2 rounded-[8px] text-[13px] font-[700] text-white bg-[#EF4444] hover:bg-[#DC2626]"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unsaved-changes navigate-away modal (triggered by window.__navGuard) */}
      {unsavedNavModalOpen && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) { setUnsavedNavModalOpen(false); pendingNavRef.current = null; } }}
        >
          <div className="bg-white rounded-[16px] p-6 w-[440px] max-w-[95vw] flex flex-col gap-3 shadow-2xl">
            <h3 className="text-[16px] font-[700] text-[#15172A]">You have unsaved changes</h3>
            <p className="text-[13px] text-[#5B5E72] m-0">
              Save this staff member as a draft so you can finish later, or discard everything you&apos;ve entered.
            </p>
            <div className="flex flex-col gap-2 mt-2">
              <button
                type="button"
                onClick={saveDraftAndLeave}
                disabled={draftSaving}
                className="px-4 py-2 rounded-[8px] text-[13px] font-[700] text-white disabled:opacity-60"
                style={{ background: "var(--brand)" }}
              >
                {draftSaving ? "Saving…" : "💾 Save as draft & leave"}
              </button>
              <button
                type="button"
                onClick={discardAndLeave}
                className="px-4 py-2 rounded-[8px] text-[13px] font-[700] text-[#EF4444] border border-[#FCA5A5] bg-white hover:bg-red-50"
              >
                🗑 Discard & leave
              </button>
              <button
                type="button"
                onClick={() => { setUnsavedNavModalOpen(false); pendingNavRef.current = null; }}
                className="px-4 py-2 rounded-[8px] text-[13px] font-[600] border border-[#E2E8F0] text-[#475569] bg-white hover:bg-[#f8fafc]"
              >
                Cancel — stay on this page
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Drafts list modal */}
      {showDraftsModal && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDraftsModal(false); }}
        >
          <div className="bg-white rounded-[16px] p-6 w-[520px] max-w-[95vw] flex flex-col gap-4 shadow-2xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-[16px] font-[700] text-[#15172A]">Saved Drafts</h3>
              <button
                type="button"
                onClick={() => setShowDraftsModal(false)}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-[#F1F5F9] text-[#94A3B8] hover:text-[#475569]"
              >
                <X size={16} />
              </button>
            </div>

            {draftList.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-[#94A3B8]">
                No saved drafts yet. Start filling a form and click <strong>Save draft</strong> to create one.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {draftList.map((d) => (
                  <div
                    key={d.id}
                    className={`flex items-center justify-between p-3 rounded-[10px] border transition-colors ${draftId === d.id ? "border-[var(--brand)] bg-[var(--soft)]" : "border-[#E8E8F0] bg-[#F8FAFC]"}`}
                  >
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[13.5px] font-[700] text-[#15172A] truncate">{d.draft_name}</span>
                        {draftId === d.id && (
                          <span className="text-[9px] font-[800] uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-[4px] bg-[var(--brand)] text-white shrink-0">current</span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-[#94A3B8]">
                        Step {d.current_step} / {TOTAL} · {new Date(d.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleLoadDraft(d)}
                        className="px-3 py-1 rounded-[7px] text-[12px] font-[600] border border-[#E2E8F0] text-[#475569] bg-white hover:bg-[#f8fafc]"
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteDraft(d.id)}
                        disabled={deletingDraftId === d.id}
                        className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 text-[#94A3B8] hover:text-[#EF4444] disabled:opacity-50"
                      >
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="text-[11.5px] text-[#94A3B8] text-center">
              Up to 10 drafts · Photos are not saved in drafts (re-upload after loading)
            </p>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          {!isPopup && <div className="mb-2"><BackButton label="Back" /></div>}
          <h1 className="onboard-hero-title">
            Onboard a <span className="onboard-title-accent">staff member</span>
          </h1>
          <p className="onboard-hero-subtitle">
            Create a staff profile, assign department and role, collect statutory details, documents, payroll setup
            and attendance-ready access.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-3">
            {draftId && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-[#E8E8F0] text-[12px] font-[600] text-[#475569]"
                style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}
              >
                <span className="w-[7px] h-[7px] rounded-full bg-green-500 inline-block" />
                Draft saved
              </div>
            )}
            <div className="onboard-hero-kpi">
              <p className="onboard-hero-kpi-count">{staffCount}</p>
              <p className="onboard-hero-kpi-label">Current Staff</p>
            </div>
          </div>

          <div className="onboard-hero-actions-row">
            <button
              type="button"
              className="onboard-hero-action-btn onboard-hero-action-drafts"
              onClick={() => setShowDraftsModal(true)}
              title="View saved drafts"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="9" y1="13" x2="15" y2="13"/>
                <line x1="9" y1="17" x2="13" y2="17"/>
              </svg>
              <span>Drafts</span>
              {draftList.length > 0 && <span className="onboard-hero-action-badge">{draftList.length}</span>}
            </button>

            <button
              type="button"
              className="onboard-hero-action-btn onboard-hero-action-ai"
              onClick={() => toast("AI Assist coming soon", "info")}
              title="Get AI-powered help & suggestions"
            >
              <Sparkles size={14} />
              <span>AI Assist</span>
            </button>

            <button
              type="button"
              className="onboard-hero-action-btn onboard-hero-action-pdf"
              onClick={() => setVerificationFormOpen(true)}
              title="Preview & download the staff verification PDF"
            >
              <FileText size={14} />
              <span>PDF</span>
            </button>

            <button
              type="button"
              className="onboard-hero-action-btn onboard-hero-action-info"
              onClick={() => toast("Documents checklist: NIN, Photos, Certs, Offer letter", "info")}
              title="What documents & details will I need?"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="16" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <span>What I&apos;ll need</span>
            </button>
          </div>
        </div>
      </div>

      {/* QR Scan banner */}
      {showQrBanner && (
        <div className="onboard-scan-banner">
          <div className="onboard-scan-left">
            <div className="onboard-scan-icon-wrap">
              <QrCode size={18} />
            </div>
            <div>
              <p className="onboard-scan-title">Scan to pre-fill <span className="onboard-badge-new">NEW</span></p>
              <p className="onboard-scan-copy">
                Got Aadhaar QR, PAN, previous employment record, or joining form? Scan it once and staff onboarding fields will be prepared.
              </p>
            </div>
          </div>
          <div className="onboard-scan-actions">
            <button type="button" className="onboard-scan-now" onClick={() => toast("QR scanner coming soon", "info")}>Scan now</button>
            <button type="button" className="onboard-scan-dismiss" onClick={() => setShowQrBanner(false)}>X</button>
          </div>
        </div>
      )}

      {/* Sidebar + Step content */}
      <div className="flex gap-6 items-start">
        <WizardNav step={step} completedSteps={completedSteps} onGo={attemptNavigate} />

        <div className="flex-1 min-w-0">
          <div
            className="bg-white border border-[#E8E8F0] rounded-[14px] pt-[36px] pb-[28px] px-[48px] flex flex-col"
            style={{ boxShadow: "0 2px 8px -2px rgba(15,18,34,0.07)" }}
          >
            {/* Step card header */}
            <div className="onboard-section-card-header">
              <div>
                <h2 className="onboard-section-title">
                  {(() => {
                    const i = currentStep.label.lastIndexOf(" ");
                    if (i === -1) return <span className="onboard-title-accent">{currentStep.label}</span>;
                    return (
                      <>
                        {currentStep.label.slice(0, i)}{" "}
                        <span className="onboard-title-accent">{currentStep.label.slice(i + 1)}</span>
                      </>
                    );
                  })()}
                </h2>
                <p className="onboard-section-subtitle">{currentStep.sub}</p>
              </div>
              <span className="onboard-section-counter">{step}/{TOTAL}</span>
            </div>
            <div className="mb-6" />

            {/* Step content */}
            {step === 1 && (
              <StepIdentity
                f={form}
                set={setField}
                photoPreview={photoPreview}
                onPhotoClick={() => photoInputRef.current?.click()}
                onCameraClick={openCamera}
                onPhotoRemove={() => { setPhotoPreview(null); setPhotoFile(null); }}
                languages={langData ?? []}
                religions={relData ?? []}
                countries={countryData ?? []}
                langLoading={langLoading}
                relLoading={relLoading}
                countryLoading={countryLoading}
                langError={langError}
                relError={relError}
                countryError={countryError}
                maxDob={maxDobDate}
                minDob={minDobDate}
                todayDate={todayDate}
                showErrors={showErrors}
              />
            )}
            {step === 2 && <StepRole f={form} set={setField} departments={departments} designations={designations} roles={roles} staffList={staffList} empTypes={empTypeData ?? []} empLoading={empTypeLoading} empError={empTypeError} showErrors={showErrors} todayDate={todayDate} />}
            {step === 3 && <StepContact f={form} set={setField} showErrors={showErrors} />}
            {step === 4 && <StepFamily  f={form} set={setField} showErrors={showErrors} validatorRef={nomValidatorRef} />}
            {step === 5 && <StepGovId   f={form} set={setField} showErrors={showErrors} apiFieldErrors={apiFieldErrors} />}
            {step === 6 && <StepQualifications f={form} set={setField} validatorRef={prevDateValidatorRef} />}
            {step === 7 && <StepMedical f={form} set={setField} validatorRef={medValidatorRef} />}
            {step === 8 && <StepPayroll f={form} set={setField} validatorRef={payrollValidatorRef} />}
            {step === 9 && <StepDocuments validatorRef={docValidatorRef} externalDocs={staffDocumentsData?.results} editingStaffId={editingStaffId} />}
            {step === 10 && <StepReview f={form} set={setField} departments={departments} designations={designations} />}

          </div>
        </div>
      </div>

      {/* Sticky footer bar */}
      <div
        ref={footerRef}
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-[#ececf2] z-[100]"
        style={{ boxShadow: "0 -4px 12px rgba(15, 23, 42, 0.05)", padding: "18px 28px" }}
      >
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="onboard-footer-progress-wrap" aria-label="Onboarding progress">
            <span style={{ fontSize: 13, color: "#6b7280", whiteSpace: "nowrap", flexShrink: 0 }}>Progress</span>
            <div className="onboard-footer-progress-track" title="Onboarding progress">
              <span className="onboard-footer-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span className="onboard-footer-progress-value">{progress}% complete</span>
          </div>

          {/* Secondary/utility actions — free to wrap on narrow viewports without
              ever pushing Back/Next off-screen (they live in their own pinned group). */}
          <div className="flex items-center gap-2 flex-wrap justify-end flex-1 min-w-0">
            <button
              type="button"
              className="btn-discard"
              onClick={() => { if (isFormDirty) setDiscardConfirmOpen(true); else resetFormToBlank(); }}
            >
              Discard
            </button>
            <button
              type="button"
              className="btn-draft"
              onClick={() => void handleSaveDraft()}
              disabled={draftSaving}
            >
              {draftSaving ? "Saving…" : draftId ? "Update draft" : "Save draft"}
            </button>
            <input
              ref={signedFormInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/jpg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleSignedFormUpload(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="btn-outline"
              style={{ fontSize: 11, padding: "6px 10px", background: "#ecfdf5", color: "#065f46", borderColor: "#6ee7b7" }}
              title="Upload a signed onboarding acknowledgment (PDF or image)"
              onClick={() => signedFormInputRef.current?.click()}
              disabled={signedFormUploading}
            >
              <Upload size={11} /> {signedFormUploading ? "Uploading…" : "Upload signed"}
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ fontSize: 11, padding: "6px 10px", background: "#fffbeb", color: "#92400e", borderColor: "#fcd34d" }}
              title="Download a blank onboarding form"
              onClick={handleBlankForm}
              disabled={blankFormDownloading}
            >
              <FileText size={11} /> {blankFormDownloading ? "Generating…" : "Blank form"}
            </button>
            <button
              type="button"
              className="btn-outline"
              style={{ fontSize: 11, padding: "6px 10px", background: "#eff6ff", color: "#1e40af", borderColor: "#93c5fd" }}
              title="Scan a filled form to auto-fill fields via OCR"
              onClick={() => setScanFillOpen(true)}
            >
              <QrCode size={11} /> Scan &amp; fill
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setVerificationFormOpen(true)}
            >
              <Printer size={11} /> Print / PDF
            </button>
            {step > 1 && (
              <button type="button" className="btn-outline" onClick={goPrev}>
                Back
              </button>
            )}
            {step < TOTAL ? (
              <button type="button" className="btn-save-cta" onClick={goNext}>
                {ALL_STEPS[step]?.label} →
              </button>
            ) : (
              <button type="button" className="btn-save-cta" onClick={() => void handleSubmit()} disabled={saving}>
                {saving ? "Saving..." : editingStaffId ? "Update & Onboard" : "Submit & Onboard"}
              </button>
            )}
          </div>
        </div>
      </div>

      {verificationFormOpen && (
        <StaffVerificationForm
          onClose={() => setVerificationFormOpen(false)}
          saving={filledFormDownloading}
          onSavePdf={handleFilledForm}
          staff={{
            photo: photoPreview ?? undefined,
            first_name: form.first_name,
            middle_name: form.middle_name,
            last_name: form.last_name,
            staff_code: form.staff_no,
            date_of_birth: form.date_of_birth,
            gender: form.gender,
            blood_group_input: form.blood_group_input,
            mother_tongue: form.mother_tongue,
            religion: form.religion,
            nationality: form.nationality,
            status: form.status,
            departmentName: departments.find((d) => String(d.id) === String(form.department))?.name,
            designationName: designations.find((d) => String(d.id) === String(form.designation))?.name,
            role: roles.find((r) => String(r.id) === String(form.role))?.name ?? (form.role != null ? String(form.role) : undefined),
            joining_date: form.joining_date,
            employment_type: form.employment_type,
            reporting_manager: (() => {
              const m = staffList.find((s) => String(s.id) === String(form.reporting_manager));
              return m ? `${m.first_name} ${m.last_name}`.trim() : undefined;
            })(),
            mobile: form.mobile,
            personal_email: form.personal_email,
            official_email: form.official_email,
            current_address_line1: form.current_address,
            current_city: form.city,
            current_state: form.state,
            current_pin: form.current_pin,
            emergency_name: form.emergency_name,
            emergency_relation: form.emergency_relation,
            emergency_phone: form.emergency_phone,
            aadhaar_number: form.nin,
            pan_number: form.pan,
            bank_name: form.bank_name,
            bank_account_number: form.bank_account_no,
            ifsc_code: form.ifsc_code,
          }}
        />
      )}

      {scanFillOpen && (
        <ScanFillModal
          fieldGroups={STAFF_FIELD_GROUPS}
          documentLabel="staff onboarding form"
          onClose={() => setScanFillOpen(false)}
          onApply={(results) => {
            Object.entries(results).forEach(([key, value]) => {
              if (value) setField(key, value);
            });
          }}
        />
      )}

      {/* Visual system copied from the Student Enroll page (StudentAddPanel.tsx)
          so this page is a pixel match. `global` because several sections below
          (StepIdentity, StepRole, etc.) are separate top-level functions in this
          file — styled-jsx's normal per-component scoping wouldn't reach them. */}
      <style jsx global>{`
        .onboard-hero-title {
          margin: 0;
          font-size: 28px;
          font-weight: 900;
          font-family: var(--serif);
          letter-spacing: -0.01em;
          line-height: 1.2;
          color: #15172A;
        }
        .onboard-title-accent {
          color: var(--brand);
          font-style: italic;
          font-family: var(--serif);
          font-weight: 400;
        }
        .onboard-hero-subtitle {
          max-width: 520px;
          color: #5B5E72;
          line-height: 1.5;
          margin-top: 4px;
          font-size: 13px;
        }
        .onboard-hero-kpi { text-align: right; }
        .onboard-hero-kpi-count { font-size: 28px; font-weight: 900; margin: 0; color: #15172A; line-height: 1; }
        .onboard-hero-kpi-label { margin: 4px 0 0; font-size: 9.5px; letter-spacing: 0.1em; color: #94A3B8; font-weight: 700; text-transform: uppercase; }

        .onboard-hero-actions-row { display: flex; gap: 8px; align-items: center; }
        .onboard-hero-action-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 10px;
          font-size: 12.5px;
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease;
          border: 1px solid transparent;
        }
        .onboard-hero-action-btn:hover { transform: translateY(-1px); }
        .onboard-hero-action-btn:active { transform: translateY(0); }
        .onboard-hero-action-drafts { background: #fff; border-color: #E2E8F0; color: #475569; }
        .onboard-hero-action-drafts:hover { background: #fff; border-color: #c7d2fe; box-shadow: 0 4px 14px -4px rgba(99,102,241,0.25); }
        .onboard-hero-action-pdf { background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%); border-color: #ddd6fe; color: #6c3ce1; }
        .onboard-hero-action-pdf:hover { background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%); border-color: #c4b5fd; box-shadow: 0 6px 18px -6px rgba(108,60,225,0.35); }
        .onboard-hero-action-info { background: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%); border-color: #a5f3fc; color: #0e7490; }
        .onboard-hero-action-info:hover { background: linear-gradient(135deg, #cffafe 0%, #a5f3fc 100%); border-color: #67e8f9; box-shadow: 0 4px 14px -4px rgba(8,145,178,0.3); }
        .onboard-hero-action-ai {
          background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
          color: #fff; border-color: transparent;
          box-shadow: 0 4px 14px -3px rgba(139,92,246,0.45);
        }
        .onboard-hero-action-ai:hover { box-shadow: 0 8px 22px -4px rgba(236,72,153,0.55); background: linear-gradient(135deg, #7c3aed 0%, #db2777 100%); }
        .onboard-hero-action-badge {
          background: rgba(108,60,225,0.12); color: #6c3ce1; font-size: 10px; font-weight: 700;
          padding: 2px 6px; border-radius: 999px; margin-left: 2px; min-width: 16px; text-align: center;
        }

        .onboard-scan-banner {
          background: #1a1a2e; border-radius: 12px; padding: 20px 24px; margin: 0 0 20px;
          display: flex; align-items: center; justify-content: space-between; gap: 16px;
        }
        .onboard-scan-left { display: flex; gap: 16px; align-items: flex-start; }
        .onboard-scan-icon-wrap {
          width: 40px; height: 40px; border-radius: 8px; background: rgba(108, 60, 225, 0.8);
          color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; flex-shrink: 0;
        }
        .onboard-scan-title { color: #fff; font-size: 15px; font-weight: 700; margin: 0; }
        .onboard-badge-new { margin-left: 8px; background: #10b981; color: #fff; border-radius: 999px; padding: 2px 8px; font-size: 10px; font-weight: 600; }
        .onboard-scan-copy { color: #9ca3af; margin: 4px 0 0; font-size: 13px; line-height: 1.5; }
        .onboard-scan-actions { display: flex; align-items: center; gap: 12px; }
        .onboard-scan-now { border: none; background: var(--brand); color: #fff; border-radius: 8px; padding: 10px 20px; cursor: pointer; font-weight: 700; font-size: 13px; }
        .onboard-scan-dismiss { width: 32px; height: 32px; border-radius: 6px; border: none; background: rgba(255, 255, 255, 0.15); color: #fff; cursor: pointer; }

        .onboard-section-nav-wrap { position: sticky; top: 108px; width: 280px; height: fit-content; flex-shrink: 0; align-self: flex-start; }
        .onboard-section-nav-list { list-style: none; margin: 0; padding: 0; }
        .onboard-nav-group-heading { padding: 20px 8px 6px; font-size: 10px; font-weight: 900; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.13em; }
        .onboard-nav-item { position: relative; margin-bottom: 4px; }
        .onboard-nav-item-inner {
          width: 100%; border: none; background: transparent; display: flex; align-items: flex-start;
          gap: 12px; padding: 8px 12px 8px 8px; border-radius: 6px; cursor: pointer; text-align: left;
        }
        .onboard-nav-item-inner:hover { background: #f3f4f6; }
        .onboard-nav-bullet {
          width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
          font-size: 11px; font-weight: 900; background: #f3f4f6; color: #9ca3af; border: 1px solid #e5e7eb; flex-shrink: 0;
        }
        .onboard-nav-label { font-size: 13.5px; color: #1f2937; font-weight: 600; line-height: 1.25; }
        .onboard-nav-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
        .onboard-nav-copy { font-size: 11.5px; color: #6b7280; line-height: 1.3; }
        .onboard-nav-item.active::before {
          content: ""; position: absolute; left: 0; top: 4px; bottom: 4px; width: 3px;
          border-radius: 0 2px 2px 0; background: var(--brand);
        }
        .onboard-nav-item.active .onboard-nav-bullet { background: var(--brand); color: #fff; border-color: var(--brand); }
        .onboard-nav-item.active .onboard-nav-item-inner { background: #f5f3ff; }
        .onboard-nav-item.active .onboard-nav-label { color: var(--brand); font-weight: 700; }
        .onboard-nav-item.active .onboard-nav-copy { color: #6d28d9; }
        .onboard-nav-item.done .onboard-nav-bullet { background: #22C55E; color: #fff; border-color: #22C55E; }
        .onboard-nav-item.done .onboard-nav-label { color: #15172A; }

        .onboard-heads-up-card { margin: 14px 14px 16px; background: #ede9fe; border-radius: 8px; padding: 12px 14px; }
        .onboard-heads-up-title { margin: 0 0 4px; font-size: 13px; font-weight: 700; color: #15172A; }
        .onboard-heads-up-body { margin: 0; font-size: 12px; color: #6b7280; line-height: 1.5; }

        .onboard-section-card-header { display: flex; justify-content: space-between; align-items: flex-start; }
        .onboard-section-title {
          font-size: 24px; margin: 0; font-weight: 800; font-family: var(--serif);
          letter-spacing: -0.01em; line-height: 1.2; color: #15172A;
        }
        .onboard-section-subtitle { margin: 6px 0 0; font-size: 13px; color: #94A3B8; }
        .onboard-section-counter { font-size: 13px; font-weight: 700; color: #94A3B8; margin-left: 16px; white-space: nowrap; }

        .field-wrapper { min-width: 0; }
        .field-label { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500; color: #374151; margin-bottom: 6px; }
        .req { color: #dc2626; font-weight: 700; }
        .field-input, .field-select, .field-textarea {
          width: 100%; min-width: 0; max-width: 100%; padding: 10px 12px; border: 1px solid #d1d5db;
          border-radius: 8px; font-size: 14px; background: #fff; box-sizing: border-box;
        }
        .field-input:focus, .field-select:focus, .field-textarea:focus {
          border-color: var(--brand); box-shadow: 0 0 0 3px rgba(108, 60, 225, 0.12); outline: none;
        }
        .field-input.error, .field-select.error, .field-textarea.error { border-color: #dc2626; background: #fef2f2; }
        .field-input:disabled, .field-input[readonly] { background: #f3f4f6; color: #94A3B8; cursor: not-allowed; }
        .help-text { font-size: 12px; color: #6b7280; margin-top: 4px; }
        .error-msg { font-size: 12px; color: #dc2626; margin: 4px 0 0; display: block; }
        .status-info { font-size: 12px; color: #6b7280; margin: 4px 0 0; }

        .onboard-photo-upload-block { display: flex; align-items: flex-start; gap: 24px; margin-bottom: 24px; }
        .onboard-photo-circle {
          width: 128px; height: 128px; border-radius: 50%; border: 2px dashed #d1d5db; background: #fafafa;
          display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; padding: 0; flex-shrink: 0;
        }
        .onboard-photo-circle.has-photo { border: none; overflow: hidden; }
        .onboard-photo-circle img { width: 100%; height: 100%; object-fit: cover; }
        .onboard-camera-icon { font-size: 26px; color: #9ca3af; }
        .onboard-photo-label { font-size: 9px; letter-spacing: 0.12em; color: #9ca3af; margin-top: 6px; }
        .onboard-photo-title { margin: 0 0 4px; font-size: 14px; font-weight: 700; color: #15172A; }
        .onboard-photo-desc { margin: 0 0 12px; font-size: 12px; color: #6b7280; line-height: 1.4; }
        .onboard-photo-actions { display: flex; gap: 12px; }
        .btn-upload-file { padding: 7px 14px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; cursor: pointer; color: #374151; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }
        .btn-take-photo { border: none; background: none; color: var(--brand); text-decoration: underline; cursor: pointer; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; }

        .onboard-footer-progress-wrap { display: flex; align-items: center; gap: 12px; flex: 1 1 260px; min-width: 0; overflow: hidden; }
        .onboard-footer-progress-track { position: relative; flex: 0 0 180px; width: 180px; height: 6px; border-radius: 999px; background: #e5e7eb; overflow: hidden; }
        .onboard-footer-progress-fill { display: block; height: 100%; border-radius: 999px; background: linear-gradient(90deg, #6c3ce1 0%, #4f39f6 100%); transition: width 0.25s ease; }
        .onboard-footer-progress-value { font-size: 13px; font-weight: 600; color: #6b7280; white-space: nowrap; }
        .btn-discard { border: none; background: transparent; color: #6b7280; cursor: pointer; font-size: 13px; padding: 8px 4px; white-space: nowrap; }
        .btn-discard:hover { color: #374151; }
        .btn-draft { padding: 10px 18px; border: 1px solid #d1d5db; border-radius: 12px; background: #fff; color: #374151; cursor: pointer; font-size: 13px; }
        .btn-draft:hover { border-color: #9ca3af; background: #f9fafb; }
        .btn-draft:disabled { opacity: 0.6; cursor: not-allowed; }
        .btn-outline {
          padding: 10px 16px; border: 1px solid var(--brand); border-radius: 12px; background: transparent;
          color: var(--brand); cursor: pointer; font-size: 13px; font-weight: 500; transition: background 140ms ease;
          display: inline-flex; align-items: center; gap: 6px;
        }
        .btn-outline:hover:not(:disabled) { background: rgba(108,60,225,.06); }
        .btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn-save-cta {
          padding: 10px 22px; border: 1px solid var(--brand); background: var(--brand); color: #fff;
          border-radius: 12px; cursor: pointer; font-size: 13px; font-weight: 700; box-shadow: 0 8px 22px rgba(79, 57, 246, 0.2);
        }
        .btn-save-cta:hover:not(:disabled) { background: #5a2ee0; border-color: #5a2ee0; }
        .btn-save-cta:disabled { opacity: 0.45; cursor: not-allowed; box-shadow: none; }
      `}</style>
    </div>
  );
}

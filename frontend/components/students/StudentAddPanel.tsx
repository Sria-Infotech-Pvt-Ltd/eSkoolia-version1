"use client";

import { Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiRequestWithRefresh, apiRequestWithRefreshResponse } from "@/lib/api-auth";
import { StudentDocumentsUpload, type DocumentType as DocumentTypeKey, type CustomDocMeta, type MarksheetMeta } from "./StudentDocumentsUpload";
import { ConsentForm } from "./ConsentForm";
import { ScanFillModal, STUDENT_FIELD_GROUPS } from "./ScanFillModal";
import {
  StudentGuardiansStep,
  makeEmptyGuardianDraft,
  normalizeRelation,
  type GuardianDraft,
  type GuardianFieldErrors,
} from "./StudentGuardiansStep";
import StudentFeesStep, { EMPTY_FEE_PLAN, type FeePlanState, type FeePlanSummary, type StudentFeesStepHandle } from "./StudentFeesStep";
import { feesApi, type FeesAssignment } from "@/lib/fees-api";

type ApiList<T> = T[] | { results?: T[]; count?: number };

type StudentCategory = {
  id: number;
  name: string;
};

type Guardian = {
  id: number;
  full_name: string;
  relation: string;
  phone: string;
  email?: string;
  occupation?: string;
};

type SchoolClass = {
  id: number;
  name: string;
};

type AcademicYear = {
  id: number;
  name: string;
  is_current?: boolean;
};

type Section = {
  id: number;
  school_class: number;
  name: string;
};

type StudentCreatePayload = {
  admission_no: string;
  roll_no?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  date_of_birth?: string;
  academic_year: number;
  gender: string;
  custom_gender?: string;
  blood_group?: string;
  phone?: string;
  email?: string;
  address_line?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  photo?: string;
  status: "active" | "inactive" | "transferred" | "dropped";
  category?: number;
  student_group?: number;
  guardian?: number;
  guardians?: Array<{ id: number; is_primary: boolean }>;
  current_class: number;
  current_section: number;
  is_disabled: boolean;
  is_active: boolean;
  is_draft?: boolean;
  landmark?: string;
  transport_modes?: string[];
  transport_custom?: string;
  mother_tongue?: string;
  other_mother_tongue?: string;
  religion?: string;
  nationality?: string;
  other_nationality?: string;
  admission_type?: string;
  previous_school_name?: string;
  rte_certificate_no?: string;
  stream?: string;
  apaar_id?: string;
  aadhaar_no?: string;
  pen?: string;
  digilocker_mobile?: string;
  abc_id?: string;
  height_cm?: string;
  weight_kg?: string;
  vision?: string;
  medical_conditions?: string[];
  allergies?: string[];
  current_medications?: string;
  treating_doctor?: string;
  vaccinations?: string[];
  medical_notes?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  is_pwd?: boolean;
  disability_types?: string[];
  disability_percent?: number;
  udid?: string;
  disability_accommodations?: string[];
  disability_notes?: string;
  other_disability_text?: string;
  identity_marks?: Array<{ location: string; description: string }>;
  eye_colour?: string;
  hair_colour?: string;
  complexion?: string;
  build?: string;
};

type StudentCreateResponse = {
  id?: number;
  message?: string;
  warning?: string;
  admission_no?: string;
  roll_no?: string;
  data?: {
    id?: number;
  };
};

type StudentDetail = {
  id: number;
  admission_no: string;
  roll_no?: string;
  first_name: string;
  middle_name?: string;
  last_name: string;
  date_of_birth?: string;
  academic_year?: number;
  gender?: string;
  custom_gender?: string;
  blood_group?: string;
  phone?: string;
  email?: string;
  address_line?: string;
  city?: string;
  district?: string;
  state?: string;
  pincode?: string;
  photo?: string;
  status?: "active" | "inactive" | "transferred" | "dropped";
  category?: number | null;
  student_group?: number | null;
  guardian?: number | null;
  guardians?: Array<{
    id: number;
    full_name?: string;
    relation?: string;
    phone?: string;
    email?: string;
    occupation?: string;
    is_primary?: boolean;
  }>;
  current_class?: number | null;
  current_section?: number | null;
  is_disabled?: boolean;
  documents?: Array<{
    id: number;
    document_type: string;
    file_url?: string | null;
    original_name?: string;
    uploaded_at?: string;
  }>;
  landmark?: string;
  transport_modes?: string[];
  transport_custom?: string;
  mother_tongue?: string;
  other_mother_tongue?: string;
  religion?: string;
  nationality?: string;
  other_nationality?: string;
  admission_type?: string;
  previous_school_name?: string;
  rte_certificate_no?: string;
  stream?: string;
  apaar_id?: string;
  aadhaar_no?: string;
  pen?: string;
  digilocker_mobile?: string;
  abc_id?: string;
  height_cm?: string | number | null;
  weight_kg?: string | number | null;
  vision?: string;
  medical_conditions?: string[];
  allergies?: string[];
  current_medications?: string;
  treating_doctor?: string;
  vaccinations?: string[];
  medical_notes?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  is_pwd?: boolean;
  disability_types?: string[];
  disability_percent?: number | null;
  udid?: string;
  disability_accommodations?: string[];
  disability_notes?: string;
  other_disability_text?: string;
  identity_marks?: Array<{ location: string; description: string }>;
  eye_colour?: string;
  hair_colour?: string;
  complexion?: string;
  build?: string;
};

type ApiError = Error & {
  details?: {
    field_errors?: Record<string, string | string[]>;
    message?: string;
  };
  status?: number;
};

type MePayload = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
};

type PincodeLookupResponse = {
  success?: boolean;
  message?: string;
  data?: {
    pincode?: string;
    state?: string;
    district?: string;
    city?: string;
    city_options?: string[];
    multiple_post_offices?: boolean;
    selected_post_office?: {
      name?: string;
      branch_type?: string;
      delivery_status?: string;
      district?: string;
      state?: string;
      region?: string;
      division?: string;
      circle?: string;
      taluk?: string;
      block?: string;
      country?: string;
      pincode?: string;
    };
    post_offices?: Array<{
      name?: string;
      branch_type?: string;
      delivery_status?: string;
      district?: string;
      state?: string;
      region?: string;
      division?: string;
      circle?: string;
      taluk?: string;
      block?: string;
      country?: string;
      pincode?: string;
    }>;
  };
};

const DEFAULT_STATE_CITY_MAP: Record<string, string[]> = {
  "Andhra Pradesh": ["Vijayawada", "Guntur", "Visakhapatnam"],
  Telangana: ["Hyderabad", "Warangal", "Karimnagar"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai"],
  Karnataka: ["Bengaluru", "Mysuru", "Mangaluru"],
  Maharashtra: ["Mumbai", "Pune", "Nagpur"],
  Gujarat: ["Ahmedabad", "Surat", "Vadodara"],
  Rajasthan: ["Jaipur", "Jodhpur", "Kota"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi"],
  "Madhya Pradesh": ["Bhopal", "Indore", "Gwalior"],
  Kerala: ["Kochi", "Thiruvananthapuram", "Kozhikode"],
};

const CLASS_ORDER = ["LKG", "UKG", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

const MOTHER_TONGUES = [
  "Hindi",
  "English",
  "Bengali",
  "Telugu",
  "Marathi",
  "Tamil",
  "Urdu",
  "Gujarati",
  "Kannada",
  "Malayalam",
  "Odia",
  "Punjabi",
  "Assamese",
  "Maithili",
  "Sanskrit",
  "Konkani",
  "Nepali",
  "Sindhi",
  "Dogri",
  "Manipuri",
  "Bodo",
  "Santali",
  "Kashmiri",
  "Other",
];

type NavBadge = 'GOI' | 'NEW' | 'SENSITIVE';
type NavGroup = 'health-identity';

const NAV_ITEMS: ReadonlyArray<{ id: string; label: string; description: string; badge?: NavBadge; group?: NavGroup }> = [
  { id: 'identity',       label: 'Student identity',    description: 'Basic profile, DOB, photo' },
  { id: 'academic',       label: 'Academic placement',  description: 'Class, section, year' },
  { id: 'contact',        label: 'Contact & address',   description: 'Phone, email, location' },
  { id: 'guardians',      label: 'Family & guardians',  description: 'Parent/guardian details' },
  { id: 'apaar',          label: 'Government identity', description: 'Government identity',        badge: 'GOI' },
  { id: 'documents',      label: 'Documents',           description: 'Consent and student records' },
  { id: 'medical',        label: 'Medical & emergency', description: 'Health, vaccinations',       badge: 'NEW',       group: 'health-identity' },
  { id: 'speciallyAbled', label: 'Specially abled',     description: 'PwD accommodations',         badge: 'NEW',       group: 'health-identity' },
  { id: 'identityMarks',  label: 'Identity marks',      description: 'Physical identifiers',       badge: 'SENSITIVE', group: 'health-identity' },
  { id: 'fees',           label: 'Fee plan',            description: 'Assign fees & concessions' },
  { id: 'review',         label: 'Review',              description: 'Confirm & enroll' },
];

const STATE_TONGUE_MAP: Record<string, string> = {
  "Tamil Nadu": "Tamil",
  "Kerala": "Malayalam",
  "Karnataka": "Kannada",
  "Andhra Pradesh": "Telugu",
  "Telangana": "Telugu",
  "Maharashtra": "Marathi",
  "Gujarat": "Gujarati",
  "Punjab": "Punjabi",
  "West Bengal": "Bengali",
  "Odisha": "Odia",
  "Assam": "Assamese",
  "Bihar": "Hindi",
  "Uttar Pradesh": "Hindi",
  "Madhya Pradesh": "Hindi",
  "Rajasthan": "Hindi",
  "Haryana": "Hindi",
  "Delhi": "Hindi",
  "Jharkhand": "Hindi",
  "Chhattisgarh": "Hindi",
  "Uttarakhand": "Hindi",
  "Himachal Pradesh": "Hindi",
  "Jammu and Kashmir": "Kashmiri",
  "Goa": "Konkani",
  "Manipur": "Manipuri",
  "Meghalaya": "English",
  "Mizoram": "English",
  "Nagaland": "English",
  "Tripura": "Bengali",
  "Sikkim": "Nepali",
  "Arunachal Pradesh": "English",
};

const COMMON_VACCINATIONS = [
  { id: "bcg", label: "BCG" },
  { id: "opv", label: "OPV" },
  { id: "hepb", label: "Hepatitis B" },
  { id: "dpt", label: "DPT" },
  { id: "mmr", label: "MMR" },
  { id: "tdap", label: "Tdap booster" },
  { id: "hpv", label: "HPV" },
];

type NavItemId = 'identity' | 'academic' | 'contact' | 'guardians' | 'apaar' | 'documents' | 'medical' | 'speciallyAbled' | 'identityMarks' | 'fees' | 'review';

// Matches backend/apps/students/serializers.py::StudentSerializer.CLASS_AGE_RULES
// exactly (grade -> [min age, max age] as of today) — kept as a single module-level
// constant (not re-created per render) so every frontend consumer of this rule
// (the live classAgeWarning check, the AI-assist "clearIf" nudge) uses the same
// object and can never quietly drift from what the backend actually enforces.
const CLASS_AGE_RULES: Record<number, [number, number]> = {
  1: [5, 7],
  2: [6, 8],
  3: [7, 9],
  4: [8, 10],
  5: [9, 11],
  6: [10, 12],
  7: [11, 13],
  8: [12, 14],
  9: [13, 15],
  10: [14, 16],
  11: [15, 17],
  12: [16, 18],
};

function toTitleCase(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDobDisplayFromISO(value: string): string {
  if (!value) return "";
  const parts = value.split("-");
  if (parts.length !== 3) return "";
  return `${parts[2]} / ${parts[1]} / ${parts[0]}`;
}

function toDobMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length <= 2) return dd;
  if (digits.length <= 4) return `${dd} / ${mm}`;
  return `${dd} / ${mm} / ${yyyy}`;
}

function parseDobMaskedToISO(masked: string): string {
  const digits = masked.replace(/\D/g, "");
  if (digits.length !== 8) return "";
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  if (date.getFullYear() !== Number(yyyy) || date.getMonth() + 1 !== Number(mm) || date.getDate() !== Number(dd)) return "";
  return `${yyyy}-${mm}-${dd}`;
}

function getDraftTimeAgoText(dateValue: number | null): string {
  if (!dateValue) return "Draft not saved yet";
  const diffMs = Math.max(0, Date.now() - dateValue);
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return "Draft saved just now";
  if (mins === 1) return "Draft saved 1m ago";
  return `Draft saved ${mins}m ago`;
}

let cachedGeneratedAdmissionNo: string | null = null;
let pendingAdmissionNoRequest: Promise<string> | null = null;

function isProgressFieldFilled(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return Boolean(value);
}

interface CompletionCheckFields {
  firstName?: unknown;
  lastName?: unknown;
  dateOfBirth?: unknown;
  gender?: unknown;
  classId?: unknown;
  sectionId?: unknown;
  sectionLater?: unknown;
  phone?: unknown;
  addressLine?: unknown;
  pincode?: unknown;
  guardianFullName?: unknown;
  guardianPhone?: unknown;
  consentChecked?: unknown;
}

// Single definition of "% complete" for a student enrollment, used everywhere
// a percentage is shown — the footer progress bar, the "AI Assist" modal, and
// the Drafts panel card. Previously each of those three computed its own
// percentage from a different field list (and the Drafts panel additionally
// hard-capped at 99%), so the same record could show 100% / 60% / 99%
// simultaneously (QA #8). Takes a plain field bag rather than reading
// component state directly so it works both for live form state and for a
// draft snapshot restored from localStorage.
function computeCompletionPercent(f: CompletionCheckFields): number {
  const str = (v: unknown) => (typeof v === "string" ? v : "").trim();
  const checks = [
    Boolean(str(f.firstName)),
    Boolean(str(f.lastName)),
    Boolean(str(f.dateOfBirth)),
    Boolean(str(f.gender)),
    Boolean(str(f.classId)),
    Boolean(str(f.sectionId) || f.sectionLater),
    Boolean(str(f.phone) && /^\d{10}$/.test(str(f.phone))),
    Boolean(str(f.addressLine)),
    Boolean(str(f.pincode) && /^\d{6}$/.test(str(f.pincode))),
    Boolean(str(f.guardianFullName)),
    Boolean(str(f.guardianPhone)),
    Boolean(f.consentChecked),
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function listData<T>(value: ApiList<T>): T[] {
  return Array.isArray(value) ? value : value.results || [];
}

async function fetchAllPages<T>(basePath: string, pageSize = 100): Promise<T[]> {
  let page = 1;
  const rows: T[] = [];
  while (page <= 50) {
    const separator = basePath.includes("?") ? "&" : "?";
    const payload = await apiGet<ApiList<T>>(`${basePath}${separator}page=${page}&page_size=${pageSize}`);
    const items = listData(payload);
    rows.push(...items);
    if (items.length < pageSize) break;
    page += 1;
  }
  return rows;
}

async function apiGet<T>(path: string): Promise<T> {
  // Background/lookup reads only in this file — a stray 401 here must not force-logout
  // the user and wipe an in-progress enrollment form. The actual submit calls below
  // default to a hard redirect (silent401 not set) so a truly expired session still logs out.
  return apiRequestWithRefresh<T>(path, { headers: { "Content-Type": "application/json" }, silent401: true });
}

async function apiPostJson<T>(path: string, payload: unknown, silent401 = false): Promise<T> {
  return apiRequestWithRefresh<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    silent401,
  });
}

async function apiPutJson<T>(path: string, payload: unknown, silent401 = false): Promise<T> {
  return apiRequestWithRefresh<T>(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    silent401,
  });
}

async function apiDeleteJson<T>(path: string, silent401 = true): Promise<T> {
  return apiRequestWithRefresh<T>(path, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    silent401,
  });
}

async function apiPostForm<T>(path: string, formData: FormData, silent401 = false): Promise<T> {
  return apiRequestWithRefresh<T>(path, {
    method: "POST",
    body: formData,
    silent401,
  });
}

async function fetchNextAdmissionNoFromApi(): Promise<string> {
  if (cachedGeneratedAdmissionNo) {
    return cachedGeneratedAdmissionNo;
  }

  if (!pendingAdmissionNoRequest) {
    pendingAdmissionNoRequest = (async () => {
      const payload = await apiGet<{ success?: boolean; admission_no?: string }>("/api/v1/students/students/next-admission-no/");
      const admissionNo = String(payload?.admission_no || "").trim();
      if (!admissionNo) {
        throw new Error("Unable to fetch next admission number.");
      }
      cachedGeneratedAdmissionNo = admissionNo;
      return admissionNo;
    })();
  }

  try {
    return await pendingAdmissionNoRequest;
  } finally {
    pendingAdmissionNoRequest = null;
  }
}

function invalidateGeneratedAdmissionNoCache(): void {
  cachedGeneratedAdmissionNo = null;
}

function boxStyle() {
  return {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius)",
    padding: 16,
  } as const;
}

function buttonStyle(color = "var(--primary)") {
  return {
    minHeight: 40,
    border: `1px solid ${color}`,
    background: color,
    color: "#fff",
    borderRadius: 10,
    padding: "0 14px",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: 14,
  } as const;
}

function parseError(error: unknown) {
  const apiError = error as ApiError;
  const message = apiError?.details?.message;
  if (message) return message;
  if (error instanceof Error && error.message) return error.message;
  return "Unable to complete request.";
}

function getErrorStatus(error: unknown): number | null {
  const apiError = error as ApiError;
  if (typeof apiError?.status === "number") {
    return apiError.status;
  }
  if (error instanceof Error) {
    const match = error.message.match(/status\s+(\d{3})/i);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

function parseEnrollmentSaveError(error: unknown): string {
  const fieldMessages = parseFieldErrors(error);
  if (fieldMessages.length > 0) {
    return fieldMessages[0];
  }

  const directMessage = parseError(error);
  const status = getErrorStatus(error);
  const genericStatusMessage = /^Request failed with status\s+\d{3}$/i.test(directMessage);

  if (!genericStatusMessage && directMessage) {
    return directMessage;
  }

  switch (status) {
    case 400:
    case 422:
      return "Unable to save student. Please review the form fields and try again.";
    case 401:
      return "Your session expired. Please log in again and retry saving the student.";
    case 403:
      return "You do not have permission to enroll students.";
    case 404:
      return "Unable to save student right now. Enrollment service was not found (404). Please refresh and try again.";
    case 409:
      return "Unable to save student due to a duplicate/conflict record. Please verify admission and roll numbers.";
    case 500:
    case 502:
    case 503:
    case 504:
      return "Server is temporarily unavailable while saving student. Please try again in a moment.";
    default:
      return "Unable to save student. Please try again.";
  }
}

function parseFieldErrors(error: unknown): string[] {
  const apiError = error as ApiError;
  const source = apiError?.details?.field_errors;
  if (!source) return [];

  const errors: string[] = [];
  for (const [field, value] of Object.entries(source)) {
    const fieldLabel = field.replace(/_/g, " ");
    if (Array.isArray(value)) {
      const first = String(value[0] || "").trim();
      if (first) errors.push(`${fieldLabel}: ${first}`);
      continue;
    }
    const text = String(value || "").trim();
    if (text) errors.push(`${fieldLabel}: ${text}`);
  }
  return errors;
}

function parsePincodeError(error: unknown): string {
  const apiError = error as ApiError;
  const fieldError = apiError?.details?.field_errors?.pincode;
  if (Array.isArray(fieldError) && fieldError.length > 0) return String(fieldError[0] || "").trim();
  if (typeof fieldError === "string") return fieldError.trim();
  if (apiError?.details?.message) return apiError.details.message.trim();
  if (error instanceof Error && error.message) return error.message.trim();
  return "";
}

function sanitizeText(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

// Scan & Fill / consent-form OCR extraction hands back whatever raw text sat near
// the matched label — it has no idea the Gender <select>'s option values are the
// lowercase enum "male"/"female"/"other" (their *labels* are Title Case: "Male"),
// or that the backend rejects any date that isn't strict YYYY-MM-DD. Both of these
// used to just get Title-cased / passed straight through, so a scanned "MALE" became
// "Male" (not a valid choice) and a scanned "15/08/2015" was sent to the backend
// verbatim (not a valid date) — exactly the two field_errors this kept producing.
function normalizeExtractedGender(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (!v) return "";
  if (v.startsWith("m")) return "male";
  if (v.startsWith("f")) return "female";
  return "other";
}

const OCR_MONTH_NUMBERS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function normalizeExtractedDob(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; // already ISO
  let m = v.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/); // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
  if (m) {
    const [, d, mo, y] = m;
    const dd = d.padStart(2, "0");
    const mm = mo.padStart(2, "0");
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) return `${y}-${mm}-${dd}`;
  }
  m = v.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})[\s-]+(\d{4})$/); // "15 Aug 2015" / "15-August-2015"
  if (m) {
    const [, d, monName, y] = m;
    const mm = OCR_MONTH_NUMBERS[monName.slice(0, 3).toLowerCase()];
    if (mm) return `${y}-${mm}-${d.padStart(2, "0")}`;
  }
  return ""; // couldn't confidently parse — leave the field untouched rather than send garbage
}

const isValidEmail = (v: string) => {
  if (!v.trim()) return true; // optional field — empty is OK
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return false;
  const [local] = v.split('@');
  if (/^(.)\1+$/.test(local)) return false; // all same char
  if (local.length < 2) return false;
  return true;
};

const isValidPhone = (v: string) => {
  const d = v.replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(d)) return false;
  // reject all-same digits (e.g. 9999999999)
  if (/^(\d)\1{9}$/.test(d)) return false;
  // reject numbers where any single digit appears 7 or more times (e.g. 9000000000)
  const digitFreq = Array.from(d).reduce<Record<string, number>>((acc, ch) => { acc[ch] = (acc[ch] || 0) + 1; return acc; }, {});
  if (Object.values(digitFreq).some(count => count >= 7)) return false;
  const seq = '0123456789';
  if (seq.includes(d) || seq.split('').reverse().join('').includes(d)) return false;
  return true;
};

function isValidPincode(pincode: string): boolean {
  return /^\d{6}$/.test(pincode.trim());
}

const isValidAadhaar = (v: string) => {
  const d = v.replace(/[\s-]/g, '');
  if (!/^\d{12}$/.test(d)) return false;
  if (/^(\d)\1{11}$/.test(d)) return false;
  return true;
};

const isValidPEN = (v: string) => /^\d{11}$/.test(v.replace(/\s/g, ''));

const isValidABCId = (v: string) => /^[A-Z0-9]{12}$/.test(v.replace(/\s/g, '').toUpperCase());

function isLikelyValidClassName(value: string): boolean {
  const clean = sanitizeText(value);
  const lowered = clean.toLowerCase();
  if (!clean) return false;
  // Accept numeric classes like "1".."12" that are a single character.
  if (/^\d+$/.test(clean)) {
    return true;
  }
  if (["abc", "adc", "asdf", "test", "demo"].includes(lowered)) return false;
  return /[A-Za-z0-9]/.test(clean);
}

function getInitialsFromName(value: string): string {
  const parts = sanitizeText(value)
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function isAlphabetsOnly(value: string): boolean {
  return /^[A-Za-z\s'-]*$/.test(value);
}

/**
 * A "proper" name: must contain real letters (not just punctuation), start and
 * end with a letter, with only single space / apostrophe / hyphen / dot
 * separators between letter groups. Rejects values like "--", "''", "A-", ".",
 * or "A--B". Allows "Mary Jane", "O'Brien", "Jean-Luc", "A. Kumar".
 */
function isProperName(value: string): boolean {
  const v = value.trim();
  if (v.length < 2) return false;
  return /^[A-Za-z]+(?:[ '.-][A-Za-z]+)*\.?$/.test(v);
}

/** Keep only name characters, forbid a leading separator, and collapse spaces. */
function sanitizeNameInput(raw: string): string {
  return raw
    .replace(/[^A-Za-z\s'.-]/g, "")
    .replace(/^[\s'.-]+/, "")
    .replace(/\s{2,}/g, " ");
}

function isValidAdmissionOrRoll(value: string): boolean {
  return /^[A-Za-z0-9]+$/.test(value.trim());
}

// The single definition of a valid admission number — previously the onBlur
// handler enforced this but runAdmissionAvailabilityCheck only checked
// isValidAdmissionOrRoll (any letters/numbers). Since the availability check
// runs right after onBlur and unconditionally clears the field error once the
// number is confirmed unique, a value like "ramu" that correctly failed the
// format check a moment earlier ended up shown as "✓ Admission number is
// available" anyway — the availability check silently overrode the format
// rejection instead of respecting it.
// Digit count: the backend's next-admission-no generator (views.py
// next_admission_no) produces ADM<4-digit year><sequence, min 3 digits,
// widening past 999> — i.e. 7 digits minimum for the normal case (e.g.
// ADM2026001), not 8. The original onBlur-only regex required a minimum of 8,
// which happened to go unnoticed because it only ever ran against a manually
// *edited* value, never the untouched auto-generated one. Upper bound of 9
// matches the input's own maxLength={12} (3 for "ADM" + 9 digits).
const ADMISSION_NO_FORMAT_REGEX = /^ADM\d{7,9}$/;

function isValidNumericRoll(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

async function compressImage(file: File, maxWidth = 1200, quality = 0.8): Promise<File> {
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Invalid image."));
    image.src = src;
  });

  let width = img.width;
  let height = img.height;
  if (width > maxWidth) {
    height = Math.round((height * maxWidth) / width);
    width = maxWidth;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image processing is not supported in this browser.");
  ctx.drawImage(img, 0, 0, width, height);

  const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outputType, quality));
  if (!blob) throw new Error("Failed to compress image.");

  return new File([blob], file.name.replace(/\s+/g, "_"), { type: outputType });
}

export function StudentAddPanel() {
  const STUDENT_DRAFT_STORAGE_KEY = "students:add:draft:v1";
  const STUDENT_DRAFTS_KEY = "students:add:drafts:v2";
  const searchParams = useSearchParams();
  const modeParam = (searchParams.get("mode") || "add").toLowerCase();
  const isViewMode = modeParam === "view";
  const isEditMode = modeParam === "edit";
  const studentIdParam = searchParams.get("id") || "";
  const studentId = /^\d+$/.test(studentIdParam) ? Number(studentIdParam) : null;
  const isExistingStudentMode = Boolean(studentId && (isViewMode || isEditMode));

  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [categories, setCategories] = useState<StudentCategory[]>([]);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [currentUser, setCurrentUser] = useState<MePayload | null>(null);

  const [admissionNo, setAdmissionNo] = useState("");
  const [isManualEdit, setIsManualEdit] = useState(false);
  const [rollNo, setRollNo] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [academicYearId, setAcademicYearId] = useState("");
  const [gender, setGender] = useState("male");
  const [customGender, setCustomGender] = useState("");
  const [bloodGroup, setBloodGroup] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [landmark, setLandmark] = useState("");
  const [transportModes, setTransportModes] = useState<string[]>([]);
  const [transportCustom, setTransportCustom] = useState("");

  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [stateName, setStateName] = useState("");
  const [pincode, setPincode] = useState("");
  const [photo, setPhoto] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  // `photo` holds the backend's absolute /media/... URL, which is served by
  // apps.core.media_views.serve_media — auth-gated by JWT bearer token. A plain
  // <img src={photo}> can never carry that header (browsers don't let you attach
  // custom headers to an <img> request), so the request always came back 403
  // before the browser ever got to render anything, regardless of any ownership
  // check on the backend side — the thumbnail was failing at authentication, not
  // ownership. Fetch it the same authenticated way every other API call does,
  // then hand the browser a local blob: URL to actually render.
  const [photoDisplayUrl, setPhotoDisplayUrl] = useState("");
  const [photoCleared, setPhotoCleared] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);
  const [capturedPhotoFile, setCapturedPhotoFile] = useState<File | null>(null);
  const [capturedPhotoPreviewUrl, setCapturedPhotoPreviewUrl] = useState("");
  const [statusValue, setStatusValue] = useState<"active" | "inactive" | "transferred" | "dropped">("active");
  const [categoryId, setCategoryId] = useState("");
  const [guardianId, setGuardianId] = useState("");
  // Set once when an existing student/draft is loaded, holding the guardian id that still
  // needs to be hydrated into guardianDrafts[0] once the guardian pool has arrived. Kept
  // separate from `guardianId` because that field is also driven downward from
  // guardianDrafts[0].linkedExistingId (see the sync effect below) — reusing it here raced
  // the two effects against each other and the load's value always lost, leaving the
  // guardian card permanently blank on edit even though the student really had one saved.
  const [pendingGuardianHydrationId, setPendingGuardianHydrationId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [isDisabled, setIsDisabled] = useState(false);
  const [isPwD, setIsPwD] = useState(false);
  const [streamId, setStreamId] = useState("");
  const [apaarRaw, setApaarRaw] = useState("");
  const [apaarStatus, setApaarStatus] = useState<"idle" | "verifying" | "verified" | "notfound">("idle");
  const [apaarBannerDismissed, setApaarBannerDismissed] = useState(false);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  const [emergencyCopiedFromGuardian, setEmergencyCopiedFromGuardian] = useState(false);
  const [vision, setVision] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [medicalConditionInput, setMedicalConditionInput] = useState("");
  const [medicalConditions, setMedicalConditions] = useState<string[]>([]);
  const [medCondError, setMedCondError] = useState("");
  const [allergyInput, setAllergyInput] = useState("");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [currentMedications, setCurrentMedications] = useState("");
  const [treatingDoctor, setTreatingDoctor] = useState("");
  const [checkedVaccinations, setCheckedVaccinations] = useState<string[]>([]);
  const [suggestedVaccinations, setSuggestedVaccinations] = useState<string[]>([]);
  const [sectionLater, setSectionLater] = useState(false);
  const [sectionsSummary, setSectionsSummary] = useState<Array<{ section_id: number; name: string; count: number; capacity: number }>>([]);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [consentOpenWithSettings, setConsentOpenWithSettings] = useState(false);
  const [consentInitialAction, setConsentInitialAction] = useState<'upload-signed' | 'blank-form' | 'blank-form-digital' | 'blank-form-email' | 'blank-form-whatsapp' | 'print-pdf' | null>(null);
  const [blankFormMenuOpen, setBlankFormMenuOpen] = useState(false);
  // Standalone "upload signed copy" flow — does NOT open the full ConsentForm modal first
  const signedUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [signedUploadFile, setSignedUploadFile] = useState<File | null>(null);
  const [signedUploadPreviewUrl, setSignedUploadPreviewUrl] = useState<string>('');
  const [signedUploadStatus, setSignedUploadStatus] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [signedUploadError, setSignedUploadError] = useState<string>('');
  const [signedUploadOpen, setSignedUploadOpen] = useState<boolean>(false);
  const [scanFillOpen, setScanFillOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [draftSearch, setDraftSearch] = useState("");
  const [draftSort, setDraftSort] = useState<'recent' | 'oldest' | 'progress'>('recent');
  const [draftsPage, setDraftsPage] = useState(1);
  const [houseId, setHouseId] = useState("");
  const [houseGroups, setHouseGroups] = useState<Array<{id: string; name: string; emoji: string; color: string; bgColor: string; studentsCount: number}>>([]);
  const [houseAiSuggestion, setHouseAiSuggestion] = useState<{groupId: string; groupName: string; reason: string} | null>(null);
  const [houseAiLoading, setHouseAiLoading] = useState(false);

  const [guardianDrafts, setGuardianDrafts] = useState<GuardianDraft[]>(() => [
    makeEmptyGuardianDraft(true),
  ]);
  const [guardianCardErrors, setGuardianCardErrors] = useState<GuardianFieldErrors[]>([{}]);
  const [guardianSubmitError, setGuardianSubmitError] = useState<string | null>(null);
  const [friendsContacts, setFriendsContacts] = useState<{id: string; name: string; relation: string; phone: string}[]>([]);
  const [friendsContactsOpen, setFriendsContactsOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [sectionLoadError, setSectionLoadError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [validationErrorList, setValidationErrorList] = useState<Array<{field: string; message: string; section: NavItemId}>>([]);
  const [checkingAdmission, setCheckingAdmission] = useState(false);
  const [admissionChecked, setAdmissionChecked] = useState(false);
  const [pinLookupLoading, setPinLookupLoading] = useState(false);
  const [pinLookupMessage, setPinLookupMessage] = useState("");
  const [cityLoading, setCityLoading] = useState(false);
  const [cityOptions, setCityOptions] = useState<string[]>([]);
  const [stateCityMap, setStateCityMap] = useState<Record<string, string[]>>(DEFAULT_STATE_CITY_MAP);
  const [manualAddressMode, setManualAddressMode] = useState(false);
  const [lastPinLookup, setLastPinLookup] = useState("");
  const [pendingSectionId, setPendingSectionId] = useState("");
  const [activeNavSection, setActiveNavSection] = useState<NavItemId>("identity");
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    if (typeof window !== 'undefined') return sessionStorage.getItem('enrollScanBannerDismissed') === 'true';
    return false;
  });
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [draftLabel, setDraftLabel] = useState("Draft saved");
  const [draftSaveStatus, setDraftSaveStatus] = useState<'unsaved'|'saving'|'saved'>('saved');
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [draftSavedModalOpen, setDraftSavedModalOpen] = useState(false);
  const [unsavedNavModalOpen, setUnsavedNavModalOpen] = useState(false);
  const pendingNavRef = useRef<null | (() => void)>(null);
  const [infoChecklistOpen, setInfoChecklistOpen] = useState(false);
  const [currentEnrolledCount, setCurrentEnrolledCount] = useState<string | null>(null);
  const [admissionNoEditable, setAdmissionNoEditable] = useState(false);
  const [admissionConflict, setAdmissionConflict] = useState<{ id: number; name: string; class_name: string; section_name: string; is_draft?: boolean } | null>(null);
  const [dobDisplay, setDobDisplay] = useState("");
  const [classAgeWarning, setClassAgeWarning] = useState("");
  const [motherTongue, setMotherTongue] = useState("");
  const [otherMotherTongue, setOtherMotherTongue] = useState("");
  const [religion, setReligion] = useState("Prefer not to say");
  const [nationality, setNationality] = useState("");
  const [otherNationality, setOtherNationality] = useState("");
  const [admissionType, setAdmissionType] = useState("");
  const [previousSchoolName, setPreviousSchoolName] = useState("");
  const [rteCertificateNo, setRteCertificateNo] = useState("");
  const [consentChecked, setConsentChecked] = useState(false);
  const [medicalNotes, setMedicalNotes] = useState("");
  const [docBirthCertificate, setDocBirthCertificate] = useState(false);
  const [docAadhaar, setDocAadhaar] = useState(false);
  // No-section modal state
  const [noSectionModalOpen, setNoSectionModalOpen] = useState(false);
  const [sectionNotRequired, setSectionNotRequired] = useState(false);
  // APAAR step state
  const [aadhaarNo, setAadhaarNo] = useState("");
  const [aadhaarVisible, setAadhaarVisible] = useState(false);
  const [pen, setPen] = useState("");
  const [digiMobile, setDigiMobile] = useState("");
  const [abcId, setAbcId] = useState("");
  // Specially abled step state
  const [disabilityTypes, setDisabilityTypes] = useState<string[]>([]);
  const [disabilityPercent, setDisabilityPercent] = useState(0);
  const [udid, setUdid] = useState("");
  const [accommodations, setAccommodations] = useState<string[]>([]);
  const [additionalNotes, setAdditionalNotes] = useState("");
  const [otherDisabilityText, setOtherDisabilityText] = useState("");
  const [pwdFlash, setPwdFlash] = useState(false);
  // Identity marks step state
  const [identityMarks, setIdentityMarks] = useState<{location:string; description:string}[]>([]);
  const [eyeColour, setEyeColour] = useState("");
  const [hairColour, setHairColour] = useState("");
  const [complexion, setComplexion] = useState("");
  const [build, setBuild] = useState("");
  const [markFormOpen, setMarkFormOpen] = useState(false);
  const [newMarkLocation, setNewMarkLocation] = useState("");
  const [newMarkDescription, setNewMarkDescription] = useState("");
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const toastTimerRef = useRef<number | null>(null);
  const admissionNoRef = useRef("");
  const isManualEditRef = useRef(false);
  const admissionNoInitRequestedRef = useRef(false);
  // A1: prevents re-entrant submit from triggering an effect-state cycle.
  const isSubmittingRef = useRef(false);
  // The real reason the last autoSaveStudentDraft() call failed (e.g. the backend's
  // "Selected DOB does not match the required age range" rejection). Callers like
  // uploadDocumentFile need this to show a self-contained, specific error on the
  // document card — the toast autoSaveStudentDraft fires alongside it is transient
  // and gone by the time anyone reads the card (see the generic "see the
  // notification above" message this replaced).
  const lastAutoSaveErrorRef = useRef<string>("");

  // Track newly created student ID so documents can be uploaded immediately after creation
  const [newlyCreatedStudentId, setNewlyCreatedStudentId] = useState<number | null>(null);
  const [autoSaving, setAutoSaving] = useState(false);
  const [maxReachedIdx, setMaxReachedIdx] = useState(0);
  const [returnToReview, setReturnToReview] = useState(false);

  // Step 10 — fee plan (assignment + concessions), persisted once the student is saved.
  const [feePlan, setFeePlan] = useState<FeePlanState>(EMPTY_FEE_PLAN);
  const [feeSummary, setFeeSummary] = useState<FeePlanSummary>({ groupName: "", concessionName: "", lineCount: 0, annualTotal: 0 });
  const feesStepRef = useRef<StudentFeesStepHandle>(null);
  // undefined = not yet known (edit mode still fetching); [] = confirmed none to restore.
  // Fee Plan previously always looked unassigned on edit even when a plan already
  // existed — this is what StudentFeesStep uses to reconstruct it.
  const [existingFeeAssignments, setExistingFeeAssignments] = useState<FeesAssignment[] | undefined>(undefined);

  // Consolidated document upload state with proper status management
  type DocumentStatus = "idle" | "validating" | "uploading" | "success" | "error";
  
  interface DocumentState {
    status: DocumentStatus;
    fileName: string;
    url: string | null;
    error: string | null;
    uploadedAt: string | null;
  }

  const [documents, setDocuments] = useState<{
    birth_certificate: DocumentState;
    aadhaar_card: DocumentState;
    medical_information: DocumentState;
    transfer_certificate: DocumentState;
    caste_certificate: DocumentState;
    udid_card: DocumentState;
  }>({
    birth_certificate: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
    aadhaar_card: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
    medical_information: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
    transfer_certificate: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
    caste_certificate: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
    udid_card: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
  });

  const [customDocsMeta, setCustomDocsMeta] = useState<CustomDocMeta[]>([]);
  const [marksheetMeta, setMarksheetMeta] = useState<MarksheetMeta[]>([]);

  // Track last error toast ID to avoid duplicates
  const [lastErrorToastId, setLastErrorToastId] = useState<string | null>(null);

  const pinIsValid = /^\d{6}$/.test(pincode.trim());
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const maxDobIso = useMemo(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  }, []);

  const validAcademicYears = useMemo(() => {
    const filtered = academicYears.filter((item) => /^\d{4}-\d{4}$/.test(String(item.name || "").trim()));
    const now = new Date();
    const currentStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return [...filtered].sort((a, b) => {
      const aStart = parseInt(String(a.name).slice(0, 4), 10);
      const bStart = parseInt(String(b.name).slice(0, 4), 10);
      if (aStart === currentStartYear) return -1;
      if (bStart === currentStartYear) return 1;
      const aFuture = aStart > currentStartYear;
      const bFuture = bStart > currentStartYear;
      if (aFuture && bFuture) return aStart - bStart;
      if (!aFuture && !bFuture) return bStart - aStart;
      if (aFuture) return -1;
      return 1;
    });
  }, [academicYears]);

  const validCategories = useMemo(
    () =>
      // TODO: ask backend team to clean Category table in Django admin
      categories.filter((item) => {
        const name = String(item.name || "").trim();
        const lowered = name.toLowerCase();
        if (!name || name.length < 3) return false;
        if (["abc", "asdf", "gk", "test", "demo"].includes(lowered)) return false;
        if (/^(.)\1+$/i.test(name)) return false;
        // Reject names where > 60% of characters are the same (e.g. "weeeeeeeeeee")
        const charFreq = name.split('').reduce((acc, c) => { acc[c.toLowerCase()] = (acc[c.toLowerCase()]||0)+1; return acc; }, {} as Record<string,number>);
        const maxFreq = Math.max(...Object.values(charFreq));
        if (maxFreq / name.length > 0.6) return false;
        return /^[A-Za-z0-9][A-Za-z0-9 ]{1,99}$/.test(name);
      }),
    [categories],
  );

  const validClasses = useMemo(
    () =>
      classes.filter((item) => {
        const name = String(item.name || "");
        return isLikelyValidClassName(name);
      }),
    [classes],
  );

  const orderedClasses = useMemo(() => {
    return [...validClasses].sort((a, b) => {
      const aName = String(a.name || "").trim();
      const bName = String(b.name || "").trim();
      const aIndex = CLASS_ORDER.indexOf(aName);
      const bIndex = CLASS_ORDER.indexOf(bName);
      if (aIndex === -1 && bIndex === -1) return aName.localeCompare(bName);
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });
  }, [validClasses]);

  const selectedClass = useMemo(
    () => orderedClasses.find((item) => String(item.id) === classId) || null,
    [orderedClasses, classId],
  );

  const selectedSection = useMemo(
    () => sections.find((item) => String(item.id) === sectionId) || null,
    [sections, sectionId],
  );

  const studentForm = useMemo(
    () => ({
      admission_no: admissionNo.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      date_of_birth: dateOfBirth,
      gender: gender,
      class_id: classId,
      class_name: String(selectedClass?.name || "").trim(),
      section_id: sectionId,
      academic_year_id: academicYearId,
    }),
    [admissionNo, firstName, lastName, dateOfBirth, gender, classId, selectedClass, sectionId, academicYearId],
  );

  const studentFormRef = useRef(studentForm);

  useEffect(() => {
    studentFormRef.current = studentForm;
  }, [studentForm]);

  useEffect(() => {
    isManualEditRef.current = isManualEdit;
  }, [isManualEdit]);

  useEffect(() => {
    admissionNoRef.current = admissionNo;
  }, [admissionNo]);

  // Defer admission number generation until the admin has actually started
  // entering a real student (i.e. typed a first name). This avoids consuming
  // ADM sequence numbers and showing a random pre-filled value when the user
  // is just exploring the page.
  useEffect(() => {
    if (isExistingStudentMode) return;
    if (!firstName.trim()) return;
    if (admissionNoRef.current.trim()) return;
    void initializeAdmissionNo();
    // initializeAdmissionNo is stable; only need to re-evaluate when firstName changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, isExistingStudentMode]);

  // Keep guardianId (the FK the student payload uses) in sync with the primary
  // draft's resolved ID. This matters for the auto-save path, which reads
  // guardianId directly, and keeps edit mode coherent after a picker link.
  useEffect(() => {
    const primary = guardianDrafts[0];
    const linked = primary?.linkedExistingId ?? null;
    const desired = linked ? String(linked) : "";
    if (desired !== guardianId) setGuardianId(desired);
  }, [guardianDrafts, guardianId]);

  // Hydrate the primary guardian card when the form loads an existing student (edit
  // mode) or a saved draft. Keyed off `pendingGuardianHydrationId` rather than
  // `guardianId` — the sync effect above resets `guardianId` to "" whenever
  // guardianDrafts[0] is still unlinked, which raced ahead of this effect on load
  // (guardianId got loaded first, then wiped back to "" before the guardian pool
  // fetch — page_size=500 across the whole school — had a chance to resolve),
  // leaving the guardian card permanently blank even though the student had a
  // guardian saved. `pendingGuardianHydrationId` isn't touched by that effect, so
  // it survives until this one consumes it.
  useEffect(() => {
    if (!pendingGuardianHydrationId) return;
    const numeric = Number(pendingGuardianHydrationId);
    if (!Number.isFinite(numeric)) {
      setPendingGuardianHydrationId("");
      return;
    }
    const match = guardians.find((g) => g.id === numeric);
    if (!match) return; // guardian pool hasn't arrived yet — try again once `guardians` updates
    setGuardianDrafts((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const fullName = match.full_name || "";
      const relation = normalizeRelation(match.relation);
      const phone = match.phone || "";
      const email = match.email || "";
      const occupation = match.occupation || "";
      next[0] = {
        ...next[0],
        isPrimary: true,
        linkedExistingId: match.id,
        fullName,
        relation,
        phone,
        email,
        occupation,
        original: { fullName, relation, phone, email, occupation },
      };
      return next;
    });
    setGuardianId(String(match.id));
    setPendingGuardianHydrationId("");
  }, [pendingGuardianHydrationId, guardians]);

  // TODO 12: Detect form changes and set draft status to unsaved
  useEffect(() => {
    if (draftSaveStatus === 'saved') {
      setDraftSaveStatus('unsaved');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstName, lastName, dateOfBirth, gender, classId, sectionId, phone, email, addressLine, city, stateName, pincode, emergencyName, emergencyPhone, guardianDrafts]);

  const stateOptions = useMemo(() => Object.keys(stateCityMap).sort((a, b) => a.localeCompare(b)), [stateCityMap]);

  const currentUserInitials = useMemo(() => {
    const first = String(currentUser?.first_name || "").trim();
    const last = String(currentUser?.last_name || "").trim();
    const username = String(currentUser?.username || "").trim();
    const email = String(currentUser?.email || "").trim();

    if (first || last) {
      return getInitialsFromName(`${first} ${last}`);
    }
    if (username) {
      return getInitialsFromName(username.replace(/[._-]+/g, " "));
    }
    if (email.includes("@")) {
      return getInitialsFromName(email.split("@")[0] || "");
    }
    return "U";
  }, [currentUser]);

  const canSubmit = !loading && !saving && !photoUploading && !sectionLoading && !classId ? false : !loading && !saving && !photoUploading && !sectionLoading && (activeNavSection !== 'review' || reviewConfirmed);

  const progressFields = [
    firstName,
    lastName,
    dateOfBirth,
    gender,
    classId,
    sectionId || (sectionLater ? "later" : ""),
    academicYearId,
    categoryId,
    phone,
    addressLine,
    city,
    district,
    stateName,
    pincode,
    (guardianDrafts[0]?.linkedExistingId != null || (guardianDrafts[0]?.fullName?.trim() ?? "")) ? "x" : "",
    guardianDrafts[0]?.phone?.trim() || "",
    consentChecked ? "x" : "",
  ];

  const isStepComplete = (stepId: string): boolean => {
    switch (stepId) {
      case 'identity': return !!(firstName.trim() && lastName.trim() && dateOfBirth);
      case 'academic': return !!(academicYearId && classId && (sectionId || sectionLater));
      case 'contact': return !!(phone.trim() && addressLine.trim() && stateName && city && pincode.trim());
      case 'guardians': return !!(guardianDrafts[0]?.fullName?.trim() && guardianDrafts[0]?.phone?.trim());
      case 'documents': return consentChecked;
      case 'fees': return !!feePlan.feeGroupId;
      default: return false;
    }
  };

  const completedProgressFields = progressFields.filter(isProgressFieldFilled).length;
  // Single shared definition — see computeCompletionPercent — so the footer bar,
  // the AI Assist modal, and the Drafts panel can never disagree on this record.
  const footerProgressPercent = computeCompletionPercent({
    firstName, lastName, dateOfBirth, gender, classId, sectionId, sectionLater,
    phone, addressLine, pincode,
    guardianFullName: guardianDrafts?.[0]?.fullName,
    guardianPhone: guardianDrafts?.[0]?.phone,
    consentChecked,
  });
  const footerProgressBucket = Math.min(100, Math.floor(footerProgressPercent / 10) * 10);
  const footerProgressClass = `progress-fill-${footerProgressBucket}`;

  const loadBaseLookups = async () => {
    try {
      setLoading(true);
      setError("");

      // Kick off all lookup requests in parallel and apply each as it arrives,
      // so dropdowns light up progressively instead of waiting for the slowest
      // (guardian pagination) to finish.
      const yearPromise = apiGet<ApiList<AcademicYear>>("/api/v1/core/academic-years/?page_size=200")
        .then((data) => setAcademicYears(listData(data)))
        .catch(() => {});
      const classPromise = fetchAllPages<SchoolClass>("/api/v1/core/classes/", 500)
        .then((rows) => setClasses(rows))
        .catch(() => {});
      const categoryPromise = fetchAllPages<StudentCategory>("/api/v1/students/categories/?status=active", 500)
        .then((rows) => setCategories(rows))
        .catch(() => {});
      const guardianPromise = fetchAllPages<Guardian>("/api/v1/students/guardians/", 500)
        .then((rows) => setGuardians(rows))
        .catch(() => {});
      const mePromise = apiGet<MePayload>("/api/v1/auth/me/")
        .then((me) => setCurrentUser(me))
        .catch(() => setCurrentUser(null));

      // Unblock the form as soon as the small/critical lookups are in.
      // Heavy paged fetches (categories/guardians) continue in the background.
      await Promise.all([yearPromise, classPromise, mePromise]);
      setLoading(false);

      // Still await the heavy ones so any caller awaiting loadBaseLookups
      // (e.g. the existing flow) sees a fully-resolved promise, but the UI
      // is already interactive at this point.
      await Promise.all([categoryPromise, guardianPromise]);
    } catch (loadError) {
      setError(parseError(loadError));
      setLoading(false);
    }
  };

  const saveDraftSnapshot = () => {
    if (typeof window === "undefined") return;
    const payload = {
      savedAt: Date.now(),
      maxReachedIdx,
      activeNavSection,
      admissionNo,
      isManualEdit,
      newlyCreatedStudentId,
      rollNo,
      firstName,
      middleName,
      lastName,
      dateOfBirth,
      academicYearId,
      gender,
      customGender,
      bloodGroup,
      phone,
      email,
      addressLine,
      city,
      district,
      stateName,
      pincode,
      photo,
      photoName,
      statusValue,
      categoryId,
      guardianId,
      classId,
      sectionId,
      isDisabled,
      motherTongue,
      otherMotherTongue,
      religion,
      nationality,
      otherNationality,
      admissionType,
      previousSchoolName,
      rteCertificateNo,
      consentChecked,
      medicalNotes,
      docBirthCertificate,
      docAadhaar,
      guardianDrafts: guardianDrafts.map(g => ({ ...g })),
      customDocsMeta,
      marksheetMeta,
    };
    // Backward-compat: still write single-draft key for auto-restore on reload
    window.localStorage.setItem(STUDENT_DRAFT_STORAGE_KEY, JSON.stringify(payload));

    // Multi-draft system: students:add:drafts:v2
    try {
      const rawDrafts = window.localStorage.getItem(STUDENT_DRAFTS_KEY);
      let drafts: Array<{id:string; savedAt:number; label:string; admissionNo:string; firstName:string; lastName:string; classId:string; data:typeof payload}> = [];
      try { drafts = rawDrafts ? JSON.parse(rawDrafts) : []; } catch { drafts = []; }
      const label = `${firstName || 'Unnamed'} ${lastName || ''}`.trim() + ` — ${new Date(payload.savedAt).toLocaleString('en-IN')}`;
      const existingIdx = admissionNo.trim() ? drafts.findIndex(d => d.admissionNo === admissionNo.trim()) : -1;
      const draftEntry = { id: existingIdx >= 0 ? drafts[existingIdx].id : `draft-${Date.now()}`, savedAt: payload.savedAt, label, admissionNo: admissionNo.trim(), firstName: firstName.trim(), lastName: lastName.trim(), classId, data: payload };
      if (existingIdx >= 0) {
        drafts[existingIdx] = draftEntry;
      } else {
        drafts.push(draftEntry);
      }
      window.localStorage.setItem(STUDENT_DRAFTS_KEY, JSON.stringify(drafts));
    } catch { /* ignore localStorage quota errors */ }
  };

  const restoreDraftSnapshot = () => {
    if (typeof window === "undefined" || isExistingStudentMode) return false;
    const raw = window.localStorage.getItem(STUDENT_DRAFT_STORAGE_KEY);
    if (!raw) return false;

    try {
      const draft = JSON.parse(raw) as Record<string, unknown>;
      setAdmissionNo(String(draft.admissionNo || ""));
      setIsManualEdit(Boolean(draft.isManualEdit));
      // Restore draft student ID so document uploads reuse the existing record
      if (typeof draft.newlyCreatedStudentId === "number" && draft.newlyCreatedStudentId > 0) {
        setNewlyCreatedStudentId(draft.newlyCreatedStudentId);
      }
      setRollNo(String(draft.rollNo || ""));
      setFirstName(String(draft.firstName || ""));
      setMiddleName(String(draft.middleName || ""));
      setLastName(String(draft.lastName || ""));
      setDateOfBirth(String(draft.dateOfBirth || ""));
      setAcademicYearId(String(draft.academicYearId || ""));
      setGender(String(draft.gender || "male"));
      setCustomGender(String(draft.customGender || ""));
      setBloodGroup(String(draft.bloodGroup || ""));
      setPhone(String(draft.phone || ""));
      setEmail(String(draft.email || ""));
      setAddressLine(String(draft.addressLine || ""));
      setCity(String(draft.city || ""));
      setDistrict(String(draft.district || ""));
      setStateName(String(draft.stateName || ""));
      setPincode(String(draft.pincode || ""));
      setPhoto(String(draft.photo || ""));
      setPhotoName(String(draft.photoName || ""));
      setStatusValue((String(draft.statusValue || "active") as "active" | "inactive" | "transferred" | "dropped"));
      setCategoryId(String(draft.categoryId || ""));
      setGuardianId(String(draft.guardianId || ""));
      setPendingGuardianHydrationId(String(draft.guardianId || ""));
      const restoredClassId = String(draft.classId || "");
      const restoredSectionId = String(draft.sectionId || "");
      setClassId(restoredClassId);
      setSectionId("");
      setPendingSectionId(restoredSectionId);
      setIsDisabled(Boolean(draft.isDisabled));
      setMotherTongue(String(draft.motherTongue || ""));
      setOtherMotherTongue(String(draft.otherMotherTongue || ""));
      setReligion(String(draft.religion || "Prefer not to say"));
      setNationality(String(draft.nationality || "Indian"));
      setOtherNationality(String(draft.otherNationality || ""));
      setAdmissionType(String(draft.admissionType || "New admission"));
      setPreviousSchoolName(String(draft.previousSchoolName || ""));
      setRteCertificateNo(String(draft.rteCertificateNo || ""));
      setConsentChecked(Boolean(draft.consentChecked));
      setMedicalNotes(String(draft.medicalNotes || ""));
      setDocBirthCertificate(Boolean(draft.docBirthCertificate));
      setDocAadhaar(Boolean(draft.docAadhaar));
      if (Array.isArray(draft.guardianDrafts) && draft.guardianDrafts.length > 0) {
        setGuardianDrafts(draft.guardianDrafts as GuardianDraft[]);
      }
      if (Array.isArray(draft.customDocsMeta)) setCustomDocsMeta(draft.customDocsMeta as CustomDocMeta[]);
      if (Array.isArray(draft.marksheetMeta)) setMarksheetMeta(draft.marksheetMeta as MarksheetMeta[]);
      setDraftSavedAt(typeof draft.savedAt === "number" ? draft.savedAt : Date.now());
      // Restore navigation state so admin can freely jump between completed steps
      const savedMaxIdx = typeof draft.maxReachedIdx === 'number' ? draft.maxReachedIdx : NAV_ITEMS.length - 2;
      setMaxReachedIdx(savedMaxIdx);
      const savedSection = typeof draft.activeNavSection === 'string' && NAV_ITEMS.some(n => n.id === draft.activeNavSection)
        ? (draft.activeNavSection as string) : 'identity';
      setTimeout(() => jumpToSection(savedSection), 0);
      return true;
    } catch {
      window.localStorage.removeItem(STUDENT_DRAFT_STORAGE_KEY);
      return false;
    }
  };

  const restoreDraftFromObject = (draft: Record<string, unknown>) => {
    setAdmissionNo(String(draft.admissionNo || ""));
    setIsManualEdit(Boolean(draft.isManualEdit));
    if (typeof draft.newlyCreatedStudentId === "number" && draft.newlyCreatedStudentId > 0) {
      setNewlyCreatedStudentId(draft.newlyCreatedStudentId);
    }
    setRollNo(String(draft.rollNo || ""));
    setFirstName(String(draft.firstName || ""));
    setLastName(String(draft.lastName || ""));
    setDateOfBirth(String(draft.dateOfBirth || ""));
    setAcademicYearId(String(draft.academicYearId || ""));
    setGender(String(draft.gender || "male"));
    setCustomGender(String(draft.customGender || ""));
    setBloodGroup(String(draft.bloodGroup || ""));
    setPhone(String(draft.phone || ""));
    setEmail(String(draft.email || ""));
    setAddressLine(String(draft.addressLine || ""));
    setCity(String(draft.city || ""));
    setDistrict(String(draft.district || ""));
    setStateName(String(draft.stateName || ""));
    setPincode(String(draft.pincode || ""));
    setPhoto(String(draft.photo || ""));
    setPhotoName(String(draft.photoName || ""));
    setStatusValue((String(draft.statusValue || "active") as "active" | "inactive" | "transferred" | "dropped"));
    setCategoryId(String(draft.categoryId || ""));
    setGuardianId(String(draft.guardianId || ""));
    setPendingGuardianHydrationId(String(draft.guardianId || ""));
    const restoredClassId = String(draft.classId || "");
    const restoredSectionId = String(draft.sectionId || "");
    setClassId(restoredClassId);
    setSectionId("");
    setPendingSectionId(restoredSectionId);
    setIsDisabled(Boolean(draft.isDisabled));
    setMotherTongue(String(draft.motherTongue || ""));
    setOtherMotherTongue(String(draft.otherMotherTongue || ""));
    setReligion(String(draft.religion || "Prefer not to say"));
    setNationality(String(draft.nationality || "Indian"));
    setOtherNationality(String(draft.otherNationality || ""));
    setAdmissionType(String(draft.admissionType || "New admission"));
    setPreviousSchoolName(String(draft.previousSchoolName || ""));
    setRteCertificateNo(String(draft.rteCertificateNo || ""));
    setConsentChecked(Boolean(draft.consentChecked));
    setMedicalNotes(String(draft.medicalNotes || ""));
    setDocBirthCertificate(Boolean(draft.docBirthCertificate));
    setDocAadhaar(Boolean(draft.docAadhaar));
    if (Array.isArray(draft.guardianDrafts) && draft.guardianDrafts.length > 0) {
      setGuardianDrafts(draft.guardianDrafts as GuardianDraft[]);
    }
    if (Array.isArray(draft.customDocsMeta)) setCustomDocsMeta(draft.customDocsMeta as CustomDocMeta[]);
    if (Array.isArray(draft.marksheetMeta)) setMarksheetMeta(draft.marksheetMeta as MarksheetMeta[]);
    setDraftSavedAt(typeof draft.savedAt === "number" ? draft.savedAt : Date.now());
    // Restore navigation state so admin can freely jump between completed steps
    const savedMaxIdx = typeof draft.maxReachedIdx === 'number' ? draft.maxReachedIdx : NAV_ITEMS.length - 2;
    setMaxReachedIdx(savedMaxIdx);
    const savedSection = typeof draft.activeNavSection === 'string' && NAV_ITEMS.some(n => n.id === draft.activeNavSection)
      ? (draft.activeNavSection as string) : 'identity';
    setTimeout(() => jumpToSection(savedSection), 0);
  };

  const loadSectionsForClass = async (targetClassId: string) => {
    if (!targetClassId) {
      setSections([]);
      setSectionId("");
      setSectionLoadError("");
      return;
    }

    // Flips the UI to a "taking a while" error after 8s, but — unlike an
    // AbortController — doesn't actually cancel the in-flight request. A
    // response that lands just after 8s on a slower connection is still
    // real data, not a connection failure, so it must still be applied
    // instead of being silently discarded (that was the previous bug:
    // sections would "intermittently fail to load" on a perfectly working
    // but slightly slow network).
    let requestSettled = false;
    const timeoutId = window.setTimeout(() => {
      if (requestSettled) return;
      setSectionLoading(false);
      setSectionLoadError("Still loading sections… this is taking longer than usual.");
    }, 8000);

    try {
      setSectionLoading(true);
      setSectionLoadError("");
      setSections([]);
      setSectionId("");
      const data = await apiGet<ApiList<Section>>(`/api/v1/core/sections/?class=${encodeURIComponent(targetClassId)}&page_size=200`);
      requestSettled = true;
      window.clearTimeout(timeoutId);
      const sectionsArray = listData(data);
      setSections(sectionsArray);
      setSectionLoadError("");
      // Check if no sections found
      if (!sectionsArray || sectionsArray.length === 0) {
        setNoSectionModalOpen(true);
      }
    } catch (loadError) {
      requestSettled = true;
      window.clearTimeout(timeoutId);
      setSections([]);
      setSectionLoadError(parseError(loadError) || "Unable to load sections for selected class.");
    } finally {
      setSectionLoading(false);
    }
  };

  const loadStudentForMode = async (targetStudentId: number) => {
    const data = await apiGet<StudentDetail>(`/api/v1/students/students/${targetStudentId}/`);
    setAdmissionNo(String(data.admission_no || ""));
    setIsManualEdit(false);
    setRollNo(String(data.roll_no || ""));
    setFirstName(String(data.first_name || ""));
    setMiddleName(String(data.middle_name || ""));
    setLastName(String(data.last_name || ""));
    setDateOfBirth(String(data.date_of_birth || ""));
    setAcademicYearId(data.academic_year ? String(data.academic_year) : "");
    setGender(String(data.gender || "male"));
    setCustomGender(String(data.custom_gender || ""));
    setBloodGroup(String(data.blood_group || ""));
    setPhone(String(data.phone || ""));
    setEmail(String(data.email || ""));
    setAddressLine(String(data.address_line || ""));
    setCity(String(data.city || ""));
    setDistrict(String(data.district || ""));
    setStateName(String(data.state || ""));
    setPincode(String(data.pincode || ""));
    setPhoto(String(data.photo || ""));
    setPhotoName(data.photo ? "Uploaded photo" : "");
    setPhotoCleared(false);
    setStatusValue(data.status || "active");
    setCategoryId(data.category ? String(data.category) : "");
    setHouseId(data.student_group ? String(data.student_group) : "");
    setGuardianId(data.guardian ? String(data.guardian) : "");
    if (Array.isArray(data.guardians) && data.guardians.length > 0) {
      // Full multi-guardian list from the server — hydrate every card directly
      // instead of relying on the single-card pool-matching effect below.
      setGuardianDrafts(
        data.guardians.map((g, idx) => {
          const fullName = g.full_name || "";
          const relation = normalizeRelation(g.relation);
          const phone = g.phone || "";
          const email = g.email || "";
          const occupation = g.occupation || "";
          return {
            clientId:
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `existing_${g.id}_${idx}`,
            isPrimary: g.is_primary ?? idx === 0,
            linkedExistingId: g.id,
            fullName,
            relation,
            phone,
            email,
            occupation,
            original: { fullName, relation, phone, email, occupation },
          };
        }),
      );
    } else {
      setPendingGuardianHydrationId(data.guardian ? String(data.guardian) : "");
    }
    const nextClassId = data.current_class ? String(data.current_class) : "";
    const nextSectionId = data.current_section ? String(data.current_section) : "";
    setClassId(nextClassId);
    setPendingSectionId(nextSectionId);
    setIsDisabled(Boolean(data.is_disabled));
    setAdmissionChecked(true);
    setPinLookupMessage("");

    // Fields below previously had no backing column on Student at all, so they
    // always reset to blank/default on edit even though the wizard captured
    // and displayed them at enrollment time. Restoring them here is the other
    // half of the schema-gap fix (payload wiring is in the submit handler).
    setLandmark(String(data.landmark || ""));
    setTransportModes(Array.isArray(data.transport_modes) ? data.transport_modes : []);
    setTransportCustom(String(data.transport_custom || ""));
    setMotherTongue(String(data.mother_tongue || ""));
    setOtherMotherTongue(String(data.other_mother_tongue || ""));
    setReligion(String(data.religion || "Prefer not to say"));
    setNationality(String(data.nationality || ""));
    setOtherNationality(String(data.other_nationality || ""));
    setAdmissionType(String(data.admission_type || ""));
    setPreviousSchoolName(String(data.previous_school_name || ""));
    setRteCertificateNo(String(data.rte_certificate_no || ""));
    setStreamId(String(data.stream || ""));
    setApaarRaw(String(data.apaar_id || ""));
    setAadhaarNo(String(data.aadhaar_no || ""));
    setPen(String(data.pen || ""));
    setDigiMobile(String(data.digilocker_mobile || ""));
    setAbcId(String(data.abc_id || ""));
    setHeightCm(data.height_cm != null ? String(data.height_cm) : "");
    setWeightKg(data.weight_kg != null ? String(data.weight_kg) : "");
    setVision(String(data.vision || ""));
    setMedicalConditions(Array.isArray(data.medical_conditions) ? data.medical_conditions : []);
    setAllergies(Array.isArray(data.allergies) ? data.allergies : []);
    setCurrentMedications(String(data.current_medications || ""));
    setTreatingDoctor(String(data.treating_doctor || ""));
    setCheckedVaccinations(Array.isArray(data.vaccinations) ? data.vaccinations : []);
    setMedicalNotes(String(data.medical_notes || ""));
    setEmergencyName(String(data.emergency_contact_name || ""));
    setEmergencyPhone(String(data.emergency_contact_phone || ""));
    setIsPwD(Boolean(data.is_pwd));
    setDisabilityTypes(Array.isArray(data.disability_types) ? data.disability_types : []);
    setDisabilityPercent(data.disability_percent ?? 0);
    setUdid(String(data.udid || ""));
    setAccommodations(Array.isArray(data.disability_accommodations) ? data.disability_accommodations : []);
    setAdditionalNotes(String(data.disability_notes || ""));
    setOtherDisabilityText(String(data.other_disability_text || ""));
    setIdentityMarks(Array.isArray(data.identity_marks) ? data.identity_marks : []);
    setEyeColour(String(data.eye_colour || ""));
    setHairColour(String(data.hair_colour || ""));
    setComplexion(String(data.complexion || ""));
    setBuild(String(data.build || ""));

    // Documents step never re-fetched existing uploads — it only ever showed
    // "not uploaded" on edit even when the file is already on record. The
    // files themselves were always saved server-side (StudentDocument); only
    // the Documents step's local status/preview state was never hydrated.
    if (Array.isArray(data.documents) && data.documents.length > 0) {
      const byType = new Map(data.documents.map((d) => [d.document_type, d]));
      setDocuments((prev) => {
        const next = { ...prev };
        (["birth_certificate", "aadhaar_card", "medical_information", "caste_certificate"] as const).forEach((key) => {
          const doc = byType.get(key);
          if (doc) {
            next[key] = {
              status: "success",
              fileName: doc.original_name || "Uploaded document",
              url: doc.file_url || null,
              error: null,
              uploadedAt: doc.uploaded_at || null,
            };
          }
        });
        return next;
      });
    }

    // Fee plan previously always looked unassigned on edit even when the
    // student already had one — StudentFeesStep reconstructs it from these.
    try {
      const assignmentsData = await feesApi.listAssignments({
        student: targetStudentId,
        academic_year: data.academic_year ?? undefined,
      });
      setExistingFeeAssignments(listData<FeesAssignment>(assignmentsData));
    } catch {
      setExistingFeeAssignments([]);
    }
  };

  const updateStateCityMap = (nextState: string, nextCities: string[]) => {
    const cleanState = sanitizeText(nextState);
    const cleanCities = Array.from(new Set(nextCities.map((value) => sanitizeText(value)).filter(Boolean)));
    if (!cleanState || cleanCities.length === 0) return;
    setStateCityMap((prev) => {
      const existing = prev[cleanState] || [];
      return {
        ...prev,
        [cleanState]: Array.from(new Set([...existing, ...cleanCities])).sort((a, b) => a.localeCompare(b)),
      };
    });
  };

  const loadCitiesForState = async (targetState: string) => {
    const cleanState = sanitizeText(targetState);
    if (!cleanState) {
      setCityOptions([]);
      setCity("");
      return;
    }

    setCityLoading(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
      const uniqueOptions = Array.from(new Set(stateCityMap[cleanState] || [])).sort((a, b) => a.localeCompare(b));
      setCityOptions(uniqueOptions);
      setCity((prev) => (uniqueOptions.includes(prev) ? prev : uniqueOptions[0] || ""));
    } finally {
      setCityLoading(false);
    }
  };

  const lookupAddressByPincode = async (pinCode: string) => {
    const pin = pinCode.trim();
    if (!/^\d{6}$/.test(pin) || pin === lastPinLookup) return;

    setPinLookupLoading(true);
    setPinLookupMessage("");
    setSingleFieldError("pincode", "");
    setLastPinLookup(pin);

    try {
      const response = await apiGet<PincodeLookupResponse>(`/api/v1/students/students/pincode-details/?pincode=${encodeURIComponent(pin)}`);
      const data = response.data;
      const resolvedState = sanitizeText(String(data?.state || ""));
      const resolvedDistrict = sanitizeText(String(data?.district || ""));
      const resolvedCity = sanitizeText(String(data?.city || ""));
      const resolvedCityOptions = Array.from(new Set((data?.city_options || []).map((value) => sanitizeText(String(value))).filter(Boolean)));

      if (!response.success || !resolvedState || !resolvedDistrict || (!resolvedCity && resolvedCityOptions.length === 0)) {
        setSingleFieldError("pincode", "Invalid PIN Code");
        setPinLookupMessage("");
        setManualAddressMode(true);
        setStateName("");
        setDistrict("");
        setCity("");
        setCityOptions([]);
        return;
      }

      updateStateCityMap(resolvedState, resolvedCityOptions.length > 0 ? resolvedCityOptions : [resolvedCity]);
      setManualAddressMode(false);
      setStateName(resolvedState);
      setDistrict(resolvedDistrict);

      const nextCities = resolvedCityOptions.length > 0 ? resolvedCityOptions : [resolvedCity];
      setCityOptions(nextCities);
      setCity(nextCities.includes(resolvedCity) ? resolvedCity : nextCities[0]);

      setPinLookupMessage(
        data?.multiple_post_offices
          ? `Address auto-filled from PIN code. Multiple post offices found; first city selected.`
          : "Address auto-filled from PIN code.",
      );
      setSingleFieldError("pincode", "");
      setSingleFieldError("state", "");
      setSingleFieldError("district", "");
      setSingleFieldError("city", "");
    } catch (error) {
      const message = parsePincodeError(error) || "Could not auto-fetch address. Please enter State, District, and City manually.";
      if (/invalid pin code/i.test(message)) {
        setSingleFieldError("pincode", "Invalid PIN Code");
        setPinLookupMessage("");
        setStateName("");
        setDistrict("");
        setCity("");
        setCityOptions([]);
      } else {
        setPinLookupMessage(message.includes("Pincode must be exactly 6 digits") ? message : "Could not auto-fetch address. Please enter State, District, and City manually.");
      }
      setManualAddressMode(true);
    } finally {
      setPinLookupLoading(false);
    }
  };

  // Previously this also fired a second, independent pincode lookup straight to
  // api.postalpincode.in from the browser on blur, racing the debounced backend
  // lookup below — whichever of the two resolved last silently overwrote the
  // other's State/District/City, which is what QA saw as "City fills correctly
  // but a previously-selected State resets to blank and District clears." The
  // backend endpoint is the single source of truth (it already validates
  // state+district are present, caches results, etc.), so blur now just asks
  // it to run immediately instead of waiting out the debounce — no second path.
  const lookupPincodeOnBlur = (pin: string) => {
    void lookupAddressByPincode(pin);
  };

  const initializeAdmissionNo = async (force = false) => {
    if (isExistingStudentMode) return;
    if (admissionNoInitRequestedRef.current) return;
    if (isManualEditRef.current) return;
    if (!force && admissionNoRef.current.trim()) return;

    admissionNoInitRequestedRef.current = true;
    try {
      const nextAdmissionNo = await fetchNextAdmissionNoFromApi();
      setAdmissionNo((prev) => {
        if (isManualEditRef.current) return prev;
        return prev.trim() ? prev : nextAdmissionNo;
      });
    } catch (e) {
      console.error("Failed to initialize admission number:", e);
    }
  };

  // Track which student id (or "new"/"draft") we've already hydrated for, so the
  // effect can safely re-run when useSearchParams() updates after hydration in
  // App Router (the first render can briefly read empty params, which would
  // otherwise leave the edit form blank with stale "new student" defaults).
  const hydratedKeyRef = useRef<string | null>(null);
  const baseLookupsLoadedRef = useRef(false);

  useEffect(() => {
    const targetKey = isExistingStudentMode && studentId ? `student:${studentId}` : "new";
    if (hydratedKeyRef.current === targetKey) return;
    hydratedKeyRef.current = targetKey;

    const loadAll = async () => {
      try {
        // Edit-mode fast-path: kick off the student detail fetch in PARALLEL
        // with the heavier base-lookup paging (classes/categories/guardians).
        // The form fields are bound to the student data, so applying it the
        // moment it arrives lets the user see populated values within ~150 ms
        // instead of waiting 3-5 s for guardian pagination to finish.
        const studentPromise = isExistingStudentMode && studentId
          ? loadStudentForMode(studentId).catch((studentError) => {
              setError(parseError(studentError));
            })
          : null;

        if (!baseLookupsLoadedRef.current) {
          baseLookupsLoadedRef.current = true;
          await loadBaseLookups();
        }

        if (studentPromise) {
          await studentPromise;
        } else {
          // NOTE: do NOT auto-generate admission number here. We defer it until
          // the user actually types a first name (see effect below) so the form
          // doesn't show a wasted/random ADM number on a blank screen.
          restoreDraftSnapshot();
          // Nothing can be assigned yet for a student that doesn't exist server-side.
          setExistingFeeAssignments([]);
        }
      } catch (loadError) {
        setError(parseError(loadError));
      }
    };
    void loadAll();
  }, [isExistingStudentMode, studentId]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const flag = sessionStorage.getItem('enrollScanBannerDismissed') === 'true';
      setBannerDismissed(flag);
    }
  }, []);

  useEffect(() => {
    const update = () => {
      if (autoSaving) {
        setDraftLabel('Saving…');
      } else if (draftSavedAt !== null) {
        setDraftLabel('Draft saved');
      } else {
        setDraftLabel('Unsaved changes');
      }
    };
    update();
    const timer = window.setInterval(update, 60000);
    return () => window.clearInterval(timer);
  }, [draftSavedAt, autoSaving]);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        // TODO: GET /api/students/count when backend endpoint is ready.
        const response = await apiGet<{ count?: number; results?: unknown[] }>("/api/v1/students/students/?page_size=1");
        const count = (response as { count?: number })?.count ?? (response as { data?: { count?: number } })?.data?.count;
        if (typeof count === "number") {
          setCurrentEnrolledCount(new Intl.NumberFormat("en-IN").format(count));
        } else {
          setCurrentEnrolledCount("0");
        }
      } catch {
        setCurrentEnrolledCount("—");
      }
    };
    void fetchCount();
  }, []);

  useEffect(() => {
    // Wizard mode: sections are display-gated by `activeNavSection`, so the
    // scroll observer is no longer needed (and would race with sidebar clicks).
    // Kept as a no-op to preserve hook ordering.
    return;
  }, [loading]);

  useEffect(() => {
    if (!classId) {
      setSections([]);
      setSectionId("");
      return;
    }
    void loadSectionsForClass(classId);
  }, [classId]);

  useEffect(() => {
    if (!pendingSectionId || sections.length === 0) return;
    const matched = sections.some((row) => String(row.id) === pendingSectionId);
    if (matched) {
      setSectionId(pendingSectionId);
      setPendingSectionId("");
    }
  }, [pendingSectionId, sections]);

  useEffect(() => {
    if (!/^\d{6}$/.test(pincode.trim())) {
      setPinLookupMessage("");
      setLastPinLookup("");
      // Only clear auto-filled address fields; never wipe manually-entered values
      if (!manualAddressMode) {
        setStateName("");
        setDistrict("");
        setCity("");
        setCityOptions([]);
      }
      return;
    }

    const timer = window.setTimeout(() => {
      void lookupAddressByPincode(pincode);
    }, 400);

    return () => window.clearTimeout(timer);
  }, [pincode]);

  useEffect(() => {
    if (!dateOfBirth) return;
    setDobDisplay(formatDobDisplayFromISO(dateOfBirth));
  }, [dateOfBirth]);

  const showToast = (message: string, type: "success" | "error" = "success", durationMs = 4000) => {
    setToastType(type);
    setToastMessage(message);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage("");
      toastTimerRef.current = null;
    }, durationMs);
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!dateOfBirth || !classId) {
      setClassAgeWarning("");
      return;
    }
    // This used to look up CLASS_AGE_RULES_STRICT by the class's exact name
    // ("1", "2", … "LKG") — but real class names in this app are always
    // "Grade 1".."Grade 12" / "LKG" / "UKG" / "Nursery" (see Class.class_names,
    // backend/apps/core/models.py), so that lookup was undefined for every
    // real class, every time, and this warning silently never fired for
    // anyone — which is why the backend's own age-vs-class rejection kept
    // showing up on the Documents step no matter what DOB/class was picked;
    // nothing upstream (step navigation, the pre-upload check) had a real
    // warning to block on. Extract the grade number the same way the backend
    // does (regex digits out of the name) and use the exact same integer
    // CLASS_AGE_RULES table + "age as of today" calculation as the backend's
    // _validate_dob_for_class, so the two can never disagree again.
    const selectedClass = orderedClasses.find((item) => String(item.id) === classId);
    const className = String(selectedClass?.name || "").trim();
    const classMatch = className.match(/\d+/);
    const classNumber = classMatch ? Number(classMatch[0]) : null;
    const rule = classNumber ? CLASS_AGE_RULES[classNumber] : null;
    if (!rule) {
      setClassAgeWarning("");
      return;
    }
    const dobDate = new Date(`${dateOfBirth}T00:00:00`);
    if (Number.isNaN(dobDate.getTime())) return;
    const age = (Date.now() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    const [minAge, maxAge] = rule;
    if (age < minAge || age > maxAge) {
      setClassAgeWarning(`Age-class mismatch: expected ${minAge}-${maxAge} years for this grade.`);
      return;
    }
    setClassAgeWarning("");
  }, [dateOfBirth, classId, orderedClasses]);

  useEffect(() => {
    let cancelled = false;
    const loadHouses = async () => {
      try {
        const res = await apiGet<{results?: Array<{id:number; name:string; emoji:string; color:string; bg_color:string; students_count:number}>; count?: number} | Array<{id:number; name:string; emoji:string; color:string; bg_color:string; students_count:number}>>(
          `/api/v1/students/groups/?type=HOUSE&sort_by=count&page_size=50`
        );
        if (cancelled) return;
        const raw = Array.isArray(res) ? res : (res.results || []);
        setHouseGroups(raw.map(h => ({id: String(h.id), name: h.name, emoji: h.emoji || '🏠', color: h.color || '#6c3ce1', bgColor: h.bg_color || '#f3f0ff', studentsCount: h.students_count || 0})));
      } catch { /* non-fatal */ }
    };
    void loadHouses();
    return () => { cancelled = true; };
  }, []);

  const suggestHouse = async () => {
    if (houseGroups.length === 0) return;
    setHouseAiLoading(true);
    try {
      const res = await apiGet<{houses: Array<{groupId:number; groupName:string; count:number; emoji?:string}>; total:number}>(
        `/api/v1/students/groups/sortwell-preview/`
      );
      const houses = res.houses || [];
      if (houses.length === 0) { setHouseAiLoading(false); return; }
      // Sort by count ascending (fewest students = most balanced)
      const sorted = [...houses].sort((a, b) => a.count - b.count);
      const best = sorted[0];
      const genderNote = gender === 'female' ? ' This also helps gender balance.' : gender === 'male' ? ' This also helps gender balance.' : '';
      setHouseAiSuggestion({
        groupId: String(best.groupId),
        groupName: best.groupName,
        reason: `${best.groupName} has the fewest students (${best.count}) — assigning here maintains balanced house sizes.${genderNote}`,
      });
    } catch { /* non-fatal */ } finally {
      setHouseAiLoading(false);
    }
  };

  useEffect(() => {
    if (academicYearId || validAcademicYears.length === 0) return;
    // Prefer the school's actual "current" academic year (set in Academics →
    // Foundation → Academic Year) over a calendar guess — the guess is only a
    // fallback for schools that haven't flagged one yet, since fee groups and
    // other year-scoped data are only ever configured against the real one.
    const currentYear = validAcademicYears.find((y) => y.is_current);
    if (currentYear) {
      setAcademicYearId(String(currentYear.id));
      return;
    }
    const now = new Date();
    const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    const targetName = `${startYear}-${startYear + 1}`;
    const match = validAcademicYears.find((y) => String(y.name).trim() === targetName);
    if (match) setAcademicYearId(String(match.id));
  }, [validAcademicYears, academicYearId]);

  useEffect(() => {
    if (!classId || !sectionId || !academicYearId || rollNo.trim()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiGet<{ success: boolean; roll_no: string }>(
          `/api/v1/students/students/next-roll-no/?class_id=${encodeURIComponent(classId)}&section_id=${encodeURIComponent(sectionId)}&academic_year_id=${encodeURIComponent(academicYearId)}`,
        );
        if (!cancelled && res.success && res.roll_no) {
          setRollNo(res.roll_no);
          setAutoFilledFields((prev) => new Set(prev).add("roll_no"));
        }
      } catch {
        /* non-fatal */
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [classId, sectionId, academicYearId, rollNo]);

  useEffect(() => {
    if (!classId || !academicYearId) {
      setSectionsSummary([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiGet<{ success: boolean; sections: Array<{ section_id: number; name: string; count: number; capacity: number }> }>(
          `/api/v1/students/students/sections-summary/?class_id=${encodeURIComponent(classId)}&academic_year_id=${encodeURIComponent(academicYearId)}`,
        );
        if (!cancelled && res.success) setSectionsSummary(res.sections || []);
      } catch {
        if (!cancelled) setSectionsSummary([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [classId, academicYearId]);

  useEffect(() => {
    if (!stateName || motherTongue) return;
    const suggestion = STATE_TONGUE_MAP[stateName];
    if (suggestion && MOTHER_TONGUES.includes(suggestion)) {
      setMotherTongue(suggestion);
      setAutoFilledFields((prev) => new Set(prev).add("mother_tongue"));
    }
  }, [stateName, motherTongue]);

  useEffect(() => {
    const primary = guardianDrafts[0];
    if (!primary) return;
    const name = primary.fullName?.trim() || "";
    const ph = primary.phone?.trim() || "";
    // Re-run on every keystroke of the guardian's name (guardianDrafts changes as the
    // admin types), so `!emergencyName` alone only lets the very first character
    // through — after that emergencyName is non-empty and the guard blocks every
    // later keystroke, permanently stranding the field at 1-2 characters (QA: guardian
    // "Ramesh Sharma" copied in as just "Ra"). Mirror the guardian's name/phone as long
    // as the user hasn't manually overridden it (`emergencyCopiedFromGuardian` flips to
    // false on manual edit — see the input's onChange below), not just while it's empty.
    if (name && (!emergencyName || emergencyCopiedFromGuardian)) {
      setEmergencyName(name);
      setEmergencyCopiedFromGuardian(true);
    }
    if (ph && isValidPhone(ph) && (!emergencyPhone || emergencyCopiedFromGuardian)) {
      setEmergencyPhone(ph);
      setEmergencyCopiedFromGuardian(true);
    }
  }, [guardianDrafts, emergencyName, emergencyPhone, emergencyCopiedFromGuardian]);

  // Phase C — runInferences: derive helpful defaults from class number
  useEffect(() => {
    if (!classId) return;
    const cls = orderedClasses.find((c) => String(c.id) === classId);
    const m = String(cls?.name || "").match(/\d+/);
    const n = m ? Number(m[0]) : null;
    if (n != null) {
      const suggested: string[] = [];
      if (n <= 5) suggested.push("bcg", "opv", "dpt", "mmr");
      if (n >= 5 && n <= 8) suggested.push("tdap");
      if (n >= 6) suggested.push("hpv");
      // These are age-typical vaccines, not a confirmed medical record — silently
      // ticking the checkbox (as this used to do) meant e.g. HPV showed as
      // "completed" for any class 6+ student purely from their grade, with no
      // way to tell it apart from an admin's own confirmed entry (QA flagged
      // this as a real risk of submitting inaccurate medical records). Surface
      // it only as an unchecked hint; the admin must still tick it themselves.
      setSuggestedVaccinations(suggested);
    } else {
      setSuggestedVaccinations([]);
    }
  }, [classId, orderedClasses]);

  // Phase D — APAAR ID format check only. This never actually calls APAAR/UDISE+
  // or any government registry — it's a plain 12-digit length check behind a
  // fake 700ms "verifying" delay. Any 12-digit string, including an obviously
  // made-up one, used to come back labeled "✓ APAAR verified." (QA flagged this
  // as accepting a false APAAR ID as verified). Since there's no real
  // verification backend to call, this only ever claims a format check now —
  // never a genuine verification against a government source.
  useEffect(() => {
    if (apaarRaw.length !== 12) {
      setApaarStatus("idle");
      return;
    }
    setApaarStatus("verifying");
    const timer = window.setTimeout(() => {
      setApaarStatus("verified");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [apaarRaw]);

  useEffect(() => {
    if (!success) return;
    showToast(success, "success", 4000);
  }, [success]);

  useEffect(() => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      let changed = false;

      const clearIf = (field: string, condition: boolean) => {
        if (next[field] && condition) {
          delete next[field];
          changed = true;
        }
      };

      const cleanFirstName = sanitizeText(firstName);
      const cleanLastName = sanitizeText(lastName);
      const dobDate = dateOfBirth ? new Date(dateOfBirth) : null;
      const hasValidDobDate = Boolean(dobDate && !Number.isNaN(dobDate.getTime()) && dobDate <= new Date());

      let hasValidClassAge = true;
      if (hasValidDobDate && classId) {
        const age = (Date.now() - (dobDate as Date).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (age < 3) {
          hasValidClassAge = false;
        } else {
          const selectedClass = validClasses.find((item) => String(item.id) === classId);
          const className = String(selectedClass?.name || "");
          const classMatch = className.match(/\d+/);
          const classNumber = classMatch ? Number(classMatch[0]) : null;
          if (classNumber && CLASS_AGE_RULES[classNumber]) {
            const [minAge, maxAge] = CLASS_AGE_RULES[classNumber];
            hasValidClassAge = age >= minAge && age <= maxAge;
          }
        }
      }

      clearIf("first_name", Boolean(cleanFirstName && isProperName(cleanFirstName)));
      clearIf("last_name", Boolean(cleanLastName && isProperName(cleanLastName)));
      clearIf("dob", Boolean(hasValidDobDate && hasValidClassAge));
      clearIf("gender", Boolean(gender));
      clearIf("custom_gender", gender !== "other" || Boolean(sanitizeText(customGender)));
      clearIf("mother_tongue", Boolean(motherTongue));
      clearIf("other_mother_tongue", motherTongue !== "Other" || Boolean(sanitizeText(otherMotherTongue)));
      clearIf("nationality", Boolean(nationality));
      clearIf("other_nationality", nationality !== "Other" || Boolean(sanitizeText(otherNationality)));
      clearIf("academic_year", Boolean(academicYearId && validAcademicYears.some((row) => String(row.id) === academicYearId)));
      clearIf("class", Boolean(classId && validClasses.some((row) => String(row.id) === classId)));
      clearIf("section", Boolean(sectionId && sections.some((item) => String(item.id) === sectionId)));
      clearIf("phone", isValidPhone(phone));
      clearIf("email", !email.trim() || isValidEmail(email));
      clearIf("state", Boolean(sanitizeText(stateName)));
      clearIf("district", Boolean(sanitizeText(district)));
      clearIf("city", Boolean(sanitizeText(city)));
      clearIf("pincode", !pincode.trim() || isValidPincode(pincode));
      clearIf("guardian", Boolean(guardianId));
      clearIf("consent", Boolean(consentChecked));
      clearIf("rte_certificate", admissionType !== "RTE Quota" || Boolean(sanitizeText(rteCertificateNo)));

      return changed ? next : prev;
    });
  }, [
    firstName,
    lastName,
    dateOfBirth,
    classId,
    validClasses,
    gender,
    customGender,
    motherTongue,
    otherMotherTongue,
    nationality,
    otherNationality,
    academicYearId,
    validAcademicYears,
    sectionId,
    sections,
    phone,
    email,
    stateName,
    district,
    city,
    pincode,
    guardianId,
    consentChecked,
    admissionType,
    rteCertificateNo,
  ]);

  const resetStudentForm = () => {
    setAdmissionNo("");
    setIsManualEdit(false);
    admissionNoInitRequestedRef.current = false;
    setRollNo("");
    setFirstName("");
    setMiddleName("");
    setLastName("");
    setDateOfBirth("");
    setAcademicYearId("");
    setGender("male");
    setCustomGender("");
    setBloodGroup("");
    setPhone("");
    setEmail("");
    setAddressLine("");
    setCity("");
    setDistrict("");
    setStateName("");
    setPincode("");
    setPhoto("");
    setPhotoName("");
    setPhotoCleared(false);
    setStatusValue("active");
    setCategoryId("");
    setGuardianId("");
    setGuardianDrafts([makeEmptyGuardianDraft(true)]);
    setGuardianCardErrors([{}]);
    setGuardianSubmitError(null);
    setClassId("");
    setSectionId("");
    setSections([]);
    setIsDisabled(false);
    setFieldErrors({});
    setAdmissionChecked(false);
    setPinLookupMessage("");
    setPinLookupLoading(false);
    setCityLoading(false);
    setCityOptions([]);
    setStateCityMap(DEFAULT_STATE_CITY_MAP);
    setManualAddressMode(false);
    setLastPinLookup("");
    setAdmissionNoEditable(false);
    setDobDisplay("");
    setClassAgeWarning("");
    setMotherTongue("");
    setOtherMotherTongue("");
    setReligion("Prefer not to say");
    setNationality("");
    setOtherNationality("");
    setAdmissionType("");
    setPreviousSchoolName("");
    setRteCertificateNo("");
    setConsentChecked(false);
    setMedicalNotes("");
    setDocBirthCertificate(false);
    setDocAadhaar(false);
    setDraftSavedAt(null);
    setFeePlan(EMPTY_FEE_PLAN);
    setFeeSummary({ groupName: "", concessionName: "", lineCount: 0, annualTotal: 0 });
  };

  const setSingleFieldError = (field: string, message: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (message) next[field] = message;
      else delete next[field];
      return next;
    });
  };

  const saveDraftNow = () => {
    setDraftSaveStatus('saving');
    setDraftSavedAt(Date.now());
    saveDraftSnapshot();
    setTimeout(() => {
      setDraftSaveStatus('saved');
      setDraftSavedModalOpen(true);
    }, 300);
  };

  const clearDraftNow = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(STUDENT_DRAFT_STORAGE_KEY);
    }
    resetStudentForm();
    void initializeAdmissionNo(true);
    setError("");
    setSuccess("");
    showToast("Draft cleared.", "success", 4000);
    jumpToSection("identity");
  };

  const dismissScanBanner = () => {
    setBannerDismissed(true);
    if (typeof window !== 'undefined') sessionStorage.setItem('enrollScanBannerDismissed', 'true');
  };

  // ---- Dirty form detection & navigation guard ----
  const bypassUnloadGuardRef = useRef(false);
  const isFormDirty = useMemo(() => {
    if (isViewMode) return false;
    return Boolean(
      firstName.trim() || lastName.trim() || dateOfBirth || phone.trim() || email.trim() ||
      addressLine.trim() || pincode.trim() || photo || classId || sectionId ||
      (guardianDrafts && guardianDrafts.some(g => g?.fullName?.trim() || g?.phone?.trim())) ||
      previousSchoolName.trim() || rteCertificateNo.trim() || medicalNotes.trim() ||
      docBirthCertificate || docAadhaar || consentChecked
    );
  }, [isViewMode, firstName, lastName, dateOfBirth, phone, email, addressLine, pincode, photo, classId, sectionId, guardianDrafts, previousSchoolName, rteCertificateNo, medicalNotes, docBirthCertificate, docAadhaar, consentChecked]);

  // Required-fields completion percent (used to decide if "Enroll" is offered on exit)
  const requiredCompletionPct = useMemo(() => {
    const checks = [
      Boolean(firstName.trim()),
      Boolean(lastName.trim()),
      Boolean(dateOfBirth),
      Boolean(gender),
      Boolean(classId),
      Boolean(sectionId),
      Boolean(phone.trim() && /^\d{10}$/.test(phone.trim())),
      Boolean(addressLine.trim()),
      Boolean(pincode.trim() && /^\d{6}$/.test(pincode.trim())),
      Boolean(guardianDrafts?.[0]?.fullName?.trim()),
      Boolean(guardianDrafts?.[0]?.phone?.trim()),
      Boolean(consentChecked),
    ];
    const filled = checks.filter(Boolean).length;
    return Math.round((filled / checks.length) * 100);
  }, [firstName, lastName, dateOfBirth, gender, classId, sectionId, phone, addressLine, pincode, guardianDrafts, consentChecked]);

  // Browser-level guard for tab close / refresh
  useEffect(() => {
    if (!isFormDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (bypassUnloadGuardRef.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isFormDirty]);

  // A session-expiry redirect (api-auth.ts) is an app-initiated navigation,
  // not an accidental one — save progress and let the redirect through instead
  // of letting the browser's native "Leave site?" dialog swallow it, which
  // makes the redirect look stuck and risks losing the in-progress form.
  useEffect(() => {
    const onSessionExpired = () => {
      if (isFormDirty) saveDraftSnapshot();
      bypassUnloadGuardRef.current = true;
    };
    window.addEventListener('eskoolia:session-expired', onSessionExpired);
    return () => window.removeEventListener('eskoolia:session-expired', onSessionExpired);
  }, [isFormDirty]);

  // App-level guard: BackButton checks window.__navGuard
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as unknown as { __navGuard?: (proceed: () => void) => boolean };
    if (!isFormDirty) {
      delete w.__navGuard;
      return;
    }
    w.__navGuard = (proceed: () => void) => {
      pendingNavRef.current = proceed;
      setUnsavedNavModalOpen(true);
      return true; // block default navigation
    };
    return () => { delete w.__navGuard; };
  }, [isFormDirty]);

  const continuePendingNav = () => {
    const proceed = pendingNavRef.current;
    pendingNavRef.current = null;
    setUnsavedNavModalOpen(false);
    if (proceed) {
      // Detach guard so the second navigation isn't blocked again
      if (typeof window !== 'undefined') {
        delete (window as unknown as { __navGuard?: unknown }).__navGuard;
      }
      proceed();
    }
  };

  const validateNavigationStep = (currentId: string, targetId: string): boolean => {
    const currentIndex = getSectionIndex(currentId);
    const targetIndex = getSectionIndex(targetId);
    
    // Allow backward navigation
    if (targetIndex <= currentIndex) return true;
    
    // Validate forward navigation based on current step
    switch (currentIndex) {
      case 0: // identity
        if (!firstName.trim()) {
          setSingleFieldError('first_name', 'First name is required before proceeding.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        if (!isProperName(firstName)) {
          setSingleFieldError('first_name', 'Enter a valid first name (letters only, e.g. Rahul).');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        if (!lastName.trim()) {
          setSingleFieldError('last_name', 'Last name is required before proceeding.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        if (!isProperName(lastName)) {
          setSingleFieldError('last_name', 'Enter a valid last name (letters only, e.g. Sharma).');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        if (!dateOfBirth) {
          setSingleFieldError('dob', 'Date of birth is required before proceeding.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        break;
      case 1: // academic
        if (!classId) {
          setSingleFieldError('class', 'Class is required before proceeding.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        // Age-vs-class mismatch is informational only (see classAgeWarning's inline
        // display below on this step) — product decision: late admissions, repeated
        // grades etc. are legitimate, so this must never block navigation or submit.
        break;
      case 2: // contact
        if (!phone.trim()) {
          setSingleFieldError('phone', 'Phone number is required.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        if (!isValidPhone(phone.trim())) {
          setSingleFieldError('phone', 'Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        if (email.trim() && !isValidEmail(email)) {
          setSingleFieldError('email', 'Enter a valid email address (e.g. parent@gmail.com).');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        if (pincode && pincode.length !== 6) {
          setSingleFieldError('pincode', 'Pincode must be exactly 6 digits.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        break;
      case 3: // guardians
        if (!guardianDrafts[0]?.fullName?.trim()) {
          setSingleFieldError('guardian_name', 'Guardian 1 name is required.');
          setActiveNavSection('guardians');
          return false;
        }
        if (!guardianDrafts[0]?.phone?.trim()) {
          setSingleFieldError('guardian_phone', 'Guardian 1 phone is required.');
          setActiveNavSection('guardians');
          return false;
        }
        break;
      case 5: // documents (index 5)
        if (!consentChecked) {
          setSingleFieldError('consent', 'Parent/guardian consent is required to proceed.');
          setActiveNavSection(currentId as NavItemId);
          return false;
        }
        break;
      case 6: // medical (index 6)
        if (!emergencyName.trim()) {
          setSingleFieldError('emergency_name', 'Emergency contact name is required.');
          setActiveNavSection('medical');
          return false;
        }
        if (!emergencyPhone.trim()) {
          setSingleFieldError('emergency_phone', 'Emergency contact phone is required.');
          setActiveNavSection('medical');
          return false;
        }
        if (!isValidPhone(emergencyPhone)) {
          setSingleFieldError('emergency_phone', 'Enter a valid 10-digit mobile number starting with 6-9.');
          setActiveNavSection('medical');
          return false;
        }
        break;
      // Indexes 4-9: no hard block
      default:
        break;
    }
    
    return true;
  };

  const jumpToSection = (id: string) => {
    setActiveNavSection(id as NavItemId);
    setMaxReachedIdx(prev => Math.max(prev, getSectionIndex(id)));
    if (id === 'review') setReturnToReview(false);
    // In wizard mode the new step renders at the top of the scroll area.
    window.setTimeout(() => {
      const scrollEl = document.querySelector(".enroll-scroll") as HTMLElement | null;
      if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
      else window.scrollTo({ top: 0, behavior: "smooth" });
    }, 50);
  };

  const getSectionCounter = (id: NavItemId): string => {
    const idx = NAV_ITEMS.findIndex((n) => n.id === id);
    const total = NAV_ITEMS.length;
    return `${String(idx + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
  };

  const getSectionIndex = (id: string): number => {
    return NAV_ITEMS.findIndex((item) => item.id === id);
  };

  const FIELD_SECTION_MAP: Record<string, NavItemId> = {
    admission_no: "identity",
    roll_no: "identity",
    first_name: "identity",
    last_name: "identity",
    dob: "identity",
    date_of_birth: "identity",
    gender: "identity",
    custom_gender: "identity",
    blood_group: "identity",
    mother_tongue: "identity",
    other_mother_tongue: "identity",
    nationality: "identity",
    other_nationality: "identity",
    photo: "identity",
    apaar_id: "apaar",
    academic_year: "academic",
    class: "academic",
    section: "academic",
    category: "academic",
    rte_certificate: "academic",
    admission_type: "academic",
    stream: "academic",
    phone: "contact",
    email: "contact",
    address_line: "contact",
    city: "contact",
    district: "contact",
    state: "contact",
    pincode: "contact",
    guardian: "guardians",
    aadhaar_no: "apaar",
    aadhaar: "apaar",
    pen: "apaar",
    digi_mobile: "apaar",
    abc_id: "apaar",
    apaar_consent: "apaar",
    disability_type: "speciallyAbled",
    disability_percent: "speciallyAbled",
    udid: "speciallyAbled",
    accommodations_field: "speciallyAbled",
    identity_marks: "identityMarks",
    eye_colour: "identityMarks",
    hair_colour: "identityMarks",
    complexion: "identityMarks",
    build: "identityMarks",
    emergency_name: "medical",
    emergency_phone: "medical",
    consent: "documents",
    review_confirm: "review",
  };

  const jumpToFirstErrorSection = (errors: Record<string, string>) => {
    const errorFields = Object.keys(errors);
    if (errorFields.length === 0) return;

    let targetSection: NavItemId | null = null;
    for (const nav of NAV_ITEMS) {
      const hasErrorInSection = errorFields.some((field) => FIELD_SECTION_MAP[field] === nav.id);
      if (hasErrorInSection) {
        targetSection = nav.id as NavItemId;
        break;
      }
    }

    if (!targetSection) {
      targetSection = FIELD_SECTION_MAP[errorFields[0]] || null;
    }

    if (targetSection) {
      jumpToSection(targetSection);
    }
  };

  const renderSectionNavButtons = (currentSectionId: string) => {
    const currentIndex = getSectionIndex(currentSectionId);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < NAV_ITEMS.length - 1;
    const prevItem = hasPrev ? NAV_ITEMS[currentIndex - 1] : null;
    const nextItem = hasNext ? NAV_ITEMS[currentIndex + 1] : null;

    return (
      <div style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, paddingTop: 20, borderTop: '1px solid #e5e7eb', gap: 12, position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {hasPrev ? (
            <button
              type="button"
              onClick={() => jumpToSection(prevItem!.id)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 22px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500, color: '#374151', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
            >
              ← {prevItem!.label}
            </button>
          ) : (
            <div />
          )}
          {returnToReview && currentSectionId !== 'review' ? (
            <button
              type="button"
              onClick={() => jumpToSection('review')}
              style={{ padding: '8px 16px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#374151', fontFamily: 'inherit' }}
            >
              ← Back to Review
            </button>
          ) : null}
        </div>
        {hasNext ? (
          <button
            type="button"
            onClick={() => { if (validateNavigationStep(currentSectionId, nextItem!.id)) jumpToSection(nextItem!.id); }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 22px', border: '1px solid #6c3ce1', background: '#6c3ce1', color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600, fontFamily: 'inherit', whiteSpace: 'nowrap', boxShadow: '0 1px 2px rgba(108,60,225,0.18)' }}
          >
            {nextItem!.label} →
          </button>
        ) : (
          <div />
        )}
      </div>
    );
  };

  const validateCurrentStep = (stepId: string): boolean => {
    const errors: Record<string, string> = {};
    switch (stepId) {
      case 'identity':
        if (!firstName.trim()) errors.first_name = 'First name is required.';
        if (!lastName.trim()) errors.last_name = 'Last name is required.';
        if (!dateOfBirth) errors.dob = 'Date of birth is required.';
        break;
      case 'academic':
        if (!academicYearId) errors.academic_year = 'Academic year is required.';
        if (!classId) errors.class = 'Class is required.';
        if (!sectionNotRequired && !sectionId && !sectionLater) errors.section = 'Section is required (or check Assign later).';
        break;
      case 'contact':
        if (!phone.trim()) errors.phone = 'Phone is required.';
        else if (!isValidPhone(phone)) errors.phone = 'Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.';
        if (!addressLine.trim()) errors.address_line = 'Address line is required.';
        if (!stateName) errors.state = 'State is required.';
        if (!district) errors.district = 'District is required.';
        if (!city) errors.city = 'City is required.';
        if (!pincode.trim()) errors.pincode = 'Pincode is required.';
        break;
      case 'guardians':
        if (!guardianDrafts[0]?.fullName?.trim() || !guardianDrafts[0]?.phone?.trim()) {
          errors.guardian = 'Primary guardian name and phone are required.';
        }
        break;
      case 'documents':
        if (!consentChecked) errors.consent = 'Parent/guardian consent is required to proceed.';
        break;
      default:
        return true;
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(prev => ({ ...prev, ...errors }));
      jumpToFirstErrorSection(errors);
      return false;
    }
    return true;
  };

  const onDobMaskedChange = (nextMasked: string) => {
    const masked = toDobMask(nextMasked);
    setDobDisplay(masked);
    const iso = parseDobMaskedToISO(masked);
    setDateOfBirth(iso);
  };

  const runAdmissionAvailabilityCheck = async (valueOverride?: string): Promise<boolean> => {
    const value = sanitizeText(typeof valueOverride === "string" ? valueOverride : admissionNo);
    setAdmissionChecked(false);
    setAdmissionConflict(null);
    if (!value) {
      setSingleFieldError("admission_no", "Admission number is required");
      return false;
    }
    if (!isValidAdmissionOrRoll(value)) {
      setSingleFieldError("admission_no", "Admission number should contain only letters and numbers");
      return false;
    }
    if (!ADMISSION_NO_FORMAT_REGEX.test(value)) {
      setSingleFieldError("admission_no", "Admission number must be in format ADM followed by 7-9 digits (e.g. ADM2026001)");
      return false;
    }

    try {
      setCheckingAdmission(true);
      const query = new URLSearchParams({ admission_no: value });
      // In edit mode, exclude the record being edited. In the new-enrollment
      // flow, the document-upload step auto-saves a draft Student row under
      // this same admission number before the user can return here — exclude
      // that just-created draft too, or the check false-positives against it.
      const excludeId = (isEditMode && studentId) ? studentId : newlyCreatedStudentId;
      if (excludeId) query.set("exclude_id", String(excludeId));
      const payload = await apiGet<{ exists: boolean; conflict_student?: { id: number; name: string; class_name: string; section_name: string; is_draft?: boolean } }>(`/api/v1/students/students/check-admission-no/?${query.toString()}`);
      if (payload.exists) {
        const conflict = payload.conflict_student ?? null;
        setAdmissionConflict(conflict);
        const conflictDetail = conflict
          ? ` Currently assigned to: ${conflict.name}${conflict.is_draft ? " (draft)" : ""}, ${conflict.class_name} – ${conflict.section_name}`
          : "";
        setSingleFieldError("admission_no", `Admission number already exists.${conflictDetail}`);
        setAdmissionChecked(false);
        return false;
      } else {
        setSingleFieldError("admission_no", "");
        setAdmissionConflict(null);
        setAdmissionChecked(true);
        return true;
      }
    } catch {
      setSingleFieldError("admission_no", "Unable to verify admission number right now");
      return false;
    } finally {
      setCheckingAdmission(false);
    }
  };

  const validateClient = () => {
    const nextErrors: Record<string, string> = {};

    const validatePhoneInline = (value: string) => {
      if (!value.trim()) return "Phone number is required";
      if (!isValidPhone(value)) return "Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9";
      return "";
    };

    if (!sanitizeText(admissionNo)) {
      nextErrors.admission_no = "Admission number is required";
    } else if (!isValidAdmissionOrRoll(admissionNo)) {
      nextErrors.admission_no = "Admission number should contain only letters and numbers";
    }

    if (rollNo.trim() && !isValidNumericRoll(rollNo)) {
      nextErrors.roll_no = "Roll number must contain numbers only";
    }

    const cleanFirstName = sanitizeText(firstName);
    const cleanLastName = sanitizeText(lastName);
    if (!cleanFirstName) nextErrors.first_name = "First name is required";
    else if (!isProperName(cleanFirstName)) nextErrors.first_name = "Enter a valid first name (letters only, e.g. Rahul)";

    if (!cleanLastName) nextErrors.last_name = "Last name is required";
    else if (!isProperName(cleanLastName)) nextErrors.last_name = "Enter a valid last name (letters only, e.g. Sharma)";

    if (!dateOfBirth) nextErrors.dob = "Date of birth is required";
    else {
      const dobDate = new Date(dateOfBirth);
      const now = new Date();
      if (dobDate > now) {
        nextErrors.dob = "Date of birth cannot be in the future";
      } else {
        const age = (now.getTime() - dobDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
        if (age < 2) nextErrors.dob = "Student must be at least 2 years old";
      }
    }

    if (!academicYearId) nextErrors.academic_year = "Academic year is required";
    else if (!validAcademicYears.some((row) => String(row.id) === academicYearId)) nextErrors.academic_year = "Please select a valid academic year";

    if (!gender) nextErrors.gender = "Gender is required";
    if (gender === "other" && !sanitizeText(customGender)) nextErrors.custom_gender = "Please specify custom gender";

    if (!classId) nextErrors.class = "Class is required";
    else if (!validClasses.some((row) => String(row.id) === classId)) nextErrors.class = "Please select a valid class";
    // classAgeWarning is intentionally NOT added here — informational only, never blocks submit.
    if (!sectionNotRequired) {
      if (!sectionId) nextErrors.section = "Section is required";
      else if (!sections.some((item) => String(item.id) === sectionId)) nextErrors.section = "Selected section is invalid";
    }

    const phoneError = validatePhoneInline(phone);
    if (phoneError) nextErrors.phone = phoneError;

    if (!sanitizeText(addressLine)) nextErrors.address_line = "Address line is required";
    else if (sanitizeText(addressLine).length < 10) nextErrors.address_line = "Please enter a complete address (at least 10 characters)";
    if (!sanitizeText(stateName)) nextErrors.state = "State is required";
    if (!sanitizeText(district)) nextErrors.district = "District is required";
    if (!sanitizeText(city)) nextErrors.city = "City is required";
    if (email.trim() && !isValidEmail(email)) nextErrors.email = "Enter a valid email address (e.g. parent@gmail.com)";
    if (!pincode.trim()) nextErrors.pincode = "Pincode is required";
    else if (!isValidPincode(pincode)) nextErrors.pincode = "Pincode must be exactly 6 digits";

    if (categoryId && !validCategories.some((row) => String(row.id) === categoryId)) {
      nextErrors.category = "Please select a valid category";
    }

    if (!sectionNotRequired) {
      if (classId && sectionLoading) nextErrors.section = "Please wait until sections are loaded";
      if (classId && !sectionLoading && sections.length === 0) nextErrors.section = "No sections found for selected class. Use refresh.";
    }

    if (motherTongue === "Other" && !sanitizeText(otherMotherTongue)) {
      nextErrors.other_mother_tongue = "Please specify language.";
    }

    if (!nationality) {
      nextErrors.nationality = "Nationality is required";
    }
    if (nationality === "Other" && !sanitizeText(otherNationality)) {
      nextErrors.other_nationality = "Please specify nationality.";
    }

    if (admissionType === "RTE Quota" && !sanitizeText(rteCertificateNo)) {
      nextErrors.rte_certificate = "RTE certificate number is required.";
    }

    if (!admissionType) nextErrors.admission_type = "Admission type is required";

    if (aadhaarNo.trim() && !isValidAadhaar(aadhaarNo)) nextErrors.aadhaar = "Aadhaar must be exactly 12 digits (no repeated digits)";

    if (!consentChecked) {
      nextErrors.consent = "Guardian consent confirmation is required.";
    }

    // Guardian check: validate the DRAFT state in the UI, not `guardianId`.
    // `guardianId` is a FK to a persisted Guardian record and only gets set
    // inside persistGuardianDrafts() during submit — so at validation time a
    // freshly-typed primary card would always fail this gate. A guardian card
    // counts as valid if it's already linked to an existing guardian OR if all
    // three required fields (name, relation, phone) have content.
    const hasValidGuardian = guardianDrafts.some((d) => {
      if (d.linkedExistingId != null) return true;
      return !!(d.fullName?.trim() && d.relation?.trim() && d.phone?.trim());
    });
    if (!hasValidGuardian) {
      nextErrors.guardian = "At least one guardian is required before enrollment.";
    }

    // FIX 17: populate structured validation error list for the review section
    const FIELD_TO_SECTION: Record<string, NavItemId> = {
      first_name: 'identity', last_name: 'identity', dob: 'identity', gender: 'identity',
      admission_no: 'identity', nationality: 'identity',
      academic_year: 'academic', class: 'academic', section: 'academic', admission_type: 'academic',
      phone: 'contact', address_line: 'contact', state: 'contact', district: 'contact', city: 'contact', pincode: 'contact', email: 'contact',
      guardian: 'guardians',
      aadhaar_no: 'apaar', aadhaar: 'apaar', pen: 'apaar', abc_id: 'apaar', digi_mobile: 'apaar',
      consent: 'documents',
    };
    setValidationErrorList(
      Object.entries(nextErrors).map(([field, message]) => ({
        field,
        message,
        section: (FIELD_TO_SECTION[field] || 'identity') as NavItemId,
      }))
    );

    return nextErrors;
  };

  // validationErrorList (shown on the Review step) is only ever written by
  // validateClient() above, which previously only ran when the user clicked
  // "Enroll student". That meant the list was a snapshot of whatever failed on
  // the *last* submit attempt — if the user then went back, fixed things (e.g.
  // uploaded the missing documents) and returned to Review without
  // resubmitting, the same old error list was still sitting there looking like
  // nothing had changed. Refresh it every time Review is actually opened so it
  // always reflects the form's current state, not a stale submit attempt.
  useEffect(() => {
    if (activeNavSection === 'review') {
      validateClient();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNavSection]);

  const syncApiFieldErrors = (apiError: ApiError) => {
    let source: Record<string, string | string[]> = apiError.details?.field_errors || {};
    if (Object.keys(source).length === 0 && apiError.details && typeof apiError.details === "object" && !Array.isArray(apiError.details)) {
      const detailsPayload = apiError.details as Record<string, unknown>;
      const fallbackSource: Record<string, string | string[]> = {};
      for (const [field, value] of Object.entries(detailsPayload)) {
        if (["message", "detail", "error", "success", "status", "code", "non_field_errors", "field_errors"].includes(field)) {
          continue;
        }
        if (typeof value === "string" || Array.isArray(value)) {
          fallbackSource[field] = value as string | string[];
        }
      }
      source = fallbackSource;
    }

    const mapped: Record<string, string> = {};
    for (const [field, value] of Object.entries(source)) {
      const mappedField = field === "date_of_birth" ? "dob" : field === "current_class" ? "class" : field === "current_section" ? "section" : field;
      mapped[mappedField] = Array.isArray(value) ? String(value[0] || "") : String(value || "");
    }
    setFieldErrors(mapped);
    return mapped;
  };

  /**
   * Persist all guardian draft cards. For each draft:
   *   - If `linkedExistingId` is set, it's already in the backend → reuse the ID.
   *   - If fully empty and non-primary, skip.
   *   - Otherwise validate and POST to create the Guardian record.
   *
   * Returns:
   *   { primaryId, allLinks } — primaryId is the ID linked to the student's legacy
   *     guardian FK; allLinks is every resolved (id, isPrimary) pair so the caller can
   *     send the *complete* guardian list to the student payload — not just the
   *     primary — so cards 2+ actually get attached to the student instead of being
   *     created as orphaned Guardian rows.
   *   { cardErrors }    — per-card field-level errors when validation fails.
   *
   * Mutates state: updates draft cards with resolved `linkedExistingId` after a successful POST.
   */
  const persistGuardianDrafts = async (): Promise<
    { ok: true; primaryId: number | null; allLinks: Array<{ id: number; isPrimary: boolean }>; updatedDrafts: GuardianDraft[]; newlyCreatedIds: number[] }
    | { ok: false; cardErrors: GuardianFieldErrors[] }
  > => {
    const cardErrors: GuardianFieldErrors[] = guardianDrafts.map(() => ({}));
    const resolvedIds: (number | null)[] = guardianDrafts.map(() => null);
    const newlyCreatedIds: number[] = [];

    // Validate synchronously first so we can short-circuit before any POST
    guardianDrafts.forEach((draft, idx) => {
      const fullName = sanitizeText(draft.fullName);
      const phone = (draft.phone || "").replace(/\D/g, "").slice(0, 10);
      const email = (draft.email || "").trim();
      const isEmpty = !fullName && !phone && !email && !(draft.occupation || "").trim();

      if (draft.linkedExistingId != null) {
        resolvedIds[idx] = draft.linkedExistingId;
      }

      if (!draft.isPrimary && isEmpty && draft.linkedExistingId == null) {
        // Empty non-primary cards are silently skipped.
        return;
      }

      // Linked drafts fall through to the same validation as new ones below —
      // previously they returned here unchecked, which meant editing an
      // already-linked guardian's fields skipped validation *and* (see the
      // save loop further down) never actually persisted the edit.
      const err: GuardianFieldErrors = {};
      if (!fullName) {
        err.fullName = "Full name is required";
      } else if (!isAlphabetsOnly(fullName)) {
        err.fullName = "Full name can only contain letters and spaces";
      }
      if (!draft.relation) {
        err.relation = "Relation is required";
      }
      if (!phone) {
        err.phone = "Phone is required";
      } else if (!isValidPhone(phone)) {
        err.phone = "Phone must be exactly 10 digits";
      }
      if (email && !isValidEmail(email)) {
        err.email = "Email format is invalid";
      }
      cardErrors[idx] = err;
    });

    // Cross-card check: each Relation (Father / Mother / Guardian / etc.) may
    // only be used by ONE guardian card. Bank the first occurrence and flag
    // any later card that re-uses the same relation.
    const seenRelations = new Map<string, number>();
    guardianDrafts.forEach((draft, idx) => {
      const fullName = sanitizeText(draft.fullName);
      const phone = (draft.phone || "").replace(/\D/g, "").slice(0, 10);
      const email = (draft.email || "").trim();
      const isEmpty = !fullName && !phone && !email && !(draft.occupation || "").trim();
      if (!draft.isPrimary && isEmpty && draft.linkedExistingId == null) return;

      const rel = sanitizeText(draft.relation || "").toLowerCase();
      if (!rel) return;
      if (seenRelations.has(rel)) {
        const dupMsg = `Relation "${draft.relation}" is already assigned to Guardian ${seenRelations.get(rel)! + 1}. Pick a different relation.`;
        cardErrors[idx] = { ...(cardErrors[idx] || {}), relation: dupMsg };
      } else {
        seenRelations.set(rel, idx);
      }
    });

    const hasErrors = cardErrors.some((e) => Object.keys(e).length > 0);
    if (hasErrors) {
      return { ok: false, cardErrors };
    }

    // POST any draft that still needs creating, or PUT an update for a linked
    // draft whose fields were actually edited since the last save. Previously
    // a linked draft was `continue`d past unconditionally here — any edit to
    // an existing guardian's name/phone/relation/email/occupation was silently
    // discarded on submit even though the form showed it as saved.
    const updatedDrafts: GuardianDraft[] = [...guardianDrafts];
    for (let idx = 0; idx < guardianDrafts.length; idx++) {
      const draft = guardianDrafts[idx];
      const fullName = sanitizeText(draft.fullName);
      const phone = (draft.phone || "").replace(/\D/g, "").slice(0, 10);
      const email = sanitizeText(draft.email);
      const relation = sanitizeText(draft.relation) || "Father";
      const occupation = sanitizeText(draft.occupation);

      if (draft.linkedExistingId != null) {
        const original = draft.original;
        const changed =
          !original ||
          original.fullName !== fullName ||
          original.relation !== relation ||
          original.phone !== phone ||
          original.email !== email ||
          original.occupation !== occupation;
        if (!changed) continue;

        try {
          const updated = await apiPutJson<Guardian & { email?: string; occupation?: string }>(
            `/api/v1/students/guardians/${draft.linkedExistingId}/`,
            { full_name: fullName, relation, phone, email, occupation },
          );
          updatedDrafts[idx] = {
            ...draft,
            fullName,
            phone,
            email,
            occupation,
            relation,
            original: { fullName, relation, phone, email, occupation },
          };
          setGuardians((prev) =>
            prev.map((g) => (g.id === updated.id ? { ...g, full_name: fullName, relation, phone } : g)),
          );
        } catch (updateError) {
          const msg = parseError(updateError) || "Failed to update this guardian";
          cardErrors[idx] = { ...cardErrors[idx], fullName: msg };
          return { ok: false, cardErrors };
        }
        continue;
      }

      const isEmpty = !fullName && !phone;
      if (!draft.isPrimary && isEmpty) continue; // empty non-primary → skip

      try {
        const created = await apiPostJson<Guardian & { email?: string; occupation?: string }>(
          "/api/v1/students/guardians/",
          { full_name: fullName, relation, phone, email, occupation },
        );
        resolvedIds[idx] = created.id;
        newlyCreatedIds.push(created.id);
        updatedDrafts[idx] = {
          ...draft,
          linkedExistingId: created.id,
          fullName,
          phone,
          email,
          occupation,
          relation,
          original: { fullName, relation, phone, email, occupation },
        };
        // Add to the school's guardian pool so the picker can see it next time
        setGuardians((prev) =>
          prev.some((g) => g.id === created.id) ? prev : [...prev, created],
        );
      } catch (createError) {
        const msg = parseError(createError) || "Failed to save this guardian";
        cardErrors[idx] = { ...cardErrors[idx], fullName: msg };
        return { ok: false, cardErrors };
      }
    }

    setGuardianDrafts(updatedDrafts);

    const primaryId = resolvedIds[0];
    const allLinks: Array<{ id: number; isPrimary: boolean }> = [];
    resolvedIds.forEach((id, idx) => {
      if (id != null) allLinks.push({ id, isPrimary: updatedDrafts[idx].isPrimary });
    });
    return { ok: true, primaryId: primaryId ?? null, allLinks, updatedDrafts, newlyCreatedIds };
  };

  // Compensating rollback for the guardian-then-student two-request save: if the
  // guardian POST(s) succeeded but the student create/finalize that follows fails,
  // the newly created guardians would otherwise be left permanently orphaned in
  // the database (confirmed in QA: guardian 201, student 500, guardian row stuck).
  // Only ever called with ids created in THIS submit attempt, never a
  // pre-existing/linked guardian, so this can't delete something still in use.
  const rollbackNewlyCreatedGuardians = async (ids: number[]) => {
    if (ids.length === 0) return;
    await Promise.all(
      ids.map((id) =>
        apiDeleteJson(`/api/v1/students/guardians/${id}/`).catch((rollbackError) => {
          console.error("Failed to roll back orphaned guardian after student save failure", id, rollbackError);
        }),
      ),
    );
  };


  // Fetches `photo` (the backend's auth-gated /media/ URL) with the same Bearer
  // token every other request uses, then exposes it to <img> tags as a local
  // blob: URL — see the note on photoDisplayUrl's declaration for why a plain
  // <img src={photo}> can never work here.
  useEffect(() => {
    if (!photo) {
      setPhotoDisplayUrl("");
      return;
    }
    // Camera-capture / freshly-picked-file flows may briefly hold a local
    // blob:/data: URL before the upload resolves — those are already directly
    // renderable, no auth involved, so pass them through untouched.
    if (photo.startsWith("blob:") || photo.startsWith("data:")) {
      setPhotoDisplayUrl(photo);
      return;
    }
    let cancelled = false;
    let objectUrl = "";
    (async () => {
      try {
        const parsed = new URL(photo);
        const response = await apiRequestWithRefreshResponse(`${parsed.pathname}${parsed.search}`, { silent401: true });
        if (!response.ok) throw new Error(`Failed to load photo (${response.status})`);
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setPhotoDisplayUrl(objectUrl);
      } catch (err) {
        console.error("Failed to load student photo", err);
        if (!cancelled) setPhotoDisplayUrl("");
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo]);

  const uploadStudentPhoto = async (file: File): Promise<boolean> => {
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setSingleFieldError("photo", "Only JPEG and PNG files are allowed");
      return false;
    }
    if (file.size > 4 * 1024 * 1024) {
      setSingleFieldError("photo", "Please choose an image up to 4MB before compression");
      return false;
    }

    try {
      setPhotoUploading(true);
      setSingleFieldError("photo", "");
      const compressed = await compressImage(file);
      const formData = new FormData();
      formData.append("photo", compressed);
      const res = await apiPostForm<{ data?: { photo?: string } }>("/api/v1/students/students/upload-photo/", formData, true);
      const uploadedUrl = String(res?.data?.photo || "");
      if (!uploadedUrl) throw new Error("Photo upload failed");
      setPhoto(uploadedUrl);
      setPhotoName(file.name);
      setPhotoCleared(false);
      setSuccess("Photo uploaded securely.");
      return true;
    } catch (uploadError) {
      setSingleFieldError("photo", parseError(uploadError));
      setPhoto("");
      setPhotoName("");
      return false;
    } finally {
      setPhotoUploading(false);
    }
  };

  const clearCapturedPhotoDraft = () => {
    setCapturedPhotoFile(null);
    setCapturedPhotoPreviewUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return "";
    });
  };

  const clearStudentPhoto = () => {
    setPhoto("");
    setPhotoName("");
    setPhotoCleared(true);
    setPhotoPreviewOpen(false);
    setSingleFieldError("photo", "");
  };

  const stopStudentCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  };

  const closeStudentCamera = () => {
    stopStudentCamera();
    clearCapturedPhotoDraft();
    setCameraOpen(false);
    setCameraError("");
  };

  const openStudentFilePicker = () => {
    if (isViewMode || photoUploading) return;
    photoInputRef.current?.click();
  };

  const openStudentCamera = () => {
    if (isViewMode || photoUploading) return;
    if (
      typeof navigator !== "undefined" &&
      navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === "function"
    ) {
      clearCapturedPhotoDraft();
      setCameraError("");
      setCameraOpen(true);
      return;
    }
    photoInputRef.current?.click();
  };

  const captureStudentPhoto = async () => {
    try {
      const video = cameraVideoRef.current;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
        throw new Error("Camera is not ready yet.");
      }

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Camera capture is not supported in this browser.");
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
      if (!blob) {
        throw new Error("Unable to capture photo.");
      }

      const file = new File([blob], `student-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      setCapturedPhotoFile(file);
      setCapturedPhotoPreviewUrl((prev) => {
        if (prev) {
          URL.revokeObjectURL(prev);
        }
        return URL.createObjectURL(file);
      });
      setCameraError("");
    } catch (captureError) {
      setCameraError(parseError(captureError) || "Unable to capture photo.");
    }
  };

  const retakeCapturedPhoto = () => {
    clearCapturedPhotoDraft();
    setCameraError("");
  };

  const applyCapturedPhoto = async () => {
    if (!capturedPhotoFile) return;
    const uploaded = await uploadStudentPhoto(capturedPhotoFile);
    if (!uploaded) return;
    closeStudentCamera();
    setPhotoPreviewOpen(true);
  };

  // Auto-save student draft when Identity + Academic fields are complete
  const autoSaveStudentDraft = async (): Promise<number | null> => {
    // If already saved, return the ID
    if (newlyCreatedStudentId) {
      return newlyCreatedStudentId;
    }

    const snapshot = studentFormRef.current;
    const classIdNum = Number(snapshot.class_id);
    const sectionIdNum = Number(snapshot.section_id);
    const academicYearNum = Number(snapshot.academic_year_id);
    const missingFields: string[] = [];
    if (!snapshot.first_name) missingFields.push("First Name");
    if (!snapshot.last_name) missingFields.push("Last Name");
    if (!snapshot.admission_no) missingFields.push("Admission Number");
    if (!snapshot.date_of_birth) missingFields.push("Date of Birth");
    if (!snapshot.gender) missingFields.push("Gender");
    if (!snapshot.academic_year_id || Number.isNaN(academicYearNum) || academicYearNum <= 0) missingFields.push("Academic Year");
    if (!snapshot.class_id || Number.isNaN(classIdNum) || classIdNum <= 0) missingFields.push("Class");
    if (!snapshot.section_id || Number.isNaN(sectionIdNum) || sectionIdNum <= 0) missingFields.push("Section");

    if (missingFields.length > 0) {
      const msg = `Please complete Identity and Academic details before uploading documents. Missing: ${missingFields.join(", ")}`;
      lastAutoSaveErrorRef.current = msg;
      showToast(`⚠️ ${msg}`, "error");
      return null;
    }

    // Age-vs-class mismatch (classAgeWarning) is intentionally NOT checked here —
    // informational only, never blocks the draft save. See its inline display on
    // the Academic step.

    const admissionAvailable = await runAdmissionAvailabilityCheck(snapshot.admission_no);
    if (!admissionAvailable) {
      jumpToSection("identity");
      const msg = "Admission number already exists. Please enter a unique admission number before uploading documents.";
      lastAutoSaveErrorRef.current = msg;
      showToast(`⚠️ ${msg}`, "error");
      return null;
    }

    setAutoSaving(true);
    try {
      const isStudentActive = statusValue === "active";
      const payload: StudentCreatePayload = {
        admission_no: snapshot.admission_no || "",
        roll_no: rollNo.trim() || undefined,
        first_name: snapshot.first_name,
        middle_name: sanitizeText(middleName) || undefined,
        last_name: snapshot.last_name,
        date_of_birth: snapshot.date_of_birth || undefined,
        academic_year: academicYearNum,
        gender: snapshot.gender === "other" ? customGender : snapshot.gender,
        custom_gender: gender === "other" ? customGender : undefined,
        blood_group: bloodGroup.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        address_line: addressLine.trim() || undefined,
        city: city.trim() || undefined,
        district: district.trim() || undefined,
        state: stateName.trim() || undefined,
        pincode: pincode.trim() || undefined,
        photo: photo ? photo : undefined,
        status: statusValue,
        category: categoryId ? Number(categoryId) : undefined,
        guardian: guardianId ? Number(guardianId) : undefined,
        current_class: classIdNum,
        current_section: sectionIdNum,
        is_disabled: isDisabled,
        is_active: isStudentActive,
        is_draft: true,
      };

      const response = await apiPostJson<StudentCreateResponse>("/api/v1/students/students/", payload);
      const createdStudentId = Number(response?.id ?? response?.data?.id);

      if (Number.isFinite(createdStudentId) && createdStudentId > 0) {
        setNewlyCreatedStudentId(createdStudentId);
        invalidateGeneratedAdmissionNoCache();
        showToast("✅ Student draft saved. Ready for document uploads.", "success");
        return createdStudentId;
      } else {
        throw new Error("No student ID returned from server");
      }
    } catch (err) {
      const fieldErrors = parseFieldErrors(err);
      const admissionError = fieldErrors.find((msg) => msg.toLowerCase().startsWith("admission no:"));
      if (admissionError) {
        const specific = admissionError.split(":").slice(1).join(":").trim() || "Admission number already exists";
        setSingleFieldError("admission_no", specific);
        jumpToSection("identity");
        lastAutoSaveErrorRef.current = `${specific}. Please use a unique admission number.`;
        showToast(`❌ ${lastAutoSaveErrorRef.current}`, "error");
        console.error("❌ Auto-save duplicate admission number:", err);
        return null;
      }

      const errorMsg = fieldErrors.length > 0
        ? `Unable to save student record. ${fieldErrors[0]}`
        : (parseError(err) || "Failed to save student draft.");
      lastAutoSaveErrorRef.current = errorMsg;
      showToast(`❌ ${errorMsg}`, "error");
      console.error("❌ Auto-save error:", err);
      return null;
    } finally {
      setAutoSaving(false);
    }
  };

  // Validate required identity fields for student creation
  const validateIdentityFields = (): { valid: boolean; missingFields: string[]; academicIncomplete: boolean } => {
    const snapshot = studentFormRef.current;
    const missingFields: string[] = [];
    let academicIncomplete = false;
    
    if (!snapshot.first_name) missingFields.push("First Name");
    if (!snapshot.last_name) missingFields.push("Last Name");
    if (!snapshot.date_of_birth) missingFields.push("Date of Birth");
    if (!snapshot.gender) missingFields.push("Gender");
    if (!snapshot.academic_year_id || Number(snapshot.academic_year_id) <= 0) {
      missingFields.push("Academic Year");
      academicIncomplete = true;
    }
    if (!snapshot.class_id || Number(snapshot.class_id) <= 0) {
      missingFields.push("Class");
      academicIncomplete = true;
    }
    if (!snapshot.section_id || Number(snapshot.section_id) <= 0) {
      missingFields.push("Section");
      academicIncomplete = true;
    }

    return { valid: missingFields.length === 0, missingFields, academicIncomplete };
  };

  // Document Upload Handler - Completely rewritten with proper state management
  const uploadDocumentFile = async (
    file: File,
    documentType: string
  ) => {
    // ============================================================
    // STEP 1: FILE VALIDATION
    // ============================================================
    const allowedTypes = [".pdf", ".jpg", ".jpeg", ".png"];
    const fileName = file.name.toLowerCase();
    if (!allowedTypes.some((ext) => fileName.endsWith(ext))) {
      const errorMsg = "Only PDF, JPG, JPEG, and PNG files are allowed.";
      console.error("📋 File type validation failed:", errorMsg);
      setDocuments((prev) => ({
        ...prev,
        [documentType]: { ...prev[documentType as keyof typeof prev], status: "error" as DocumentStatus, error: errorMsg },
      }));
      return;
    }

    if (file.size > 5242880) {
      const errorMsg = "File size must be less than 5MB.";
      console.error("📋 File size validation failed:", errorMsg);
      setDocuments((prev) => ({
        ...prev,
        [documentType]: { ...prev[documentType as keyof typeof prev], status: "error" as DocumentStatus, error: errorMsg },
      }));
      return;
    }

    // ============================================================
    // STEP 2: UPDATE STATE - SET UPLOADING
    // ============================================================
    setDocuments((prev) => ({
      ...prev,
      [documentType]: {
        ...prev[documentType as keyof typeof prev],
        status: "uploading" as DocumentStatus,
        error: null,
      },
    }));

    try {
      // ============================================================
      // STEP 3: CHECK STUDENT ID & VALIDATE IDENTITY FIELDS
      // ============================================================
      let effectiveStudentId = studentId || newlyCreatedStudentId;

      if (!effectiveStudentId) {
        // No student ID - must validate identity fields first
        const { valid, missingFields, academicIncomplete } = validateIdentityFields();

        if (!valid) {
          const errorMsg = academicIncomplete
            ? "Please complete Academic section and select Class before uploading documents."
            : `Please complete required Identity fields first: ${missingFields.join(", ")}`;
          console.warn("❌ Identity fields incomplete:", missingFields);

          // Previously reset to "idle" here — the card ends up looking exactly
          // like it did before the file was ever picked, with only an
          // auto-dismissing toast as evidence anything happened. Reported by QA
          // as "upload never registers in the UI, badge stays REQUIRED." Use the
          // card's own "error" state instead so the reason stays visible on the
          // card itself, not just in a toast that's easy to miss.
          setDocuments((prev) => ({
            ...prev,
            [documentType]: {
              ...prev[documentType as keyof typeof prev],
              status: "error" as DocumentStatus,
              error: errorMsg,
            },
          }));

          showToast(`⚠️ ${errorMsg}`, "error");
          return;
        }

        // Identity fields are complete - attempt auto-save
        try {
          lastAutoSaveErrorRef.current = "";
          effectiveStudentId = await autoSaveStudentDraft();

          if (!effectiveStudentId) {
            // Previously this always showed the same generic "see the notification
            // above" text on every card — but the toast autoSaveStudentDraft fires
            // is transient, so by the time anyone actually reads a card (especially
            // after 3 cards all failed back-to-back) the toast is long gone and
            // every card looks identically, unhelpfully broken. Show the actual
            // reason (e.g. "dob: Selected DOB does not match the required age
            // range...") directly on the card instead.
            const reason = lastAutoSaveErrorRef.current || "Could not save the student record before upload.";
            setDocuments((prev) => ({
              ...prev,
              [documentType]: {
                ...prev[documentType as keyof typeof prev],
                status: "error" as DocumentStatus,
                error: reason,
              },
            }));
            return;
          }

          setNewlyCreatedStudentId(effectiveStudentId);
        } catch (saveErr) {
          const fieldErrors = parseFieldErrors(saveErr);
          const errorMsg = fieldErrors.length > 0
            ? `Unable to save student record. ${fieldErrors[0]}`
            : (parseError(saveErr) || "Unable to prepare student draft before upload.");
          console.error("❌ Auto-save failed:", saveErr);

          setDocuments((prev) => ({
            ...prev,
            [documentType]: {
              ...prev[documentType as keyof typeof prev],
              status: "error" as DocumentStatus,
              error: errorMsg,
            },
          }));

          showToast(`⚠️ ${errorMsg}`, "error");
          return;
        }
      }

      // ============================================================
      // STEP 4: UPLOAD DOCUMENT
      // ============================================================
      const formData = new FormData();
      formData.append("student_id", String(effectiveStudentId));
      formData.append("student_draft_id", String(effectiveStudentId));
      formData.append("document_type", documentType);
      formData.append("file", file);

      const response = await apiRequestWithRefresh("/api/v1/students/documents/upload_document/", {
        method: "POST",
        body: formData,
      }) as { id?: unknown; file?: string; file_url?: string; original_name?: string; uploaded_at?: string } | null;

      // ============================================================
      // STEP 5: VALIDATE RESPONSE
      // ============================================================
      const isSuccess = response && (
        response.id || 
        response.file || 
        response.original_name || 
        response.uploaded_at
      );

      if (!isSuccess) {
        throw new Error("Invalid response from server - missing required fields");
      }

      // ============================================================
      // STEP 6: UPDATE STATE - SUCCESS
      // ============================================================
      const displayFileName = response.original_name || file.name;
      const fileUrl = response.file_url || response.file || null;

      setDocuments((prev) => ({
        ...prev,
        [documentType]: {
          status: "success" as DocumentStatus,
          fileName: displayFileName,
          url: fileUrl,
          error: null,
          uploadedAt: response.uploaded_at || new Date().toISOString(),
        },
      }));

      // Clear any previous error toast
      setLastErrorToastId(null);

      // Show success toast
      showToast(`✅ ${documentType.replace(/_/g, " ").toUpperCase()} uploaded successfully!`, "success");

    } catch (err) {
      // ============================================================
      // STEP 7: HANDLE ERROR
      // ============================================================
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error("❌ Document upload failed:", {
        documentType,
        error: errorMessage,
        fullError: err,
      });

      // Update state to error with inline message
      const displayError = errorMessage.startsWith("❌") || errorMessage.startsWith("⚠️")
        ? errorMessage.replace(/^[❌⚠️]\s*/, "")
        : errorMessage;

      setDocuments((prev) => {
        const current = prev[documentType as keyof typeof prev];
        if (current.status === "success") {
          return prev;
        }
        return {
          ...prev,
          [documentType]: {
            ...current,
            status: "error" as DocumentStatus,
            error: displayError,
          },
        };
      });

      // Also show toast for visibility
      showToast(`❌ ${displayError}`, "error");
    }
  };

  const handleDocumentPick = async (documentType: DocumentTypeKey, file: File) => {
    try {
      await uploadDocumentFile(file, documentType);
    } catch (err) {
      console.error("Unexpected error in handleDocumentPick:", err);
    }
  };

  const handleDocumentDelete = (documentType: DocumentTypeKey) => {
    setDocuments((prev) => ({
      ...prev,
      [documentType]: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
    }));
  };

  useEffect(() => {
    return () => {
      if (capturedPhotoPreviewUrl) {
        URL.revokeObjectURL(capturedPhotoPreviewUrl);
      }
    };
  }, [capturedPhotoPreviewUrl]);

  useEffect(() => {
    if (!cameraOpen) {
      stopStudentCamera();
      return;
    }

    let cancelled = false;

    const startCamera = async () => {
      setCameraError("");
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera access is not supported on this device.");
        }

        // Try preferred camera constraints first, then fall back for desktop/browser compatibility.
        const constraintsList: MediaStreamConstraints[] = [
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          },
          {
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          },
          { video: true, audio: false },
        ];

        let stream: MediaStream | null = null;
        let lastError: unknown = null;

        for (const constraints of constraintsList) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (streamError) {
            lastError = streamError;
          }
        }

        if (!stream) {
          throw lastError ?? new Error("Unable to access camera.");
        }

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        stopStudentCamera();
        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          const videoEl = cameraVideoRef.current;
          videoEl.srcObject = stream;
          videoEl.muted = true;
          videoEl.setAttribute("playsinline", "true");

          try {
            await videoEl.play();
          } catch {
            // Some browsers need metadata before playback can start.
            await new Promise<void>((resolve) => {
              const onLoaded = () => {
                videoEl.removeEventListener("loadedmetadata", onLoaded);
                void videoEl.play().finally(() => resolve());
              };
              videoEl.addEventListener("loadedmetadata", onLoaded, { once: true });
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          const apiError = error as Error;
          if (apiError?.name === "NotAllowedError") {
            setCameraError("Camera permission was blocked. Allow camera access in the browser and try again.");
            return;
          }
          setCameraError(parseError(error) || "Unable to access camera.");
        }
      }
    };

    void startCamera();

    return () => {
      cancelled = true;
      stopStudentCamera();
    };
  }, [cameraOpen]);

  // The <video> element unmounts (swapped for the captured-photo <img>) once a
  // photo is taken, then remounts as a fresh DOM node on Retake. The stream
  // itself is still alive (capture doesn't stop it), but the fresh node has no
  // srcObject — reattach it here rather than re-requesting the camera.
  useEffect(() => {
    if (!cameraOpen || capturedPhotoPreviewUrl) return;
    const stream = cameraStreamRef.current;
    const videoEl = cameraVideoRef.current;
    if (!stream || !videoEl || videoEl.srcObject === stream) return;
    videoEl.srcObject = stream;
    videoEl.muted = true;
    void videoEl.play().catch(() => {});
  }, [cameraOpen, capturedPhotoPreviewUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (isViewMode) return;
    // A1: hard re-entrancy guard. Without this, an effect listening on a
    // state key the submit also writes to (e.g. fieldErrors → onDraftsChange
    // → setGuardianCardErrors) can trigger a feedback loop.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setSuccess("");
    setError("");
    setGuardianSubmitError(null);
    setGuardianCardErrors(guardianDrafts.map(() => ({})));

    const nextErrors = validateClient();
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setError(`Please fix ${Object.keys(nextErrors).length} validation error(s).`);
      jumpToFirstErrorSection(nextErrors);
      isSubmittingRef.current = false;
      return;
    }

    if (!admissionChecked) {
      const ok = await runAdmissionAvailabilityCheck();
      if (!ok) {
        setError("Please resolve admission number validation first.");
        jumpToSection("identity");
        isSubmittingRef.current = false;
        return;
      }
    }

    // Persist any un-linked guardian drafts to the backend; use the primary's
    // resolved ID as the student's guardian FK.
    const persistResult = await persistGuardianDrafts();
    if (!persistResult.ok) {
      setGuardianCardErrors(persistResult.cardErrors);
      setGuardianSubmitError("Please fix the highlighted guardian fields.");
      jumpToSection("guardians");
      isSubmittingRef.current = false;
      return;
    }
    const resolvedPrimaryGuardianId = persistResult.primaryId;
    if (!resolvedPrimaryGuardianId) {
      setGuardianSubmitError("Please add at least one guardian (Guardian 1 is required).");
      jumpToSection("guardians");
      isSubmittingRef.current = false;
      return;
    }
    if (guardianId !== String(resolvedPrimaryGuardianId)) {
      setGuardianId(String(resolvedPrimaryGuardianId));
    }

    // Persist the fee plan built in Step 10 against the (now-known) student id.
    // Non-fatal: the student record is already saved by this point, so a fee
    // assignment hiccup surfaces as a toast rather than blocking enrollment.
    const persistFeePlan = async (studentIdForFees: number) => {
      const lines = feesStepRef.current?.getAssignmentPayloads() ?? [];
      if (lines.length === 0) return;
      let failed = 0;
      for (const line of lines) {
        try {
          await feesApi.createAssignment({
            academic_year: Number(academicYearId),
            student: studentIdForFees,
            ...line,
          });
        } catch (feeErr) {
          failed += 1;
          console.error("Fee assignment failed", line, feeErr);
        }
      }
      if (failed > 0) {
        showToast(`Student saved, but ${failed} of ${lines.length} fee line(s) could not be assigned. Finish this from Fees → Assignment.`, "error", 6000);
      }
    };

    try {
      setSaving(true);
      const isStudentActive = !isDisabled && statusValue === "active";
      const payload: StudentCreatePayload = {
        admission_no: sanitizeText(admissionNo).replace(/-/g, ""),
        roll_no: rollNo.trim() || undefined,
        first_name: sanitizeText(firstName),
        middle_name: sanitizeText(middleName) || undefined,
        last_name: sanitizeText(lastName),
        date_of_birth: dateOfBirth || undefined,
        academic_year: Number(academicYearId),
        gender,
        custom_gender: gender === "other" ? sanitizeText(customGender) : undefined,
        blood_group: bloodGroup.trim() || undefined,
        phone: phone.trim() || undefined,
        email: sanitizeText(email) || undefined,
        address_line: sanitizeText(addressLine) || undefined,
        city: sanitizeText(city) || undefined,
        district: sanitizeText(district) || undefined,
        state: sanitizeText(stateName) || undefined,
        pincode: pincode.trim() || undefined,
        photo: photo ? photo : (isEditMode && photoCleared ? "" : undefined),
        status: statusValue,
        category: categoryId ? Number(categoryId) : undefined,
        student_group: houseId ? Number(houseId) : undefined,
        guardian: resolvedPrimaryGuardianId,
        guardians: persistResult.allLinks.map((g) => ({ id: g.id, is_primary: g.isPrimary })),
        current_class: Number(classId),
        current_section: Number(sectionId),
        is_disabled: isDisabled,
        is_active: isStudentActive,
        landmark: sanitizeText(landmark) || undefined,
        transport_modes: transportModes.length > 0 ? transportModes : undefined,
        transport_custom: sanitizeText(transportCustom) || undefined,
        mother_tongue: (motherTongue === "Other" ? sanitizeText(otherMotherTongue) : motherTongue) || undefined,
        other_mother_tongue: motherTongue === "Other" ? sanitizeText(otherMotherTongue) || undefined : undefined,
        religion: religion || undefined,
        nationality: nationality || undefined,
        other_nationality: nationality === "Other" ? sanitizeText(otherNationality) || undefined : undefined,
        admission_type: admissionType || undefined,
        previous_school_name: sanitizeText(previousSchoolName) || undefined,
        rte_certificate_no: sanitizeText(rteCertificateNo) || undefined,
        stream: streamId || undefined,
        apaar_id: sanitizeText(apaarRaw) || undefined,
        aadhaar_no: sanitizeText(aadhaarNo) || undefined,
        pen: sanitizeText(pen) || undefined,
        digilocker_mobile: sanitizeText(digiMobile) || undefined,
        abc_id: sanitizeText(abcId) || undefined,
        height_cm: heightCm.trim() || undefined,
        weight_kg: weightKg.trim() || undefined,
        vision: vision || undefined,
        medical_conditions: medicalConditions.length > 0 ? medicalConditions : undefined,
        allergies: allergies.length > 0 ? allergies : undefined,
        current_medications: sanitizeText(currentMedications) || undefined,
        treating_doctor: sanitizeText(treatingDoctor) || undefined,
        vaccinations: checkedVaccinations.length > 0 ? checkedVaccinations : undefined,
        medical_notes: sanitizeText(medicalNotes) || undefined,
        emergency_contact_name: sanitizeText(emergencyName) || undefined,
        emergency_contact_phone: emergencyPhone.trim() || undefined,
        is_pwd: isPwD,
        disability_types: disabilityTypes.length > 0 ? disabilityTypes : undefined,
        disability_percent: isPwD ? disabilityPercent : undefined,
        udid: sanitizeText(udid) || undefined,
        disability_accommodations: accommodations.length > 0 ? accommodations : undefined,
        disability_notes: sanitizeText(additionalNotes) || undefined,
        other_disability_text: sanitizeText(otherDisabilityText) || undefined,
        identity_marks: identityMarks.length > 0 ? identityMarks : undefined,
        eye_colour: eyeColour || undefined,
        hair_colour: hairColour || undefined,
        complexion: complexion || undefined,
        build: build || undefined,
      };

      // Success handler — stay on /students/add, reset the form, fetch a
      // fresh admission number, toast, and scroll the form back to the top.
      // Edit mode keeps its redirect since the user came FROM the list.
      const finishSuccessAsEnrollment = (toastMessage: string) => {
        invalidateGeneratedAdmissionNoCache();
        if (typeof window !== "undefined") {
          window.localStorage.removeItem(STUDENT_DRAFT_STORAGE_KEY);
        }
        // Clear everything the next enrollment shouldn't inherit.
        resetStudentForm();
        setDocuments({
          birth_certificate: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
          aadhaar_card: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
          medical_information: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
          transfer_certificate: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
          caste_certificate: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
          udid_card: { status: "idle", fileName: "", url: null, error: null, uploadedAt: null },
        });
        setNewlyCreatedStudentId(null);
        setError("");
        showToast(toastMessage, "success", 5000);
        // Scroll the form's internal scroll container (not window — body is
        // overflow:hidden in this layout).
        if (typeof document !== "undefined") {
          const scrollEl = document.querySelector(".enroll-scroll") as HTMLElement | null;
          scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
        }
        // Trigger a new admission number fetch on the next tick so the reset
        // has applied before initializeAdmissionNo() gates on the ref.
        setTimeout(() => {
          void initializeAdmissionNo(true);
        }, 0);
      };

      if (isEditMode && studentId) {
        await apiPutJson<{ message?: string }>(`/api/v1/students/students/${studentId}/`, payload);
        await persistFeePlan(studentId);
        setSuccess("Student updated successfully.");
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem("students:list:flash", "Student updated successfully.");
        }
        setTimeout(() => {
          if (typeof window !== "undefined") {
            window.location.href = "/students/list";
          }
        }, 800);
      } else if (newlyCreatedStudentId) {
        // Auto-save (triggered by document upload) already created a DRAFT
        // student row with this admission_no. POSTing again would collide on
        // the uniqueness check. Finalize that draft via PUT and flip
        // is_draft → false so it becomes a real enrolled student.
        const finalizePayload: StudentCreatePayload = { ...payload, is_draft: false };
        const finalizeResponse = await apiPutJson<StudentCreateResponse>(
          `/api/v1/students/students/${newlyCreatedStudentId}/`,
          finalizePayload,
        );
        await persistFeePlan(newlyCreatedStudentId);
        finishSuccessAsEnrollment(
          finalizeResponse?.warning
            ? `Student enrolled successfully. ${finalizeResponse.warning}`
            : "Student enrolled successfully",
        );
      } else {
        // Fresh POST — no auto-save happened (user submitted without
        // uploading any documents first). Create the student, then reset
        // the form for the next enrollment.
        const response = await apiPostJson<StudentCreateResponse>("/api/v1/students/students/", payload);
        const createdStudentId = Number(response?.id ?? response?.data?.id);
        if (Number.isFinite(createdStudentId) && createdStudentId > 0) {
          await persistFeePlan(createdStudentId);
        }
        const toastMsg = response?.warning
          ? `Student enrolled successfully. ${response.warning}`
          : "Student enrolled successfully";
        finishSuccessAsEnrollment(toastMsg);
        
        // Write enrollment data so multi-subject page can auto-populate
        if (typeof window !== "undefined") {
          const enrolledClass = orderedClasses.find((item) => String(item.id) === classId);
          const enrolledSection = sections.find((item) => String(item.id) === sectionId);
          const enrolledAcYear = academicYears.find((item) => String(item.id) === academicYearId);
          const enrollmentPayload = {
            name: `${firstName.trim()} ${lastName.trim()}`.trim(),
            admissionNo: String(response?.admission_no || admissionNo).trim(),
            rollNo: String(response?.roll_no || rollNo).trim(),
            className: String(enrolledClass?.name || ""),
            sectionName: String(enrolledSection?.name || ""),
            academicYear: String(enrolledAcYear?.name || ""),
          };
          window.localStorage.setItem("eskoolia_last_enrolled_student", JSON.stringify(enrollmentPayload));
        }

        // Navigate to multi-subject assignment after short delay
        setTimeout(() => {
          if (typeof window !== "undefined") {
            window.location.href = "/students/multi-class";
          }
        }, 900);
      }
    } catch (submitError) {
      // The student create/finalize call above failed. If this was a brand-new
      // enrollment (no pre-existing student, no auto-saved draft) and guardians
      // were freshly created earlier in this same submit, they're now orphaned —
      // roll them back so retrying doesn't keep piling up guardian rows with no
      // linked student (see Critical QA finding: guardian 201, student 500).
      if (!isEditMode && !newlyCreatedStudentId && persistResult.newlyCreatedIds.length > 0) {
        void rollbackNewlyCreatedGuardians(persistResult.newlyCreatedIds);
        setGuardianDrafts((prev) =>
          prev.map((draft) =>
            persistResult.newlyCreatedIds.includes(draft.linkedExistingId ?? -1)
              ? { ...draft, linkedExistingId: null, original: undefined }
              : draft,
          ),
        );
      }
      const mappedErrors = syncApiFieldErrors(submitError as ApiError);
      setError(parseEnrollmentSaveError(submitError));
      jumpToFirstErrorSection(mappedErrors);
    } finally {
      setSaving(false);
      isSubmittingRef.current = false;
    }
  };

  return (
    <div className="enroll-page student-add-panel-wrap">
      <form onSubmit={submit} noValidate onKeyDown={(e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'submit' && e.target.type !== 'checkbox' && e.target.type !== 'radio') { e.preventDefault(); const currentIndex = getSectionIndex(activeNavSection); if (currentIndex < NAV_ITEMS.length - 1) { const nextItem = NAV_ITEMS[currentIndex + 1]; if (validateNavigationStep(activeNavSection, nextItem.id)) jumpToSection(nextItem.id); } } }}>
        <div className="enroll-scroll">
        <div className="top-row">
          <p className="crumbs">
            <a href="/dashboard">Dashboard</a> <span className="crumb-sep">/</span> <a href="/students/list">Students</a> <span className="crumb-sep">/</span> <strong>Enroll</strong>
          </p>
          <div className="draft-right">
            <span 
              className={draftSaveStatus === 'saved' ? "dot-green" : "dot-green"} 
              style={
                isFormDirty && draftSaveStatus === 'unsaved' ? { background: '#f59e0b' } :
                draftSaveStatus === 'saving' ? { background: '#9ca3af', animation: 'pulse 1.5s ease-in-out infinite' } :
                { background: '#10b981' }
              } 
            />
            <span>
              {isFormDirty && draftSaveStatus === 'unsaved' ? 'Unsaved changes' :
               draftSaveStatus === 'saving' ? 'Saving…' :
               'Draft saved'}
            </span>
            <span className="avatar-circle">{currentUserInitials}</span>
          </div>
        </div>

        <div className="page-title-row">
          <div>
            <h1 className="hero-title">
              Enroll a <span className="title-accent">student</span>
            </h1>
            <p className="hero-subtitle">Admit a new student into the school records. We&apos;ll generate an admission number, place them in a class &amp; section, and notify their guardian.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
            <div className="hero-kpi">
              <p className="hero-kpi-count">{currentEnrolledCount ?? '…'}</p>
              <p className="hero-kpi-label">CURRENTLY ENROLLED</p>
            </div>
            <div className="hero-actions-row">
              <button
                type="button"
                className="hero-action-btn hero-action-drafts"
                onClick={() => setDraftsOpen(true)}
                title="View saved drafts"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="9" y1="13" x2="15" y2="13"/>
                  <line x1="9" y1="17" x2="13" y2="17"/>
                </svg>
                <span>Drafts</span>
                {(() => {
                  let count = 0;
                  try { const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STUDENT_DRAFTS_KEY) : null; count = raw ? (JSON.parse(raw) as unknown[]).length : 0; } catch { /* ignore */ }
                  return count > 0 ? <span className="hero-action-badge">{count}</span> : null;
                })()}
              </button>

              <button
                type="button"
                className="hero-action-btn hero-action-ai"
                onClick={() => setAiOpen(true)}
                title="Get AI-powered help & suggestions"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2l1.9 5.8L20 9.7l-5 3.6L16.5 19 12 15.7 7.5 19 9 13.3l-5-3.6 6.1-1.9L12 2z"/>
                </svg>
                <span>AI Assist</span>
                <span className="hero-action-pulse" aria-hidden="true" />
              </button>

              <button
                type="button"
                className="hero-action-btn hero-action-pdf"
                onClick={() => { setConsentOpenWithSettings(false); setConsentOpen(true); }}
                title="Preview & customize the consent PDF"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <path d="M9 15h6"/>
                  <path d="M9 11h6"/>
                </svg>
                <span>PDF</span>
              </button>

              <button
                type="button"
                className="hero-action-btn hero-action-info"
                onClick={() => setInfoChecklistOpen(true)}
                title="What documents & details will I need?"
                aria-label="View enrollment checklist"
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

        {!bannerDismissed ? (
          <div className="scan-banner">
            <div className="scan-left">
              <div className="scan-icon-wrap">QR</div>
              <div>
                <p className="scan-title">Scan to pre-fill <span className="badge-new">NEW</span></p>
                <p className="scan-copy">Got their Aadhaar QR, previous school ID, or pre-admission slip? Scan it once and we&apos;ll fill the form automatically.</p>
              </div>
            </div>
            <div className="scan-actions">
              <button type="button" className="scan-now" onClick={() => setScanFillOpen(true)}>Scan now</button>
              <button type="button" className="scan-dismiss" onClick={dismissScanBanner}>X</button>
            </div>
          </div>
        ) : null}

        {error ? <div className="banner-error">{error}</div> : null}

        <div className="enroll-body">
          <aside className="section-nav-wrap">
            <nav className="section-nav" aria-label="Enroll navigation">
              <ul className="section-nav-list">
                {(() => {
                  return NAV_ITEMS.map((item, idx) => {
                    const prevItem = idx > 0 ? NAV_ITEMS[idx - 1] : null;
                    const isFirstInGroup = item.group === 'health-identity' && (!prevItem || prevItem.group !== 'health-identity');
                    const isLocked = idx > maxReachedIdx + 1;
                    return (
                      <Fragment key={item.id}>
                        {isFirstInGroup && (
                          <li className="nav-group-heading">HEALTH &amp; IDENTITY</li>
                        )}
                        <li 
                          className={activeNavSection === item.id ? "nav-item active" : (isLocked ? "nav-item locked" : "nav-item")} 
                          data-target={item.id}
                          aria-current={activeNavSection === item.id ? "step" : undefined}
                        >
                          <button
                            type="button"
                            className="nav-item-inner"
                            onClick={() => {
                              // Previously `disabled={isLocked}` on this button meant a click on a
                              // locked step did nothing at all — the native disabled attribute stops
                              // onClick (and validateNavigationStep, which surfaces the real blocking
                              // error like "consent required") from ever running. Now the button stays
                              // clickable so the user always sees *why* they can't move: either the
                              // actual validation error on the current step, or an explicit "locked" toast.
                              if (!validateNavigationStep(activeNavSection, item.id as NavItemId)) {
                                return;
                              }
                              if (isLocked) {
                                showToast("Complete the previous step to unlock this section.", "error", 4000);
                                return;
                              }
                              jumpToSection(item.id as NavItemId);
                            }}
                            aria-disabled={isLocked ? "true" : undefined}
                            title={isLocked ? "Complete the previous step to unlock" : undefined}
                          >
                            <span className="nav-bullet">{idx + 1}</span>
                            <span className="nav-text">
                              <span className="nav-label">
                                {item.label}
                                {item.badge && (
                                  <span className={`nav-badge nav-badge-${item.badge.toLowerCase()}`} title={item.badge === 'GOI' ? 'Government of India' : undefined}>{item.badge}</span>
                                )}
                              </span>
                              <span className="nav-copy">{item.description}</span>
                            </span>
                          </button>
                        </li>
                      </Fragment>
                    );
                  });
                })()}
              </ul>
              <div className="heads-up-card">
                <p className="heads-up-title">Heads up</p>
                <p className="heads-up-body" style={{ lineHeight: 1.6 }}>
                  <span style={{ color: "#dc2626", fontWeight: 700 }}>*</span> = <strong>Required</strong> — must be filled to enroll<br />
                  <span style={{ background: "#ecfdf5", color: "#065f46", borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>RECOMMENDED</span> = Strongly suggested but not mandatory<br />
                  <span style={{ background: "#f3f4f6", color: "#6b7280", borderRadius: 999, padding: "1px 6px", fontSize: 10, fontWeight: 600 }}>OPTIONAL</span> = Fill if available, can be added later
                </p>
              </div>
            </nav>
          </aside>

          <div className="section-content">
            <section className="section-card" id="identity" style={{ display: activeNavSection === "identity" ? "block" : "none" }}>
              <div className="section-card-header">
                <div>
                  <h2 className="section-title">Student <span className="title-accent">identity</span></h2>
                  <p className="section-subtitle">Name, photo, date of birth, and a few basics.</p>
                </div>
                <span className="section-counter">{getSectionCounter("identity")}</span>
              </div>

              <div className="photo-upload-block">
                <button type="button" className={photo ? "photo-circle has-photo" : "photo-circle"} onClick={openStudentFilePicker}>
                  {photo ? <img src={photoDisplayUrl} alt="Student" /> : <><span className="camera-icon">+</span><span className="photo-label">ADD PHOTO</span></>}
                </button>
                <div className="photo-meta">
                  <p className="photo-title">Student photo</p>
                  <p className="photo-desc">Square JPG or PNG, at least 400x400px. We&apos;ll crop it into a circle for ID cards and reports.</p>
                  <div className="photo-actions">
                    <button type="button" className="btn-upload-file" onClick={openStudentFilePicker}>{photo ? "Change" : "Upload file"}</button>
                    {photo ? (
                      <>
                        <button type="button" className="btn-upload-file" onClick={() => setPhotoPreviewOpen(true)}>View image</button>
                        <button type="button" className="btn-take-photo" onClick={clearStudentPhoto}>Remove</button>
                      </>
                    ) : (
                      <button type="button" className="btn-take-photo" onClick={openStudentCamera}>Take photo</button>
                    )}
                  </div>
                  <input
                    ref={photoInputRef}
                    id="photo"
                    type="file"
                    accept="image/*"
                    title="Student photo upload"
                    hidden
                    onClick={(event) => {
                      event.currentTarget.value = "";
                    }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (file.size > 5*1024*1024) { setSingleFieldError('photo','Photo must be smaller than 5MB'); return; }
                        const img = new Image();
                        const url = URL.createObjectURL(file);
                        img.onload = () => {
                          if (img.width < 400 || img.height < 400) setSingleFieldError('photo','Photo should be at least 400×400 pixels for best quality');
                          else setSingleFieldError('photo','');
                          URL.revokeObjectURL(url);
                        };
                        img.src = url;
                        void uploadStudentPhoto(file);
                      }
                    }}
                    disabled={isViewMode || photoUploading}
                    aria-describedby="photo-error"
                  />
                  {fieldErrors.photo ? <span id="photo-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.photo}</span> : null}
                </div>
              </div>

              <div className="grid-3">
                <div className="field-wrapper field-inline-action">
                  <label className="field-label">Admission number <span className="req">*</span></label>
                  <input
                    className={fieldErrors.admission_no ? "field-input error" : "field-input"}
                    value={admissionNo}
                    title="Admission number"
                    placeholder={firstName.trim() ? "e.g. ADM2026001" : "Enter first name to generate"}
                    maxLength={12}
                    aria-describedby="admission_no-error"
                    onChange={(e) => {
                      setAdmissionNo(e.target.value.slice(0, 12));
                      setIsManualEdit(true);
                      setAdmissionChecked(false);
                      setAdmissionConflict(null);
                      setSingleFieldError("admission_no", "");
                    }}
                    onBlur={() => {
                      const normalized = sanitizeText(admissionNo).replace(/[\s-]/g, "").slice(0, 12);
                      setAdmissionNo(normalized);
                      setIsManualEdit(true);
                      if (normalized.trim() && !ADMISSION_NO_FORMAT_REGEX.test(normalized)) {
                        setSingleFieldError('admission_no', 'Admission number must be in format ADM followed by 7-9 digits (e.g. ADM2026001)');
                        return;
                      }
                      void runAdmissionAvailabilityCheck(normalized);
                    }}
                    readOnly={!admissionNoEditable}
                  />
                  <button type="button" className="edit-btn" onClick={() => setAdmissionNoEditable((prev) => !prev)}>{admissionNoEditable ? "Lock" : "Edit"}</button>
                  <p className="help-text">Auto-generated. Click Edit to customize.</p>
                  {checkingAdmission ? <p className="status-info">Checking availability...</p> : null}
                  {fieldErrors.admission_no ? <span id="admission_no-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.admission_no}</span> : null}
                  {admissionConflict && !fieldErrors.admission_no && (
                    <div style={{ marginTop: 6, padding: '8px 12px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, fontSize: 13 }}>
                      <span style={{ fontWeight: 600, color: '#92400e' }}>⚠ Already assigned to:</span>{" "}
                      <span style={{ color: '#78350f' }}>{admissionConflict.name}{admissionConflict.is_draft ? " (draft)" : ""} — {admissionConflict.class_name}, {admissionConflict.section_name}</span>
                    </div>
                  )}
                  {admissionChecked && !fieldErrors.admission_no ? <p className="status-info" style={{ color: '#16a34a' }}>✓ Admission number is available</p> : null}
                </div>

                <div className="field-wrapper">
                  <label className="field-label">Roll number <span className="badge badge-assigned-later">ASSIGNED LATER</span></label>
                  <input className="field-input" title="Roll number" value="Auto when class is set" readOnly disabled={true} tabIndex={-1} style={{ pointerEvents: 'none', cursor: 'not-allowed', background: '#f3f4f6', color: '#9ca3af' }} />
                  <p className="help-text">Rolls are assigned after class allocation.</p>
                </div>

                <div className="field-wrapper">
                  <label className="field-label">Status</label>
                  <div className="status-toggle" role="radiogroup" aria-label="Student status">
                    <button type="button" role="radio" aria-checked={statusValue === "active"} className={statusValue === "active" ? "toggle-pill active" : "toggle-pill"} onClick={() => setStatusValue("active")} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setStatusValue("active"); } }}>Active</button>
                    <button type="button" role="radio" aria-checked={statusValue === "inactive"} className={statusValue === "inactive" ? "toggle-pill active" : "toggle-pill"} onClick={() => setStatusValue("inactive")} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setStatusValue("inactive"); } }}>Inactive</button>
                  </div>
                </div>
              </div>

              <div className="grid-3 mt-20">
                <div className="field-wrapper"><label className="field-label">First name <span className="req">*</span></label><input aria-describedby="first_name-error" className={fieldErrors.first_name ? "field-input error" : "field-input"} value={firstName} onChange={(e) => { setFirstName(sanitizeNameInput(e.target.value)); setSingleFieldError('first_name', ''); }} onBlur={(e) => { const val = toTitleCase(e.target.value); setFirstName(val); if (val.trim() && !isProperName(val)) { setSingleFieldError('first_name', 'Enter a valid first name (letters only)'); } }} placeholder="e.g. Rahul" />{fieldErrors.first_name ? <span id="first_name-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.first_name}</span> : null}</div>
                <div className="field-wrapper"><label className="field-label">Middle name <span className="badge badge-optional">OPTIONAL</span></label><input className="field-input" title="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} placeholder="e.g. Kumar" /></div>
                <div className="field-wrapper"><label className="field-label">Last name <span className="req">*</span></label><input aria-describedby="last_name-error" className={fieldErrors.last_name ? "field-input error" : "field-input"} value={lastName} onChange={(e) => { setLastName(sanitizeNameInput(e.target.value)); setSingleFieldError('last_name', ''); }} onBlur={(e) => { const val = toTitleCase(e.target.value); setLastName(val); if (val.trim() && !isProperName(val)) { setSingleFieldError('last_name', 'Enter a valid last name (letters only)'); } }} placeholder="e.g. Sharma" />{fieldErrors.last_name ? <span id="last_name-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.last_name}</span> : null}</div>
              </div>

              <div className="grid-3 mt-20">
                <div className="field-wrapper"><label className="field-label">Date of birth <span className="req">*</span></label><div style={{display:'flex',gap:6,alignItems:'center'}}><input type="text" placeholder="DD / MM / YYYY" maxLength={14} aria-describedby="dob-error" className={fieldErrors.dob ? "field-input error" : "field-input"} style={{letterSpacing:1,flex:1}} value={dobDisplay} onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g,''); const masked = toDobMask(raw); setDobDisplay(masked); const iso = parseDobMaskedToISO(masked); if (iso) { setDateOfBirth(iso); setSingleFieldError("dob",""); } }} onBlur={() => { if (dateOfBirth) { const dob = new Date(dateOfBirth); const now = new Date(); const ageyrs = (now.getTime()-dob.getTime())/(365.25*24*60*60*1000); if (ageyrs < 2) setSingleFieldError('dob','Student must be at least 2 years old'); else if (ageyrs > 25) setSingleFieldError('dob','Date of birth seems too old — please verify'); else setSingleFieldError('dob',''); } }} /><input type="date" title="Pick date" tabIndex={-1} className="dob-picker-trigger" value={dateOfBirth} min={(() => { const d=new Date(); d.setFullYear(d.getFullYear()-25); return d.toISOString().slice(0,10); })()} max={maxDobIso} onChange={(e) => { setDateOfBirth(e.target.value); if (e.target.value) { const parts = e.target.value.split('-'); setDobDisplay(parts[2] + ' / ' + parts[1] + ' / ' + parts[0]); } else { setDobDisplay(""); } setSingleFieldError("dob",""); }} /></div>{fieldErrors.dob ? <span id="dob-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.dob}</span> : null}</div>
                <div className="field-wrapper"><label className="field-label">Gender <span className="req">*</span></label><select aria-describedby="gender-error" className={fieldErrors.gender ? "field-select error" : "field-select"} title="Gender" value={gender} onChange={(e) => { setGender(e.target.value); setSingleFieldError('gender', ''); }} onBlur={() => { if (!gender) setSingleFieldError('gender','Gender is required'); }}><option value="">Select</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>{fieldErrors.gender ? <span id="gender-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.gender}</span> : null}</div>
                <div className="field-wrapper"><label className="field-label">Blood group <span className="badge badge-optional">OPTIONAL</span></label><select className="field-select" title="Blood group" value={bloodGroup} onChange={(e) => setBloodGroup(e.target.value)}><option value="">Select</option>{"A+,A-,B+,B-,AB+,AB-,O+,O-".split(",").map((bg) => <option key={bg} value={bg}>{bg}</option>)}</select></div>
              </div>

              <div className="grid-3 mt-20">
                <div className="field-wrapper"><label className="field-label">Mother tongue <span className="badge badge-optional">OPTIONAL</span></label><select className={fieldErrors.mother_tongue ? "field-select error" : "field-select"} title="Mother tongue" value={motherTongue} onChange={(e) => { setMotherTongue(e.target.value); setAutoFilledFields((prev) => { const next = new Set(prev); next.delete("mother_tongue"); return next; }); }}><option value="">Select</option>{MOTHER_TONGUES.map((row) => <option key={row} value={row}>{row}</option>)}</select>{autoFilledFields.has("mother_tongue") && motherTongue ? <p className="status-info">Auto-filled from State. Edit if different.</p> : null}{fieldErrors.mother_tongue ? <p className="error-msg">{fieldErrors.mother_tongue}</p> : null}{motherTongue === "Other" ? <input className={fieldErrors.other_mother_tongue ? "field-input error mt-8" : "field-input mt-8"} title="Other mother tongue" value={otherMotherTongue} onChange={(e) => { setOtherMotherTongue(e.target.value.replace(/[^A-Za-z\s]/g, '').slice(0, 50)); setSingleFieldError('other_mother_tongue', ''); }} placeholder="Specify language" /> : null}</div>
                <div className="field-wrapper"><label className="field-label">Religion <span className="badge badge-optional">OPTIONAL</span></label><select className="field-select" title="Religion" value={religion} onChange={(e) => setReligion(e.target.value)}><option value="Prefer not to say">Prefer not to say</option><option>Hindu</option><option>Muslim</option><option>Christian</option><option>Sikh</option><option>Buddhist</option><option>Jain</option><option>Other</option></select></div>
                <div className="field-wrapper"><label className="field-label">Nationality <span className="req">*</span></label><select aria-describedby="nationality-error" className={fieldErrors.nationality ? "field-select error" : "field-select"} title="Nationality" value={nationality} onChange={(e) => { setNationality(e.target.value); setSingleFieldError('nationality', ''); }} onBlur={() => { if (!nationality) setSingleFieldError('nationality','Nationality is required'); }}><option value="">Select Nationality</option><option value="Indian">Indian</option><option value="Nepali">Nepali</option><option value="Bhutanese">Bhutanese</option><option value="Other">Other</option></select>{fieldErrors.nationality ? <span id="nationality-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.nationality}</span> : null}{nationality === "Other" ? <input className={fieldErrors.other_nationality ? "field-input error mt-8" : "field-input mt-8"} title="Other nationality" value={otherNationality} onChange={(e) => { setOtherNationality(e.target.value.replace(/[^A-Za-z\s]/g, '').slice(0, 50)); setSingleFieldError('other_nationality', ''); }} placeholder="Specify nationality" /> : null}</div>
              </div>

              {renderSectionNavButtons("identity")}
            </section>

            <section className="section-card" id="academic" style={{ display: activeNavSection === "academic" ? "block" : "none" }}>
              <div className="section-card-header"><div><h2 className="section-title">Academic <span className="title-accent">placement</span></h2><p className="section-subtitle">Which year, class, section, and category this student belongs to.</p></div><span className="section-counter">{getSectionCounter("academic")}</span></div>
              <div className="grid-3">
                <div className="field-wrapper"><label className="field-label">Academic year <span className="req">*</span></label><select aria-describedby="academic_year-error" className={fieldErrors.academic_year ? "field-select error" : "field-select"} title="Academic year" value={academicYearId} onChange={(e) => { setAcademicYearId(e.target.value); setSingleFieldError('academic_year', ''); }} onBlur={() => { if (!academicYearId) setSingleFieldError('academic_year','Academic year is required'); }}><option value="">Select</option>{validAcademicYears.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{fieldErrors.academic_year ? <p className="error-msg">{fieldErrors.academic_year}</p> : null}</div>
                <div className="field-wrapper"><label className="field-label">Class <span className="req">*</span></label><select aria-describedby="class-error" className={fieldErrors.class ? "field-select error" : "field-select"} title="Class" value={classId} onChange={(e) => setClassId(e.target.value)} onBlur={() => { if (!classId) setSingleFieldError('class','Class is required'); }}><option value="">Choose a class</option>{orderedClasses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{fieldErrors.class ? <p className="error-msg">{fieldErrors.class}</p> : null}</div>
                <div className="field-wrapper"><label className="field-label">Section <span className="req">*</span>{sectionLoading && <span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #d1d5db', borderTopColor: '#6c3ce1', borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginLeft: 4 }} aria-label="Loading sections" />}</label>{sectionNotRequired ? <div style={{ padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, fontSize: 13, color: '#166534', fontWeight: 500 }}>Section: Not required for this enrollment</div> : <select aria-describedby="section-error" className={fieldErrors.section ? "field-select error" : "field-select"} title="Section" value={sectionId} onChange={(e) => setSectionId(e.target.value)} onBlur={() => { if (classId && !sectionNotRequired && !sectionId) setSingleFieldError('section','Section is required'); }} disabled={!classId || sectionLoading}><option value="">{classId ? (sectionLoading ? "Loading sections..." : "Select Section") : "Pick class first"}</option>{sections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}{sectionLoadError ? <><p className="error-msg">{sectionLoadError}</p><button type="button" style={{ fontSize: 12, color: '#6c3ce1', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', textDecoration: 'underline' }} onClick={() => void loadSectionsForClass(classId)}>Retry</button></> : null}{!sectionNotRequired && fieldErrors.section ? <p className="error-msg">{fieldErrors.section}</p> : null}</div>
              </div>
              {classAgeWarning ? <p className="age-warning">{classAgeWarning}</p> : null}
              <div className="grid-2 mt-20">
                <div className="field-wrapper"><label className="field-label">Category <span className="badge badge-optional">OPTIONAL</span></label><select className={fieldErrors.category ? "field-select error" : "field-select"} title="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">Select category</option>{validCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
                <div className="field-wrapper">
                  <label className="field-label">
                    Admission type <span className="req">*</span>
                    <span className="adm-type-tooltip-wrap" style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <span className="adm-type-tooltip-icon" style={{ cursor: 'help', marginLeft: 4, fontSize: 11, background: '#e5e7eb', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontWeight: 700 }}>?</span>
                      <span className="adm-type-tooltip-body" style={{ display: 'none', position: 'absolute', left: '120%', top: '-4px', width: 260, background: '#1f2937', color: '#f9fafb', borderRadius: 8, padding: '10px 12px', fontSize: 12, lineHeight: 1.6, zIndex: 99, pointerEvents: 'none', boxShadow: '0 4px 16px rgba(0,0,0,0.2)' }}>
                        <strong>Regular / New admission</strong>: standard first-time enrollment<br />
                        <strong>Transfer</strong>: student transferring from another school<br />
                        <strong>Re-admission</strong>: student previously enrolled and returning<br />
                        <strong>RTE Quota</strong>: enrollment under Right to Education Act 2009 reservation
                      </span>
                    </span>
                  </label>
                  <select aria-describedby="admission_type-error" className={fieldErrors.admission_type ? "field-select error" : "field-select"} title="Admission type" value={admissionType} onChange={(e) => { setAdmissionType(e.target.value); setSingleFieldError('admission_type', ''); }} onBlur={() => { if (!admissionType) setSingleFieldError('admission_type','Admission type is required'); }}><option value="">Select Admission Type</option><option value="New admission">New admission</option><option value="Transfer">Transfer</option><option value="Re-admission">Re-admission</option><option value="RTE Quota">RTE Quota</option></select>
                  {fieldErrors.admission_type ? <p className="error-msg">{fieldErrors.admission_type}</p> : null}
                </div>
              </div>
              {admissionType === "Transfer" ? <div className="field-wrapper mt-20"><label className="field-label">Previous school name</label><input className="field-input" title="Previous school name" value={previousSchoolName} onChange={(e) => setPreviousSchoolName(e.target.value.replace(/[^A-Za-z0-9\s.,&'-]/g, '').slice(0, 100))} onBlur={(e) => setPreviousSchoolName(toTitleCase(e.target.value))} /></div> : null}
              {admissionType === "RTE Quota" ? <div className="field-wrapper mt-20"><label className="field-label">RTE certificate number <span className="req">*</span></label><input className={fieldErrors.rte_certificate ? "field-input error" : "field-input"} title="RTE certificate number" value={rteCertificateNo} onChange={(e) => { setRteCertificateNo(e.target.value.replace(/[^A-Z0-9-]/g, '').slice(0, 30).toUpperCase()); setSingleFieldError('rte_certificate', ''); }} />{fieldErrors.rte_certificate ? <p className="error-msg">{fieldErrors.rte_certificate}</p> : null}</div> : null}
              {(() => {
                const cls = orderedClasses.find((c) => String(c.id) === classId);
                const m = String(cls?.name || "").match(/\d+/);
                const n = m ? Number(m[0]) : null;
                if (n != null && n >= 11) {
                  return (
                    <div className="field-wrapper mt-20">
                      <label className="field-label">Stream <span className="badge badge-optional">OPTIONAL</span></label>
                      <select className="field-select" title="Stream" value={streamId} onChange={(e) => setStreamId(e.target.value)}>
                        <option value="">Select stream</option>
                        <option value="science">Science</option>
                        <option value="commerce">Commerce</option>
                        <option value="arts">Arts / Humanities</option>
                        <option value="vocational">Vocational</option>
                      </select>
                    </div>
                  );
                }
                return null;
              })()}
              {sectionsSummary.length > 0 ? (
                <div className="mt-20" style={{ background: "#f7f5ff", border: "1px solid #c4b5fd", borderRadius: 12, padding: 14 }}>
                  <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 13, color: "#4c33e6" }}>Section capacity for this class</p>
                  <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {sectionsSummary.map((s) => {
                      const full = s.count >= s.capacity;
                      return (
                        <li key={s.section_id} style={{ background: "#fff", borderRadius: 8, padding: "6px 10px", border: "1px solid #e5e7eb", fontSize: 12 }}>
                          <strong>{s.name}</strong>: {s.count}/{s.capacity}{full ? " (full)" : ""}
                        </li>
                      );
                    })}
                  </ul>
                  <label style={{ display: "inline-flex", gap: 6, marginTop: 8, fontSize: 12, color: "#4b5563" }}>
                    <input type="checkbox" checked={sectionLater} onChange={(e) => { setSectionLater(e.target.checked); if (e.target.checked) setSectionId(""); }} />
                    Assign section later
                  </label>
                </div>
              ) : null}

              {houseGroups.length > 0 && (
                <div className="mt-20" style={{ background: '#faf5ff', border: '1px solid #ddd6fe', borderRadius: 12, padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: '#5b21b6' }}>🏠 House assignment <span style={{ fontSize: 11, fontWeight: 500, background: '#ede9fe', borderRadius: 20, padding: '2px 8px', color: '#7c3aed', marginLeft: 6 }}>OPTIONAL</span></p>
                      <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>Assign now or leave blank to assign later.</p>
                    </div>
                    <button type="button" onClick={() => void suggestHouse()} disabled={houseAiLoading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: houseAiLoading ? '#e5e7eb' : 'linear-gradient(135deg, #7c3aed, #6c3ce1)', color: houseAiLoading ? '#9ca3af' : '#fff', border: 'none', cursor: houseAiLoading ? 'default' : 'pointer', fontSize: 12, fontWeight: 600 }}>
                      {houseAiLoading ? (
                        <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #d1d5db', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Thinking…</>
                      ) : (
                        <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.9 5.8L20 9.7l-5 3.6L16.5 19 12 15.7 7.5 19 9 13.3l-5-3.6 6.1-1.9L12 2z"/></svg>AI Suggest</>
                      )}
                    </button>
                  </div>

                  {houseAiSuggestion && (
                    <div style={{ marginBottom: 12, padding: '10px 12px', background: '#ede9fe', borderRadius: 8, border: '1px solid #c4b5fd', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{ fontSize: 18, lineHeight: 1 }}>✨</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: '0 0 4px', fontWeight: 600, fontSize: 13, color: '#4c1d95' }}>Suggestion: {houseAiSuggestion.groupName}</p>
                        <p style={{ margin: 0, fontSize: 12, color: '#6d28d9' }}>{houseAiSuggestion.reason}</p>
                      </div>
                      <button type="button" onClick={() => { setHouseId(String(houseAiSuggestion.groupId)); setHouseAiSuggestion(null); }} style={{ padding: '4px 10px', borderRadius: 6, background: '#7c3aed', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>Apply</button>
                    </div>
                  )}

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
                    {[{ id: '', name: 'Assign later', emoji: '—', color: '#9ca3af', bgColor: '#f9fafb', studentsCount: 0 }, ...houseGroups].map(h => {
                      const selected = houseId === h.id;
                      return (
                        <button key={h.id || 'none'} type="button" onClick={() => setHouseId(h.id)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 8px', borderRadius: 10, border: selected ? `2px solid ${h.color || '#7c3aed'}` : '1.5px solid #e5e7eb', background: selected ? (h.bgColor || '#ede9fe') : '#fff', cursor: 'pointer', transition: 'all 0.15s', fontWeight: selected ? 700 : 500, color: selected ? (h.color || '#5b21b6') : '#374151' }}>
                          <span style={{ fontSize: 20 }}>{h.emoji}</span>
                          <span style={{ fontSize: 12, textAlign: 'center', lineHeight: 1.3 }}>{h.name}</span>
                          {h.id ? <span style={{ fontSize: 10, color: '#9ca3af' }}>{h.studentsCount} students</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {renderSectionNavButtons("academic")}
            </section>

            <section className="section-card" id="contact" style={{ display: activeNavSection === "contact" ? "block" : "none" }}>
              <div className="section-card-header"><div><h2 className="section-title">Contact & <span className="title-accent">address</span></h2><p className="section-subtitle">How we reach the student and where they live.</p></div><span className="section-counter">{getSectionCounter("contact")}</span></div>
              <div className="grid-2">
                <div className="field-wrapper"><label className="field-label">Phone <span className="req">*</span></label><input aria-describedby="phone-error" className={fieldErrors.phone ? "field-input error" : "field-input"} title="Phone number" value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setSingleFieldError('phone', ''); }} onBlur={() => { if (!phone.trim()) { setSingleFieldError('phone', 'Phone number is required'); } else if (!isValidPhone(phone)) { setSingleFieldError('phone', 'Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9 (no repeated or sequential digits)'); } else { setSingleFieldError('phone', ''); } }} placeholder="10-digit mobile number" />{fieldErrors.phone ? <span id="phone-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.phone}</span> : null}</div>
                <div className="field-wrapper"><label className="field-label">Email <span className="badge badge-recommended">RECOMMENDED</span></label><input aria-describedby="email-error" className={fieldErrors.email ? "field-input error" : "field-input"} title="Student email" value={email} onChange={(e) => { setEmail(e.target.value); setSingleFieldError('email', ''); }} onBlur={(e) => { const val = e.target.value.trim(); if (val && !isValidEmail(val)) { setSingleFieldError('email', 'Enter a valid email address (e.g. parent@gmail.com)'); } }} placeholder="student@example.com" />{fieldErrors.email ? <span id="email-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.email}</span> : null}</div>
              </div>
              <div className="grid-2 mt-20">
                <div className="field-wrapper"><label className="field-label">Pincode <span className="req">*</span></label><input aria-describedby="pincode-error" className={fieldErrors.pincode ? "field-input error" : "field-input"} title="Pincode" value={pincode} required minLength={6} maxLength={6} onChange={(e) => { setPincode(e.target.value.replace(/\D/g, "").slice(0, 6)); setSingleFieldError('pincode', ''); }} onBlur={() => { const trimmed = pincode.trim(); if (!trimmed) { setSingleFieldError('pincode', 'Pincode is required'); } else if (!/^[1-9]\d{5}$/.test(trimmed)) { setSingleFieldError('pincode', 'Enter a valid 6-digit Indian pincode'); } else { lookupPincodeOnBlur(trimmed); } }} />{pinLookupLoading ? <p className="status-info" style={{ color: '#6c3ce1' }}>⏳ Looking up address…</p> : (pinLookupMessage ? <p className="status-info">{pinLookupMessage}</p> : null)}{fieldErrors.pincode ? <span id="pincode-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.pincode}</span> : null}</div>
                <div className="field-wrapper"><label className="field-label">Address line <span className="req">*</span></label><input aria-describedby="address_line-error" className={fieldErrors.address_line ? "field-input error" : "field-input"} title="Address line" value={addressLine} onChange={(e) => { setAddressLine(e.target.value.slice(0, 200)); setSingleFieldError("address_line", ""); }} onBlur={() => { if (!addressLine.trim()) { setSingleFieldError('address_line', 'Address is required'); } else if (addressLine.trim().length < 10) { setSingleFieldError('address_line', 'Please enter a complete address (at least 10 characters)'); } else { setSingleFieldError('address_line', ''); } }} />{fieldErrors.address_line ? <span id="address_line-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.address_line}</span> : null}</div>
              </div>
              <div className="grid-3 mt-20">
                <div className="field-wrapper"><label className="field-label">State <span className="req">*</span></label>{manualAddressMode ? <input className={fieldErrors.state ? "field-input error" : "field-input"} title="State" value={stateName} onChange={(e) => { setStateName(e.target.value.replace(/[^A-Za-z\s.-]/g, '').slice(0, 60)); setSingleFieldError('state', ''); }} onBlur={(e) => { const val = toTitleCase(e.target.value); setStateName(val); if (!val.trim()) { setSingleFieldError('state', 'State is required'); } }} /> : <select className={fieldErrors.state ? "field-select error" : "field-select"} title="State" value={stateName} onChange={(e) => { const nextState = e.target.value; setStateName(nextState); setDistrict(""); setCity(""); void loadCitiesForState(nextState); }} disabled={!pinIsValid}><option value="">Select State</option>{stateOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select>}{fieldErrors.state ? <p className="error-msg">{fieldErrors.state}</p> : null}</div>
                <div className="field-wrapper"><label className="field-label">District <span className="req">*</span></label><input className={fieldErrors.district ? "field-input error" : "field-input"} title="District" value={district} onChange={(e) => { setDistrict(e.target.value.replace(/[^A-Za-z\s.-]/g, '').slice(0, 60)); setSingleFieldError('district', ''); }} onBlur={(e) => { setDistrict(toTitleCase(e.target.value)); if (!e.target.value.trim()) { setSingleFieldError('district', 'District is required'); } else if (e.target.value.trim().length < 2) { setSingleFieldError('district', 'District name too short'); } }} disabled={!manualAddressMode && !pinIsValid} />{fieldErrors.district ? <p className="error-msg">{fieldErrors.district}</p> : null}</div>
                <div className="field-wrapper"><label className="field-label">City <span className="req">*</span></label><input list="city-options" className={fieldErrors.city ? "field-input error" : "field-input"} title="City" value={city} onChange={(e) => { setCity(e.target.value.replace(/[^A-Za-z\s.-]/g, '').slice(0, 60)); setSingleFieldError('city', ''); }} onBlur={(e) => { setCity(toTitleCase(e.target.value)); if (!e.target.value.trim()) { setSingleFieldError('city', 'City is required'); } else if (e.target.value.trim().length < 2) { setSingleFieldError('city', 'City name too short'); } }} disabled={!manualAddressMode && !pinIsValid} /><datalist id="city-options">{cityOptions.map((item) => <option key={item} value={item} />)}</datalist>{fieldErrors.city ? <p className="error-msg">{fieldErrors.city}</p> : null}</div>
              </div>
              <div className="grid-2 mt-20">
                <div className="field-wrapper">
                  <label className="field-label">Landmark <span className="badge badge-optional">OPTIONAL</span></label>
                  <input className="field-input" title="Landmark" value={landmark} onChange={(e) => setLandmark(e.target.value.slice(0, 100))} placeholder="Near school, landmark, area name…" />
                </div>
                <div className="field-wrapper">
                  <label className="field-label">Means of transport <span className="badge badge-optional">OPTIONAL</span></label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                    {['School bus', 'Private vehicle', 'Auto-rickshaw', 'Cycle', 'Walk', 'Public bus/metro', 'Cab/Taxi'].map(mode => (
                      <button key={mode} type="button"
                        className={`pill-btn ${transportModes.includes(mode) ? 'pill-btn-active' : ''}`}
                        onClick={() => setTransportModes(prev => prev.includes(mode) ? prev.filter(x => x !== mode) : [...prev, mode])}>
                        {mode}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <input className="field-input" style={{ flex: 1 }} value={transportCustom} onChange={(e) => setTransportCustom(e.target.value)} placeholder="Custom transport mode…" />
                    <button type="button" className="btn-outline" style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                      onClick={() => { if (transportCustom.trim()) { setTransportModes(prev => [...prev, transportCustom.trim()]); setTransportCustom(""); } }}>
                      Add
                    </button>
                  </div>
                </div>
              </div>
              {renderSectionNavButtons("contact")}
            </section>

            <div style={{ display: activeNavSection === "guardians" ? "block" : "none" }}>
            <StudentGuardiansStep
              drafts={guardianDrafts}
              onDraftsChange={(next) => {
                setGuardianDrafts(next);
                setGuardianCardErrors(next.map(() => ({})));
                setGuardianSubmitError(null);
                // Live-clear the "at least one guardian required" error as soon
                // as any draft has its 3 required fields filled (or is linked
                // to an existing guardian).
                const hasValidGuardian = next.some((d) => {
                  if (d.linkedExistingId != null) return true;
                  return !!(d.fullName?.trim() && d.relation?.trim() && d.phone?.trim());
                });
                if (hasValidGuardian) {
                  setFieldErrors((prev) => {
                    if (!prev.guardian) return prev;
                    const { guardian: _removed, ...rest } = prev;
                    return rest;
                  });
                }
              }}
              existingGuardians={guardians}
              sectionCounter={getSectionCounter("guardians")}
              errorsByCard={guardianCardErrors}
              submitError={guardianSubmitError ?? fieldErrors.guardian ?? null}
              navButtonsSlot={renderSectionNavButtons("guardians")}
            />
            </div>

            {/* Friends & Family Emergency Contacts */}
            <div style={{ display: activeNavSection === "guardians" ? "block" : "none" }}>
              <div style={{ margin: '0 24px 24px', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden' }}>
                <button
                  type="button"
                  onClick={() => setFriendsContactsOpen(v => !v)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: '#f9fafb', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600, color: '#374151' }}
                >
                  <span>👥 Friends & Family Emergency Contacts <span style={{ fontSize: 12, fontWeight: 400, color: '#6b7280' }}>(in case parents are unreachable)</span></span>
                  <span>{friendsContactsOpen ? '▲' : '▼'}</span>
                </button>
                {friendsContactsOpen && (
                  <div style={{ padding: '16px 18px', background: '#fff' }}>
                    {friendsContacts.length === 0 && (
                      <p style={{ fontSize: 13, color: '#9ca3af', marginBottom: 12 }}>No emergency contacts added yet. Use these for people other than listed guardians.</p>
                    )}
                    {friendsContacts.map((fc, i) => (
                      <div key={fc.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, marginBottom: 10, alignItems: 'end' }}>
                        <div className="field-wrapper" style={{ marginBottom: 0 }}>
                          <label className="field-label">Name</label>
                          <input className="field-input" value={fc.name} onChange={e => setFriendsContacts(prev => prev.map((x, j) => j === i ? { ...x, name: e.target.value.replace(/[^A-Za-z\s'.-]/g, '') } : x))} placeholder="Full name" />
                        </div>
                        <div className="field-wrapper" style={{ marginBottom: 0 }}>
                          <label className="field-label">Relation</label>
                          <input className="field-input" value={fc.relation} onChange={e => setFriendsContacts(prev => prev.map((x, j) => j === i ? { ...x, relation: e.target.value } : x))} placeholder="Uncle, Aunt, Family friend…" />
                        </div>
                        <div className="field-wrapper" style={{ marginBottom: 0 }}>
                          <label className="field-label">Phone</label>
                          <input className="field-input" value={fc.phone} onChange={e => setFriendsContacts(prev => prev.map((x, j) => j === i ? { ...x, phone: e.target.value.replace(/\D/g,'').slice(0,10) } : x))} placeholder="10-digit mobile" />
                        </div>
                        <button type="button" onClick={() => setFriendsContacts(prev => prev.filter((_, j) => j !== i))} style={{ padding: '8px 10px', background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 8, cursor: 'pointer', color: '#dc2626', fontSize: 13 }}>✕</button>
                      </div>
                    ))}
                    <button type="button"
                      onClick={() => setFriendsContacts(prev => [...prev, { id: String(Date.now() + Math.random()), name: '', relation: '', phone: '' }])}
                      style={{ padding: '8px 16px', background: '#f0fdf4', border: '1px dashed #86efac', borderRadius: 8, cursor: 'pointer', fontSize: 13, color: '#166534', fontWeight: 500 }}>
                      + Add contact
                    </button>
                  </div>
                )}
              </div>
            </div>

            <section className="section-card" id="apaar" style={{ display: activeNavSection === 'apaar' ? 'block' : 'none' }}>
              <div className="section-card-header">
                <div>
                  <h2 className="section-title">Government <span className="title-accent">identity</span></h2>
                  <p className="section-subtitle">India&apos;s &ldquo;One Nation, One Student ID&rdquo; — a 12-digit lifelong academic identity issued by the Ministry of Education (NEP 2020).</p>
                </div>
                <span className="section-counter">{getSectionCounter('apaar')}</span>
              </div>
              <div className="apaar-tip">📋 This only checks that the APAAR ID is 12 digits — it is not verified against APAAR/UDISE+. Confirm the physical APAAR card or UDISE+ portal before relying on this ID.</div>
              <div className="grid-2 mt-20">
                <div className="field-wrapper">
                  <label className="field-label">APAAR ID <span className="badge badge-optional">OPTIONAL</span></label>
                  <input
                    className={fieldErrors.apaar_id ? "field-input error" : "field-input"}
                    title="APAAR ID"
                    value={(apaarRaw.match(/.{1,4}/g) || []).join(" ")}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 12);
                      setApaarRaw(digits);
                      setSingleFieldError('apaar_id', '');
                    }}
                    placeholder="1234 5678 9012"
                    maxLength={14}
                  />
                  {apaarStatus === "verifying" ? <p className="status-info">Checking format…</p> : null}
                  {apaarStatus === "verified" ? <p className="status-info" style={{ color: "#047857" }}>✓ Valid 12-digit format (not verified against APAAR/UDISE+).</p> : null}
                  {fieldErrors.apaar_id ? <p className="error-msg">{fieldErrors.apaar_id}</p> : null}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    className="btn-upload-file"
                    style={{ marginBottom: 0 }}
                    disabled={apaarStatus === 'verifying' || !apaarRaw.trim()}
                    title="Checks the ID is 12 digits — does not contact APAAR/UDISE+"
                    onClick={() => {
                      if (!apaarRaw.trim()) {
                        setSingleFieldError('apaar_id', 'Please enter an APAAR ID before checking.');
                        return;
                      }
                      if (apaarRaw.length !== 12) {
                        setSingleFieldError('apaar_id', 'APAAR ID must be exactly 12 digits.');
                        return;
                      }
                      setApaarStatus('verifying');
                      window.setTimeout(() => {
                        setApaarStatus('verified');
                        setSingleFieldError('apaar_id', '');
                      }, 300);
                    }}
                  >
                    {apaarStatus === 'verifying' ? '⟳ Checking…' : 'Check format'}
                  </button>
                  <button type="button" className="btn-upload-file" style={{ marginBottom: 0 }}>Generate new</button>
                </div>
              </div>
              <div className="form-divider"><span>OTHER GOVERNMENT IDS</span></div>
              <div className="grid-2">
                <div className="field-wrapper">
                  <label className="field-label">Aadhaar number <span className="badge badge-optional">OPTIONAL</span></label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      key={aadhaarVisible ? 'aadhaar-show' : 'aadhaar-hide'}
                      className={`field-input ${fieldErrors.aadhaar_no ? 'error' : ''}`}
                      title="Aadhaar number"
                      type={aadhaarVisible ? "text" : "password"}
                      readOnly={!aadhaarVisible}
                      aria-describedby="aadhaar-error"
                      value={aadhaarVisible
                        ? aadhaarNo.replace(/(\d{4})(\d{0,4})(\d{0,4})/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' ')).trim()
                        : (aadhaarNo.length >= 4 ? 'XXXX XXXX ' + aadhaarNo.slice(-4) : aadhaarNo.padEnd(aadhaarNo.length, 'X'))}
                      onChange={(e) => { if (aadhaarVisible) { setAadhaarNo(e.target.value.replace(/\D/g,'').slice(0,12)); setSingleFieldError('aadhaar_no',''); } }}
                      onBlur={() => { if (aadhaarNo.trim() && !isValidAadhaar(aadhaarNo)) setSingleFieldError('aadhaar_no','Aadhaar must be exactly 12 digits (no repeated digits)'); else if (aadhaarNo.trim()) setSingleFieldError('aadhaar_no',''); }}
                      placeholder="12-digit Aadhaar"
                      maxLength={14}
                      style={{ flex: 1 }}
                    />
                    <button type="button" onClick={() => setAadhaarVisible(v => !v)} style={{ padding: '6px 10px', background: 'none', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>
                      {aadhaarVisible ? '🙈 Hide' : '👁 Show'}
                    </button>
                  </div>
                  <p className="help-text">Stored encrypted — used for APAAR KYC only</p>
                  <p className="help-text" style={{ color: '#6b7280', fontStyle: 'italic' }}>Aadhaar is only required if performing APAAR KYC verification.</p>
                  {fieldErrors.aadhaar_no ? <span id="aadhaar-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.aadhaar_no}</span> : null}
                </div>
                <div className="field-wrapper">
                  <label className="field-label">PEN / UDISE+ <span className="badge badge-optional">OPTIONAL</span></label>
                  <input aria-describedby="pen-error" className={fieldErrors.pen ? "field-input error" : "field-input"} title="PEN number" value={pen} onChange={(e) => { setPen(e.target.value.replace(/\D/g, '').slice(0, 11)); setSingleFieldError('pen', ''); }} onBlur={() => { if (pen.trim() && !isValidPEN(pen)) setSingleFieldError('pen','PEN/UDISE+ must be exactly 11 digits'); else if (pen.trim()) setSingleFieldError('pen',''); }} placeholder="Permanent Education Number" />
                  {fieldErrors.pen ? <span id="pen-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.pen}</span> : null}
                </div>
              </div>
              <div className="grid-2 mt-20">
                <div className="field-wrapper">
                  <label className="field-label">DigiLocker mobile <span className="badge badge-optional">OPTIONAL</span></label>
                  <input aria-describedby="digi_mobile-error" className={fieldErrors.digi_mobile ? "field-input error" : "field-input"} title="DigiLocker mobile" value={digiMobile} onChange={(e) => { setDigiMobile(e.target.value.replace(/\D/g,'').slice(0,10)); setSingleFieldError('digi_mobile',''); }} onBlur={() => { if (digiMobile.trim() && !isValidPhone(digiMobile)) setSingleFieldError('digi_mobile','Enter a valid 10-digit mobile number starting with 6-9'); else if (digiMobile.trim()) setSingleFieldError('digi_mobile',''); }} placeholder="Aadhaar-linked mobile" />
                  {fieldErrors.digi_mobile ? <span id="digi_mobile-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.digi_mobile}</span> : null}
                </div>
                <div className="field-wrapper">
                  <label className="field-label">ABC Portal ID <span className="badge badge-optional">OPTIONAL</span> <span title="ABC ID (Academic Bank of Credits) is issued by the Government of India's National Academic Depository. Find yours at abc.gov.in" style={{ cursor: 'help', fontSize: 11, background: '#e5e7eb', borderRadius: '50%', width: 16, height: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontWeight: 700 }}>?</span></label>
                  <input aria-describedby="abc_id-error" className={fieldErrors.abc_id ? "field-input error" : "field-input"} title="ABC Portal ID" value={abcId} onChange={(e) => { setAbcId(e.target.value.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 12)); setSingleFieldError('abc_id',''); }} onBlur={() => { if (abcId.trim() && !isValidABCId(abcId)) setSingleFieldError('abc_id','ABC ID must be exactly 12 alphanumeric characters'); else if (abcId.trim()) setSingleFieldError('abc_id',''); }} placeholder="From abc.gov.in" />
                  {fieldErrors.abc_id ? <span id="abc_id-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.abc_id}</span> : null}
                </div>
              </div>
              <div className="encryption-disclosure">
                🔒 Aadhaar and biometric data are stored AES-256 encrypted and are never shared with third parties. Access is restricted to authorised school administrators only, in compliance with the DPDPA 2023.
              </div>
              {renderSectionNavButtons('apaar')}
            </section>

            <div style={{ display: activeNavSection === "documents" ? "block" : "none" }}>
            <StudentDocumentsUpload
              documents={documents}
              onPickFile={handleDocumentPick}
              onDeleteFile={handleDocumentDelete}
              consentChecked={consentChecked}
              onConsentChange={setConsentChecked}
              consentError={fieldErrors.consent}
              sectionCounter={getSectionCounter("documents")}
              categoryName={validCategories.find((c) => String(c.id) === categoryId)?.name}
              isPwD={isPwD}
              initialCustomDocs={customDocsMeta}
              initialMarksheets={marksheetMeta}
              onCustomDocsMetaChange={setCustomDocsMeta}
              onMarksheetMetaChange={setMarksheetMeta}
              navButtonsSlot={renderSectionNavButtons("documents")}
            />
            </div>

            <section className="section-card" id="medical" style={{ display: activeNavSection === "medical" ? "block" : "none" }}>
              <div className="section-card-header">
                <div>
                  <h2 className="section-title">Medical & <span className="title-accent">emergency</span></h2>
                  <p className="section-subtitle">Health snapshot, allergies, vaccinations, and an emergency contact.</p>
                </div>
                <span className="section-counter">{getSectionCounter("medical")}</span>
              </div>

              <div className="grid-3">
                <div className="field-wrapper">
                  <label className="field-label">Height <span className="badge badge-optional">OPTIONAL</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="30" max="250" step="0.1" className={fieldErrors.height ? "field-input error" : "field-input"} title="Height in cm" value={heightCm} onChange={(e) => { setHeightCm(e.target.value); setSingleFieldError('height',''); }} onBlur={() => { const v = parseFloat(heightCm); if (heightCm && (v < 30 || v > 250)) setSingleFieldError('height', 'Height must be between 30 and 250 cm.'); }} placeholder="e.g. 120" />
                    <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>cm</span>
                  </div>
                  {fieldErrors.height ? <p className="error-msg">{fieldErrors.height}</p> : null}
                </div>
                <div className="field-wrapper">
                  <label className="field-label">Weight <span className="badge badge-optional">OPTIONAL</span></label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="1" max="200" step="0.1" className={fieldErrors.weight ? "field-input error" : "field-input"} title="Weight in kg" value={weightKg} onChange={(e) => { setWeightKg(e.target.value); setSingleFieldError('weight',''); }} onBlur={() => { const v = parseFloat(weightKg); if (weightKg && (v < 1 || v > 200)) setSingleFieldError('weight', 'Weight must be between 1 and 200 kg.'); }} placeholder="e.g. 22" />
                    <span style={{ fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>kg</span>
                  </div>
                  {fieldErrors.weight ? <p className="error-msg">{fieldErrors.weight}</p> : null}
                </div>
                <div className="field-wrapper">
                  <label className="field-label">Vision <span className="badge badge-optional">OPTIONAL</span></label>
                  <div className="pill-btn-row">
                    <button key="not-assessed" type="button"
                      onClick={() => setVision("")}
                      className={`pill-btn ${vision === "" ? 'pill-btn-active' : ''}`}>
                      Not assessed
                    </button>
                    {(['Normal','Near-sighted','Far-sighted','Low vision'] as const).map(v => (
                      <button key={v} type="button"
                        onClick={() => setVision(v)}
                        className={`pill-btn ${vision === v ? 'pill-btn-active' : ''}`}>
                        {v}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="grid-2 mt-20">
                <div className="field-wrapper">
                  <label className="field-label">Known medical conditions</label>
                  <div style={{ display: "flex", gap: 6 }}>
                     <input className="field-input" title="Add a medical condition" value={medicalConditionInput} onChange={(e) => { setMedicalConditionInput(e.target.value.slice(0, 100)); if (medCondError) setMedCondError(''); }} placeholder="Asthma, diabetes…" onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && medicalConditionInput.trim()) { e.preventDefault(); setMedicalConditions((p) => [...p, medicalConditionInput.trim().replace(/,+$/, "")]); setMedicalConditionInput(""); setMedCondError(''); } else if (e.key === "Backspace" && !medicalConditionInput && medicalConditions.length > 0) { setMedicalConditions((p) => p.slice(0, -1)); } }} />
                     <button type="button" className="btn-upload-file" onClick={() => { if (!medicalConditionInput.trim()) { setMedCondError('Type a condition name before adding.'); return; } setMedicalConditions((p) => [...p, medicalConditionInput.trim()]); setMedicalConditionInput(""); setMedCondError(''); }}>Add</button>
                   </div>
                   {medCondError ? <p className="error-msg">{medCondError}</p> : null}
                  {medicalConditions.length > 0 ? <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>{medicalConditions.map((c, i) => <span key={`${c}-${i}`} style={{ background: "#f3f4f6", padding: "3px 10px", borderRadius: 999, fontSize: 12 }}>{c} <button type="button" onClick={() => setMedicalConditions((p) => p.filter((_, idx) => idx !== i))} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#6b7280" }} aria-label={`Remove ${c}`}>×</button></span>)}</div> : null}
                </div>
                <div className="field-wrapper">
                  <label className="field-label">Allergies</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input className="field-input" title="Add an allergy" value={allergyInput} onChange={(e) => setAllergyInput(e.target.value.slice(0, 100))} placeholder="Peanuts, dust…" onKeyDown={(e) => { if ((e.key === "Enter" || e.key === ",") && allergyInput.trim()) { e.preventDefault(); setAllergies((p) => [...p, allergyInput.trim().replace(/,+$/, "")]); setAllergyInput(""); } else if (e.key === "Backspace" && !allergyInput && allergies.length > 0) { setAllergies((p) => p.slice(0, -1)); } }} />
                    <button type="button" className="btn-upload-file" onClick={() => { if (allergyInput.trim()) { setAllergies((p) => [...p, allergyInput.trim()]); setAllergyInput(""); } }}>Add</button>
                  </div>
                  {allergies.length > 0 ? <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>{allergies.map((c, i) => <span key={`${c}-${i}`} style={{ background: "#fef3c7", padding: "3px 10px", borderRadius: 999, fontSize: 12 }}>{c} <button type="button" onClick={() => setAllergies((p) => p.filter((_, idx) => idx !== i))} style={{ background: "transparent", border: "none", cursor: "pointer", color: "#92400e" }} aria-label={`Remove ${c}`}>×</button></span>)}</div> : null}
                </div>
              </div>

              <div className="grid-2 mt-20">
                <div className="field-wrapper">
                  <label className="field-label">Current medications <span className="badge badge-optional">OPTIONAL</span></label>
                  <input className="field-input" title="Current medications" value={currentMedications} onChange={(e) => setCurrentMedications(e.target.value.slice(0, 200))} />
                </div>
                <div className="field-wrapper">
                  <label className="field-label">Treating doctor <span className="badge badge-optional">OPTIONAL</span></label>
                  <input className="field-input" title="Treating doctor" value={treatingDoctor} onChange={(e) => setTreatingDoctor(e.target.value.replace(/[^A-Za-z\s.,]/g, '').slice(0, 100))} />
                </div>
              </div>

              <div className="mt-20">
                <p className="field-label">Vaccinations completed</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 8 }}>
                  {COMMON_VACCINATIONS.map((v) => (
                    <label key={v.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }} title={!checkedVaccinations.includes(v.id) && suggestedVaccinations.includes(v.id) ? "Typically given at this age — confirm with the parent before ticking" : undefined}>
                      <input type="checkbox" checked={checkedVaccinations.includes(v.id)} onChange={(e) => setCheckedVaccinations((prev) => e.target.checked ? Array.from(new Set([...prev, v.id])) : prev.filter((x) => x !== v.id))} />
                      {v.label}
                      {!checkedVaccinations.includes(v.id) && suggestedVaccinations.includes(v.id) ? (
                        <span style={{ color: "#9ca3af", fontSize: 11, fontStyle: "italic" }}>(suggested)</span>
                      ) : null}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid-2 mt-20">
                <div className="field-wrapper">
                  <label className="field-label">Emergency contact name <span className="req">*</span></label>
                  <input className={fieldErrors.emergency_name ? "field-input error" : "field-input"} title="Emergency contact name" aria-describedby="emergency_name-error" value={emergencyName} onChange={(e) => { setEmergencyName(e.target.value.replace(/[^A-Za-z\s'.-]/g, '')); setEmergencyCopiedFromGuardian(false); setSingleFieldError("emergency_name", ""); }} onBlur={() => { if (!emergencyName.trim()) { setSingleFieldError('emergency_name', 'Emergency contact name is required'); } else if (emergencyName.trim().length < 3) { setSingleFieldError('emergency_name', 'Name must be at least 3 characters'); } else { setSingleFieldError('emergency_name', ''); } }} />
                  {emergencyCopiedFromGuardian ? <p className="status-info">Pre-filled from primary guardian. Edit if different.</p> : null}
                  {fieldErrors.emergency_name ? <span id="emergency_name-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.emergency_name}</span> : null}
                </div>
                <div className="field-wrapper">
                  <label className="field-label">Emergency contact phone <span className="req">*</span></label>
                  <input className={fieldErrors.emergency_phone ? "field-input error" : "field-input"} title="Emergency contact phone" aria-describedby="emergency_phone-error" value={emergencyPhone} onChange={(e) => { setEmergencyPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); setEmergencyCopiedFromGuardian(false); setSingleFieldError("emergency_phone", ""); }} onBlur={() => { if (!emergencyPhone.trim()) { setSingleFieldError('emergency_phone', 'Emergency contact phone is required'); } else if (!isValidPhone(emergencyPhone)) { setSingleFieldError('emergency_phone', 'Enter a valid 10-digit mobile number starting with 6-9'); } else { setSingleFieldError('emergency_phone', ''); } }} placeholder="10-digit mobile" />
                  {fieldErrors.emergency_phone ? <span id="emergency_phone-error" role="alert" aria-live="polite" className="error-msg">{fieldErrors.emergency_phone}</span> : null}
                </div>
              </div>

              {renderSectionNavButtons("medical")}
            </section>

            <section className="section-card" id="speciallyAbled" style={{ display: activeNavSection === 'speciallyAbled' ? 'block' : 'none' }}>
              <div className="section-card-header">
                <div>
                  <h2 className="section-title">Specially <span className="title-accent">abled</span></h2>
                  <p className="section-subtitle">As per Rights of Persons with Disabilities Act, 2016.</p>
                </div>
                <span className="section-counter">{getSectionCounter('speciallyAbled')}</span>
              </div>
              <div className="disclosure-banner-green">🔒 Disclosure is voluntary and optional. Sharing this helps us arrange appropriate accommodations, assistive technologies, and an inclusive learning environment.</div>
              <div className="pwd-toggle-row">
                <div>
                  <div className="pwd-toggle-label">Is this student a Person with Disability (PwD)?</div>
                  <div className="pwd-toggle-hint">Toggle to disclose — you can update this at any time</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: '#6b7280' }}>{isPwD ? 'Yes — disclosing disability' : 'Not disclosed'}</span>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={isPwD} onChange={e => {
                      const next = e.target.checked;
                      setIsPwD(next);
                      if (next) { setPwdFlash(true); window.setTimeout(() => setPwdFlash(false), 2000); }
                    }} />
                    <span className="toggle-slider" />
                  </label>
                  {pwdFlash && <span style={{ color: '#047857', fontSize: 12, marginLeft: 4, transition: 'opacity 0.5s' }}>✓ Disclosure recorded</span>}
                </div>
              </div>
              {isPwD && (
                <>
                  <div className="mt-20">
                    <p className="field-label">Disability type (select all that apply)</p>
                    <div className="pill-btn-row" style={{ marginTop: 8 }}>
                      {['Visual Impairment','Hearing Impairment','Locomotor Disability','Intellectual Disability','Autism Spectrum','Learning Disability','Speech & Language','Mental Illness','Multiple Disabilities','Other / not listed'].map(dt => (
                        <button key={dt} type="button"
                          className={`pill-btn ${disabilityTypes.includes(dt) ? 'pill-btn-active' : ''}`}
                          onClick={() => setDisabilityTypes(prev => prev.includes(dt) ? prev.filter(x => x !== dt) : [...prev, dt])}>
                          {dt}
                        </button>
                      ))}
                    </div>
                    {disabilityTypes.includes('Other / not listed') && (
                      <input className="field-input" style={{ marginTop: 8 }} placeholder="Specify disability type..." value={otherDisabilityText} onChange={e => setOtherDisabilityText(e.target.value.slice(0, 100))} />
                    )}
                  </div>
                  <div className="field-wrapper mt-20">
                    <label className="field-label">Disability percentage: <span>{disabilityPercent}%</span></label>
                    <input type="range" min={0} max={100} value={disabilityPercent} onChange={e => setDisabilityPercent(Number(e.target.value))} style={{ width: '100%' }} aria-label="Disability percentage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={disabilityPercent} />
                    <p className="help-text">As certified by authorised medical authority</p>
                  </div>
                  <div className="field-wrapper mt-20">
                    <label className="field-label">UDID Card Number <span className="badge badge-optional">OPTIONAL</span></label>
                    <input className="field-input" title="UDID Card Number" value={udid} onChange={e => setUdid(e.target.value.replace(/[^A-Z0-9-]/g, '').slice(0, 30).toUpperCase())} placeholder="Issued by Dept for Empowerment of PwDs" />
                  </div>
                  <div className="mt-20">
                    <p className="field-label">Accommodations required</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                      {['Scribe / amanuensis for exams','Extra time in examinations (25%)','Wheelchair / ramp access','Sign language interpreter','Braille / large-print materials','Assistive technology / software'].map(acc => (
                        <label key={acc} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <input type="checkbox" checked={accommodations.includes(acc)} onChange={e => setAccommodations(prev => e.target.checked ? [...prev, acc] : prev.filter(x => x !== acc))} />
                          {acc}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="field-wrapper mt-20">
                    <label className="field-label">Additional notes <span className="badge badge-optional">OPTIONAL</span></label>
                    <textarea className="field-textarea" rows={3} value={additionalNotes} onChange={e => setAdditionalNotes(e.target.value.slice(0, 300))} />
                  </div>
                </>
              )}
              {renderSectionNavButtons('speciallyAbled')}
            </section>

            <section className="section-card" id="identityMarks" style={{ display: activeNavSection === 'identityMarks' ? 'block' : 'none' }}>
              <div className="section-card-header">
                <div>
                  <h2 className="section-title">Identity <span className="title-accent">marks</span></h2>
                  <p className="section-subtitle">Physical identification marks for administrative identity verification only.</p>
                </div>
                <span className="section-counter">{getSectionCounter('identityMarks')}</span>
              </div>
              <div className="apaar-tip" style={{ background: '#fef2f2', borderLeftColor: '#ef4444', color: '#7f1d1d' }}>
                🚨 Recorded exclusively for identity verification (exam hall, lost documents). Accessible only to authorised administrative staff.
              </div>
              <div className="identity-marks-grid">
                <div className="body-diagram">
                  <div style={{ background: '#f9fafb', borderRadius: 12, padding: 24, textAlign: 'center', color: '#9ca3af', border: '2px dashed #e5e7eb' }}>
                    <div style={{ fontSize: 32, marginBottom: 8 }}>🧍</div>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>Zone diagram coming soon</p>
                    <p style={{ margin: '4px 0 0', fontSize: 12 }}>Use &quot;+ Add mark manually&quot; below to record identification marks.</p>
                  </div>
                </div>
                <div className="marks-list">
                  <p className="marks-hint">Click any body zone to record an identification mark, or add manually below.</p>
                  <button type="button" className="btn-outline-sm" onClick={() => setMarkFormOpen(true)}>+ Add mark manually</button>
                  {markFormOpen && (
                    <div style={{ marginTop: 12, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, background: '#f9fafb' }}>
                      <div className="field-wrapper">
                        <label className="field-label">Body location</label>
                        <input className="field-input" value={newMarkLocation} onChange={e => setNewMarkLocation(e.target.value)} placeholder="e.g. Left forearm" />
                      </div>
                      <div className="field-wrapper" style={{ marginTop: 8 }}>
                        <label className="field-label">Description</label>
                        <input className="field-input" value={newMarkDescription} onChange={e => setNewMarkDescription(e.target.value.slice(0, 100))} placeholder="e.g. Mole, birthmark, scar" />
                      </div>
                      {fieldErrors.mark_location ? <p className="error-msg">{fieldErrors.mark_location}</p> : null}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button type="button" style={{ padding: '6px 14px', background: '#6c3ce1', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                          onClick={() => {
                            if (!newMarkLocation.trim()) { setSingleFieldError('mark_location', 'Please select or enter a body location.'); return; }
                            setIdentityMarks(prev => [...prev, { location: newMarkLocation.trim(), description: newMarkDescription.trim() }]);
                            setNewMarkLocation(''); setNewMarkDescription(''); setMarkFormOpen(false);
                            setSingleFieldError('mark_location', '');
                          }}>Save mark</button>
                        <button type="button" style={{ padding: '6px 14px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                          onClick={() => { setMarkFormOpen(false); setNewMarkLocation(''); setNewMarkDescription(''); setSingleFieldError('mark_location', ''); }}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {identityMarks.length > 0 && (
                    <ul style={{ marginTop: 12, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {identityMarks.map((m, i) => (
                        <li key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: '#f9fafb', borderRadius: 6, fontSize: 13 }}>
                          <span><strong>{m.location}:</strong> {m.description}</span>
                          <button type="button" onClick={() => setIdentityMarks(prev => prev.filter((_, idx) => idx !== i))} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#6b7280' }} aria-label="Remove mark">×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
              <div className="form-divider"><span>PHYSICAL DESCRIPTORS</span></div>
              <div className="grid-2">
                <div className="field-wrapper"><label className="field-label">Eye colour</label>
                  <select className="field-select" value={eyeColour} onChange={e=>setEyeColour(e.target.value)}>
                    <option value="">Select</option><option>Black</option><option>Brown</option><option>Hazel</option><option>Blue</option><option>Green</option><option>Grey</option>
                  </select></div>
                <div className="field-wrapper"><label className="field-label">Hair colour</label>
                  <select className="field-select" value={hairColour} onChange={e=>setHairColour(e.target.value)}>
                    <option value="">Select</option><option>Black</option><option>Brown</option><option>Blonde</option><option>Red</option><option>Grey</option><option>White</option>
                  </select></div>
              </div>
              <div className="grid-2 mt-20">
                <div className="field-wrapper"><label className="field-label">Complexion</label>
                  <select className="field-select" value={complexion} onChange={e=>setComplexion(e.target.value)}>
                    <option value="">Select</option><option>Fair</option><option>Wheatish</option><option>Medium</option><option>Dark</option>
                  </select></div>
                <div className="field-wrapper"><label className="field-label">Build</label>
                  <select className="field-select" value={build} onChange={e=>setBuild(e.target.value)}>
                    <option value="">Select</option><option>Slim</option><option>Average</option><option>Athletic</option><option>Heavy</option>
                  </select></div>
              </div>
              {renderSectionNavButtons('identityMarks')}
            </section>

            <div style={{ display: activeNavSection === "fees" ? "block" : "none" }}>
              <StudentFeesStep
                ref={feesStepRef}
                academicYearId={academicYearId}
                academicYearName={validAcademicYears.find((y) => String(y.id) === academicYearId)?.name}
                classId={classId}
                studentDisplayName={`${firstName.trim()} ${lastName.trim()}`.trim()}
                admissionNo={admissionNo}
                isDraft={!isEditMode}
                value={feePlan}
                onChange={setFeePlan}
                onSummaryChange={setFeeSummary}
                showToast={showToast}
                sectionCounter={getSectionCounter("fees")}
                navButtonsSlot={renderSectionNavButtons("fees")}
                existingAssignments={existingFeeAssignments}
              />
            </div>

            {/* REVIEW SECTION */}
            <section className="section-card" id="review" style={{ display: activeNavSection === "review" ? "block" : "none" }}>
              <div className="section-card-header">
                <div>
                  <h2 className="section-title">Final <span className="title-accent">review</span></h2>
                  <p className="section-subtitle">Double-check before you save. You can edit any section above.</p>
                </div>
                <span className="section-counter">{getSectionCounter("review")}</span>
              </div>

              {/* FIX 17: Structured validation errors */}
              {validationErrorList.length > 0 && (
                <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <p style={{ fontWeight: 600, color: '#7f1d1d', marginBottom: 8 }}>Please fix {validationErrorList.length} validation error(s):</p>
                  {validationErrorList.map((err, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', cursor: 'pointer' }}
                      onClick={() => { jumpToSection(err.section); setSingleFieldError(err.field, err.message); }}>
                      <span style={{ color: '#ef4444' }}>•</span>
                      <span style={{ fontSize: 13, color: '#374151' }}><strong>{NAV_ITEMS.find(n=>n.id===err.section)?.label}</strong> — {err.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* FIX 15: Grouped summary */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>Student Info</div>
                  <button type="button" onClick={() => { setReturnToReview(true); jumpToSection('identity'); }} style={{ fontSize:12, color:'#6c3ce1', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:500 }}>Edit →</button>
                </div>
                <div className="review-grid">
                  <div className="review-item"><div className="review-label">ADMISSION NO</div><div className="review-value">{admissionNo || '—'}</div></div>
                  <div className="review-item"><div className="review-label">FULL NAME</div><div className="review-value">{[firstName, lastName].filter(Boolean).join(' ') || '—'}</div></div>
                  <div className="review-item"><div className="review-label">DATE OF BIRTH</div><div className="review-value">{dateOfBirth || '—'}</div></div>
                  <div className="review-item"><div className="review-label">GENDER</div><div className="review-value">{gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : '—'}</div></div>
                  <div className="review-item"><div className="review-label">BLOOD GROUP</div><div className="review-value">{bloodGroup || '—'}</div></div>
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>Academic</div>
                  <button type="button" onClick={() => { setReturnToReview(true); jumpToSection('academic'); }} style={{ fontSize:12, color:'#6c3ce1', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:500 }}>Edit →</button>
                </div>
                <div className="review-grid">
                  <div className="review-item"><div className="review-label">CLASS / SECTION</div><div className="review-value">{selectedClass ? `${selectedClass.name}${selectedSection ? ' / ' + selectedSection.name : ''}` : '—'}</div></div>
                  <div className="review-item"><div className="review-label">ACADEMIC YEAR</div><div className="review-value">{validAcademicYears.find(y => String(y.id) === academicYearId)?.name || '—'}</div></div>
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>Guardian</div>
                  <button type="button" onClick={() => { setReturnToReview(true); jumpToSection('guardians'); }} style={{ fontSize:12, color:'#6c3ce1', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:500 }}>Edit →</button>
                </div>
                <div className="review-grid">
                  <div className="review-item"><div className="review-label">GUARDIAN NAME</div><div className="review-value">{guardianDrafts[0]?.fullName || '—'}</div></div>
                  <div className="review-item"><div className="review-label">GUARDIAN PHONE</div><div className="review-value">{guardianDrafts[0]?.phone || '—'}</div></div>
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>Contact</div>
                  <button type="button" onClick={() => { setReturnToReview(true); jumpToSection('contact'); }} style={{ fontSize:12, color:'#6c3ce1', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:500 }}>Edit →</button>
                </div>
                <div className="review-grid">
                  <div className="review-item"><div className="review-label">PHONE</div><div className="review-value">{phone || '—'}</div></div>
                  <div className="review-item"><div className="review-label">CITY / STATE</div><div className="review-value">{[city, stateName].filter(Boolean).join(', ') || '—'}</div></div>
                </div>
              </div>
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>Fee plan</div>
                  <button type="button" onClick={() => { setReturnToReview(true); jumpToSection('fees'); }} style={{ fontSize:12, color:'#6c3ce1', background:'none', border:'none', cursor:'pointer', padding:0, fontWeight:500 }}>Edit →</button>
                </div>
                <div className="review-grid">
                  <div className="review-item"><div className="review-label">FEE GROUP</div><div className="review-value">{feeSummary.groupName || 'Not assigned yet'}</div></div>
                  <div className="review-item"><div className="review-label">CONCESSION</div><div className="review-value">{feeSummary.concessionName || 'None'}</div></div>
                  <div className="review-item"><div className="review-label">FEE TYPES ASSIGNED</div><div className="review-value">{feeSummary.lineCount}</div></div>
                  <div className="review-item"><div className="review-label">ANNUAL TOTAL</div><div className="review-value">{feeSummary.annualTotal > 0 ? `₹${feeSummary.annualTotal.toLocaleString('en-IN')}` : '—'}</div></div>
                </div>
              </div>

              {/* FIX 16: Step completion checklist */}
              <div style={{ marginTop: 24, marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase', marginBottom: 12 }}>Step completion</div>
                {NAV_ITEMS.filter(item => item.id !== 'review').map(item => {
                  const complete = isStepComplete(item.id);
                  const icon = complete ? '✓' : '✗';
                  const color = complete ? '#10b981' : '#ef4444';
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
                      onClick={() => { setReturnToReview(true); jumpToSection(item.id as NavItemId); }}>
                      <span style={{ color, fontWeight: 700, fontSize: 14, width: 18 }}>{icon}</span>
                      <span style={{ fontSize: 13, color: '#374151' }}>{item.label}</span>
                      {!complete && <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 'auto' }}>Incomplete</span>}
                      {complete && <span style={{ fontSize: 11, color: '#10b981', marginLeft: 'auto' }}>Complete</span>}
                    </div>
                  );
                })}
              </div>

              <div className="review-pdf-section">
                <div className="review-pdf-title">📄 Preview & Print Filled Form</div>
                <p className="review-pdf-note">Before enrolling, you can preview the filled admission form.</p>
                <div className="review-pdf-actions">
                  <button type="button" className="review-pdf-btn" onClick={() => { setConsentOpenWithSettings(false); setConsentInitialAction(null); setConsentOpen(true); }}>
                    Open Filled PDF
                  </button>
                  <button type="button" className="review-pdf-btn secondary" onClick={() => { setConsentOpenWithSettings(false); setConsentInitialAction('print-pdf'); setConsentOpen(true); }}>
                    🖨 Print
                  </button>
                </div>
              </div>

              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 18, padding: 14, border: "1px solid #c4b5fd", background: "#f7f5ff", borderRadius: 12, cursor: "pointer" }}>
                <input type="checkbox" required checked={reviewConfirmed} aria-describedby="review_confirm-error" onChange={(e) => setReviewConfirmed(e.target.checked)} style={{ marginTop: 3 }} />
                <span style={{ fontSize: 13, color: "#374151" }}>
                  <strong style={{ display: "block", marginBottom: 2 }}>I&apos;ve reviewed every section</strong>
                  All required fields are filled and the information is accurate. I&apos;m ready to enroll this student.
                </span>
              </label>
              {!reviewConfirmed && <span id="review_confirm-error" role="alert" aria-live="polite" className="error-msg">Please confirm before enrolling</span>}

              {renderSectionNavButtons("review")}
            </section>
          </div>
        </div>

        </div>{/* /.enroll-scroll */}

        <footer className="enroll-footer">
          <div className="footer-progress-wrap" aria-label="Enrollment progress">
            <span className="footer-progress-label">Progress</span>
            <div className="footer-progress-track" title="Enrollment progress">
              <span className={`footer-progress-fill ${footerProgressClass}`} />
            </div>
            <span className="footer-progress-value">{footerProgressPercent}% complete</span>
          </div>

          {error ? <p className="footer-status footer-status-error">{error}</p> : null}

          <div className="footer-actions">
            <button type="button" className="btn-discard" onClick={() => setDiscardConfirmOpen(true)}>Discard</button>
            <button type="button" className="btn-draft" onClick={saveDraftNow}>Save draft</button>
            <button type="button" className="btn-outline" style={{ fontSize: 11, padding: '6px 10px', background: '#ecfdf5', color: '#065f46', borderColor: '#6ee7b7' }}
              title="Upload a signed consent form (PDF or image)"
              onClick={() => {
                // Open the OS file picker directly — no extra modal screen in the way
                setSignedUploadStatus('idle');
                setSignedUploadError('');
                setSignedUploadFile(null);
                setSignedUploadPreviewUrl('');
                signedUploadInputRef.current?.click();
              }}>
              📎 Upload signed
            </button>
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <button type="button"
                className="btn-outline"
                style={{ fontSize: 11, padding: '6px 10px', background: '#fffbeb', color: '#92400e', borderColor: '#fcd34d' }}
                title="Blank intake form options"
                onClick={() => setBlankFormMenuOpen(v => !v)}>
                📄 Blank form ▾
              </button>
              {blankFormMenuOpen && (
                <div
                  style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, boxShadow: '0 8px 28px rgba(0,0,0,0.14)', zIndex: 9999, minWidth: 220, overflow: 'hidden' }}
                  onMouseLeave={() => setBlankFormMenuOpen(false)}>
                  <div style={{ padding: '8px 14px 6px', fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid #f3f4f6' }}>Blank Form Options</div>
                  {([
                    { action: 'blank-form' as const, icon: '🖨', label: 'Download for physical fill', sub: 'Print & fill with pen' },
                    { action: 'blank-form-digital' as const, icon: '💻', label: 'Open digital form', sub: 'Fill in browser, save as PDF' },
                    { action: 'blank-form-email' as const, icon: '📧', label: 'Share via Email', sub: 'Downloads form + opens email' },
                    { action: 'blank-form-whatsapp' as const, icon: '💬', label: 'Share via WhatsApp', sub: 'Downloads form + opens WhatsApp' },
                  ] as const).map(item => (
                    <button
                      key={item.action}
                      type="button"
                      style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8f7ff')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      onClick={() => {
                        setBlankFormMenuOpen(false);
                        setConsentOpenWithSettings(false);
                        setConsentInitialAction(item.action);
                        setConsentOpen(true);
                      }}>
                      <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                      <span>
                        <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#111827' }}>{item.label}</span>
                        <span style={{ display: 'block', fontSize: 10, color: '#6b7280' }}>{item.sub}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="btn-outline" style={{ fontSize: 11, padding: '6px 10px', background: '#eff6ff', color: '#1e40af', borderColor: '#93c5fd' }}
              title="Upload a scanned filled form to auto-fill fields via OCR"
              onClick={() => setScanFillOpen(true)}>
              📷 Scan & fill
            </button>
            <button type="button" className="btn-outline"
              disabled={!firstName || !lastName || !admissionNo || !classId || !sectionId}
              title="Available after student is enrolled."
              onClick={() => { setConsentOpenWithSettings(false); setConsentInitialAction(null); setConsentOpen(true); }}>
              🖨 Print / PDF
            </button>
            {isViewMode && studentId ? (
              <Link href={`/students/add?mode=edit&id=${studentId}`} className="btn-save btn-save-cta">Edit student →</Link>
            ) : (
              <button type="submit" disabled={!canSubmit} className="btn-save btn-save-cta">{saving ? "Saving..." : isEditMode ? "Update student →" : "Enroll student →"}</button>
            )}
          </div>
        </footer>
      </form>

      {discardConfirmOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 420, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <h3 style={{ margin: '0 0 12px', fontSize: 18, fontWeight: 700, color: '#111827' }}>Discard enrollment?</h3>
            <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>All unsaved data will be lost. This cannot be undone.</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setDiscardConfirmOpen(false)} style={{ padding: '9px 20px', border: '1px solid #d1d5db', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}>Cancel</button>
              <button type="button" onClick={() => { setDiscardConfirmOpen(false); clearDraftNow(); }} style={{ padding: '9px 20px', border: '1px solid #dc2626', background: '#dc2626', color: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Discard</button>
            </div>
          </div>
        </div>
      )}

      {unsavedNavModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '28px 32px', maxWidth: 480, width: '92%', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 20 }}>⚠️</span>
              </div>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#111827' }}>You have unsaved changes</h3>
            </div>
            <p style={{ margin: '0 0 6px', color: '#374151', fontSize: 14 }}>
              You&apos;ve filled <strong>{requiredCompletionPct}%</strong> of the required information for this enrollment.
            </p>
            <p style={{ margin: '0 0 22px', color: '#6b7280', fontSize: 13 }}>
              {requiredCompletionPct >= 80
                ? 'You can enroll the student now, save as a draft to finish later, or discard everything.'
                : 'Choose what to do with this in-progress form before leaving.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {requiredCompletionPct >= 80 && (
                <button type="button" onClick={() => {
                  setUnsavedNavModalOpen(false);
                  pendingNavRef.current = null;
                  // Trigger the form submit (enroll)
                  const formEl = document.querySelector('form') as HTMLFormElement | null;
                  if (formEl) formEl.requestSubmit();
                }} style={{ padding: '11px 18px', background: 'linear-gradient(135deg, #7c3aed, #6c3ce1)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                  ✓ Enroll student now
                </button>
              )}
              <button type="button" onClick={() => {
                saveDraftSnapshot();
                showToast('Draft saved.', 'success', 3000);
                continuePendingNav();
              }} style={{ padding: '11px 18px', background: '#fff', color: '#1f2937', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                💾 Save as draft &amp; leave
              </button>
              <button type="button" onClick={() => {
                clearDraftNow();
                continuePendingNav();
              }} style={{ padding: '11px 18px', background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
                🗑 Discard &amp; leave
              </button>
              <button type="button" onClick={() => { pendingNavRef.current = null; setUnsavedNavModalOpen(false); }} style={{ padding: '9px 18px', background: 'transparent', color: '#6b7280', border: 'none', fontSize: 13, cursor: 'pointer', marginTop: 4 }}>
                Cancel — stay on this page
              </button>
            </div>
          </div>
        </div>
      )}
      {draftSavedModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: '32px 36px', maxWidth: 460, width: '92%', boxShadow: '0 24px 64px rgba(0,0,0,0.22)', textAlign: 'center' }}>
            {/* Success icon */}
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ecfdf5', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 18px' }}>
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                <path d="M6 14l5 5 11-11" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: 20, fontWeight: 700, color: '#111827' }}>Draft saved!</h3>
            <p style={{ margin: '0 0 6px', color: '#374151', fontSize: 14, fontWeight: 500 }}>
              {firstName ? `${firstName}${lastName ? ' ' + lastName : ''}'s` : 'The'} enrollment has been saved as a draft.
            </p>
            <p style={{ margin: '0 0 28px', color: '#6b7280', fontSize: 13 }}>
              You can come back anytime from the <strong>Drafts</strong> button to continue.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setDraftSavedModalOpen(false);
                  clearDraftNow();
                }}
                style={{ padding: '13px 24px', background: 'linear-gradient(135deg, #6c3ce1, #8b5cf6)', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="#fff" strokeWidth="2" strokeLinecap="round"/></svg>
                Enroll another student (fresh form)
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftSavedModalOpen(false);
                  // The draft was just saved, so there's nothing unsaved left to warn
                  // about — without this, the beforeunload guard (isFormDirty is still
                  // true here; nothing clears it before this navigation) throws up the
                  // native "Leave site?" confirmation, which looks like the button does
                  // nothing if it's dismissed or not noticed.
                  bypassUnloadGuardRef.current = true;
                  if (typeof window !== 'undefined') window.location.href = '/students/list';
                }}
                style={{ padding: '13px 24px', background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                Go to students list
              </button>
            </div>
          </div>
        </div>
      )}

      {infoChecklistOpen && (
        <div onClick={() => setInfoChecklistOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, padding: 0, maxWidth: 720, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 64px rgba(0,0,0,0.25)' }}>
            <div style={{ padding: '20px 26px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>📋 What you&apos;ll need to enroll a student</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Use this checklist with the parents before starting. <strong style={{ color: '#dc2626' }}>*</strong> = required to enroll.</p>
              </div>
              <button type="button" onClick={() => setInfoChecklistOpen(false)} aria-label="Close checklist" style={{ background: 'transparent', border: 'none', fontSize: 22, color: '#6b7280', cursor: 'pointer', padding: 4 }}>×</button>
            </div>
            <div style={{ padding: '18px 26px', overflowY: 'auto' }}>
              {[
                { n: 1, title: 'Student identity', items: [
                  { t: 'Full legal name (first, last)', req: true },
                  { t: 'Date of birth (must match age band of class)', req: true },
                  { t: 'Gender', req: true },
                  { t: 'Recent photo (square JPG/PNG, ≥400×400)', req: false },
                  { t: 'Blood group', req: false },
                  { t: 'Mother tongue, religion, nationality', req: false },
                ]},
                { n: 2, title: 'Academic placement', items: [
                  { t: 'Academic year', req: true },
                  { t: 'Class & section', req: true },
                  { t: 'House (auto-suggested by AI)', req: false },
                  { t: 'Roll number (auto if blank)', req: false },
                  { t: 'Admission type, previous school name', req: false },
                ]},
                { n: 3, title: 'Contact & address', items: [
                  { t: 'Mobile number (10-digit)', req: true },
                  { t: 'Address line, pincode (auto-fills city/state)', req: true },
                  { t: 'Email address', req: false },
                  { t: 'Landmark, means of transport', req: false },
                ]},
                { n: 4, title: 'Family & guardians', items: [
                  { t: 'Guardian 1: name, relationship, mobile', req: true },
                  { t: 'Guardian 1: occupation, email', req: false },
                  { t: 'Additional guardians (mother/father/other)', req: false },
                  { t: 'Sibling already in school (for linking)', req: false },
                  { t: 'Friends/family emergency contacts', req: false },
                ]},
                { n: 5, title: 'Government identity', items: [
                  { t: "Aadhaar number (12-digit) — student's", req: false },
                  { t: 'Aadhaar of guardian (if student doesn\u2019t have)', req: false },
                  { t: 'Birth certificate number', req: false },
                  { t: 'Caste / category certificate (if applicable)', req: false },
                  { t: 'PAN of guardian (for fee receipts > ₹2L)', req: false },
                ]},
                { n: 6, title: 'Documents to upload', items: [
                  { t: 'Signed parent/guardian consent form', req: true },
                  { t: 'Birth certificate scan', req: false },
                  { t: 'Aadhaar scan (student / guardian)', req: false },
                  { t: 'Previous school TC / report card / mark sheets', req: false },
                  { t: 'Caste / income certificate (if applicable)', req: false },
                  { t: 'Custom documents (give a name + short note)', req: false },
                ]},
                { n: 7, title: 'Medical & emergency', items: [
                  { t: 'Emergency contact name & phone', req: true },
                  { t: 'Known medical conditions (asthma, diabetes…)', req: false },
                  { t: 'Allergies (food, medication, environment)', req: false },
                  { t: 'Vaccination history / records', req: false },
                  { t: 'Family doctor name & phone', req: false },
                ]},
                { n: 8, title: 'Specially abled (if applicable)', items: [
                  { t: 'Type of need (visual, hearing, learning…)', req: false },
                  { t: 'Disability certificate', req: false },
                  { t: 'Required accommodations (ramp, scribe, etc.)', req: false },
                ]},
                { n: 9, title: 'Identity marks', items: [
                  { t: 'Visible birth marks, scars, moles (sensitive — keep brief)', req: false },
                  { t: 'Height & weight', req: false },
                ]},
                { n: 10, title: 'Review & enroll', items: [
                  { t: 'Verify every section', req: true },
                  { t: 'Print or save the consent PDF', req: false },
                  { t: 'Submit the form to enroll the student', req: true },
                ]},
              ].map((mod) => (
                <div key={mod.n} style={{ marginBottom: 14, border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 14px', background: '#fafafa' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ display: 'inline-flex', width: 24, height: 24, borderRadius: '50%', background: '#ede9fe', color: '#6c3ce1', fontSize: 12, fontWeight: 700, alignItems: 'center', justifyContent: 'center' }}>{mod.n}</span>
                    <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#111827' }}>{mod.title}</h4>
                  </div>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {mod.items.map((it, i) => (
                      <li key={i} style={{ padding: '4px 0', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#374151' }}>
                        <span style={{ color: it.req ? '#dc2626' : '#9ca3af', fontWeight: 700, lineHeight: 1.4, flexShrink: 0 }}>{it.req ? '*' : '·'}</span>
                        <span>{it.t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div style={{ padding: '14px 26px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 10, background: '#f9fafb', borderRadius: '0 0 14px 14px' }}>
              <button type="button" onClick={() => {
                void (async () => {
                // Header image comes from Settings > Document Branding — the same
                // central source every other print/PDF feature in the app uses.
                let headerImgTag = '';
                let schoolName = 'School';
                try {
                  const [imgRes, info] = await Promise.all([
                    apiRequestWithRefreshResponse('/api/v1/settings/document-branding/header-image/'),
                    apiRequestWithRefresh<{ name?: string }>('/api/tenancy/my-school-info/').catch(() => null),
                  ]);
                  if (info?.name) schoolName = info.name;
                  if (imgRes.ok) {
                    const blob = await imgRes.blob();
                    const dataUrl = await new Promise<string>((resolve, reject) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(reader.result as string);
                      reader.onerror = reject;
                      reader.readAsDataURL(blob);
                    });
                    headerImgTag = `<img src="${dataUrl}" alt="School header" style="display:block;width:100%;max-height:90px;object-fit:contain;object-position:left center;margin-bottom:10px" />`;
                  }
                } catch { /* header image is optional — checklist still prints without it */ }
                const modules = [
                  { n: 1, title: 'Student identity', items: [{ t: 'Full legal name (first, last)', req: true },{ t: 'Date of birth (must match age band of class)', req: true },{ t: 'Gender', req: true },{ t: 'Recent photo (square JPG/PNG, ≥400×400)', req: false },{ t: 'Blood group', req: false },{ t: 'Mother tongue, religion, nationality', req: false }]},
                  { n: 2, title: 'Academic placement', items: [{ t: 'Academic year', req: true },{ t: 'Class & section', req: true },{ t: 'House (auto-suggested by AI)', req: false },{ t: 'Roll number (auto if blank)', req: false },{ t: 'Admission type, previous school name', req: false }]},
                  { n: 3, title: 'Contact & address', items: [{ t: 'Mobile number (10-digit)', req: true },{ t: 'Address line, pincode (auto-fills city/state)', req: true },{ t: 'Email address', req: false },{ t: 'Landmark, means of transport', req: false }]},
                  { n: 4, title: 'Family & guardians', items: [{ t: 'Guardian 1: name, relationship, mobile', req: true },{ t: 'Guardian 1: occupation, email', req: false },{ t: 'Additional guardians (mother/father/other)', req: false },{ t: 'Sibling already in school (for linking)', req: false },{ t: 'Friends/family emergency contacts', req: false }]},
                  { n: 5, title: 'Government identity', items: [{ t: "Aadhaar number (12-digit) — student's", req: false },{ t: 'Aadhaar of guardian (if student doesn\'t have)', req: false },{ t: 'Birth certificate number', req: false },{ t: 'Caste / category certificate (if applicable)', req: false },{ t: 'PAN of guardian (for fee receipts > ₹2L)', req: false }]},
                  { n: 6, title: 'Documents to upload', items: [{ t: 'Signed parent/guardian consent form', req: true },{ t: 'Birth certificate scan', req: false },{ t: 'Aadhaar scan (student / guardian)', req: false },{ t: 'Previous school TC / report card / mark sheets', req: false },{ t: 'Caste / income certificate (if applicable)', req: false },{ t: 'Custom documents (give a name + short note)', req: false }]},
                  { n: 7, title: 'Medical & emergency', items: [{ t: 'Emergency contact name & phone', req: true },{ t: 'Known medical conditions (asthma, diabetes…)', req: false },{ t: 'Allergies (food, medication, environment)', req: false },{ t: 'Vaccination history / records', req: false },{ t: 'Family doctor name & phone', req: false }]},
                  { n: 8, title: 'Specially abled (if applicable)', items: [{ t: 'Type of need (visual, hearing, learning…)', req: false },{ t: 'Disability certificate', req: false },{ t: 'Required accommodations (ramp, scribe, etc.)', req: false }]},
                  { n: 9, title: 'Identity marks', items: [{ t: 'Visible birth marks, scars, moles (sensitive — keep brief)', req: false },{ t: 'Height & weight', req: false }]},
                  { n: 10, title: 'Review & enroll', items: [{ t: 'Verify every section', req: true },{ t: 'Print or save the consent PDF', req: false },{ t: 'Submit the form to enroll the student', req: true }]},
                ];
                const rows = modules.map(m => `
                  <div class="mod">
                    <div class="mod-head"><span class="num">${m.n}</span><strong>${m.title}</strong></div>
                    <ul>${m.items.map(it => `<li><span class="${it.req ? 'req' : 'opt'}">${it.req ? '★' : '○'}</span>${it.t}</li>`).join('')}</ul>
                  </div>`).join('');
                const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>Enrollment Checklist</title>
                <style>
                  *{box-sizing:border-box;margin:0;padding:0}
                  body{font-family:'Segoe UI',Arial,sans-serif;font-size:12px;color:#111;padding:24px}
                  h1{font-size:17px;font-weight:800;color:#1a0540;margin-bottom:4px}
                  .sub{font-size:11px;color:#6b7280;margin-bottom:16px}
                  .school-bar{font-size:11.5px;color:#374151;padding:6px 10px;background:#f8f7ff;border-radius:6px;border:1px solid #e5e7eb;margin:6px 0 12px}
                  .legend{font-size:11px;color:#374151;margin-bottom:14px;padding:8px 12px;background:#fef9c3;border-radius:6px;border:1px solid #fde047}
                  .legend .req{color:#dc2626;font-weight:700} .legend .opt{color:#9ca3af}
                  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
                  .mod{border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;break-inside:avoid}
                  .mod-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
                  .num{display:inline-flex;width:20px;height:20px;border-radius:50%;background:#ede9fe;color:#6c3ce1;font-size:11px;font-weight:800;align-items:center;justify-content:center;flex-shrink:0}
                  .mod-head strong{font-size:12.5px;color:#111827}
                  ul{list-style:none;padding:0;margin:0}
                  li{display:flex;align-items:flex-start;gap:6px;padding:3px 0;font-size:11.5px;color:#374151;border-bottom:1px solid #f3f4f6;line-height:1.4}
                  li:last-child{border-bottom:none}
                  .req{color:#dc2626;font-weight:700;flex-shrink:0;margin-top:1px}
                  .opt{color:#9ca3af;flex-shrink:0;margin-top:1px}
                  .footer{margin-top:18px;font-size:10px;color:#9ca3af;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px}
                  @media print{body{padding:10px}.grid{grid-template-columns:1fr 1fr}}
                </style></head><body>
                ${headerImgTag}
                <h1>📋 What you'll need to enroll a student</h1>
                <p class="sub">Share with parents before the admission appointment. ★ = required to enroll</p>
                <div class="legend"><span class="req">★ Required</span> &nbsp;·&nbsp; <span class="opt">○ Optional / bring if available</span></div>
                <div class="grid">${rows}</div>
                <div class="footer">${schoolName} &nbsp;·&nbsp; Enrollment Checklist &nbsp;·&nbsp; Printed ${new Date().toLocaleDateString('en-IN', {day:'2-digit',month:'short',year:'numeric'})}</div>
                <script>window.onload=()=>{window.print()}</script>
                </body></html>`;
                const w = window.open('', '_blank', 'width=800,height=700');
                if (w) { w.document.write(html); w.document.close(); }
                })();
              }} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#374151' }}>🖨 Print checklist</button>
              <button type="button" onClick={() => setInfoChecklistOpen(false)} style={{ padding: '8px 18px', background: '#6c3ce1', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Got it, let&apos;s start</button>
            </div>
          </div>
        </div>
      )}

      {photoPreviewOpen && photo ? (
        <div role="dialog" aria-modal="true" aria-label="Student photo preview" onClick={() => setPhotoPreviewOpen(false)} className="photo-preview-overlay">
          <div onClick={(event) => event.stopPropagation()} className="photo-preview-card">
            <button type="button" onClick={() => setPhotoPreviewOpen(false)} aria-label="Close photo preview" className="photo-preview-close">
              X
            </button>
            <img src={photoDisplayUrl} alt="Student full preview" className="photo-preview-image" />
          </div>
        </div>
      ) : null}

      {cameraOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Capture student photo" onClick={closeStudentCamera} className="camera-overlay">
          <div className="camera-card" onClick={(event) => event.stopPropagation()}>
            <div className="camera-head">
              <div>
                <h3>Take photo</h3>
                <p>Use your camera to capture the student photo.</p>
              </div>
              <button type="button" className="camera-close" onClick={closeStudentCamera} aria-label="Close camera">X</button>
            </div>
            <div className="camera-body">
              {cameraError ? <p className="camera-error">{cameraError}</p> : null}
              {capturedPhotoPreviewUrl ? (
                <img src={capturedPhotoPreviewUrl} alt="Captured student preview" className="camera-preview-image" />
              ) : (
                <video ref={cameraVideoRef} className="camera-video" autoPlay playsInline muted />
              )}
            </div>
            <div className="camera-actions">
              {capturedPhotoPreviewUrl ? (
                <>
                  <button type="button" className="btn-upload-file" onClick={retakeCapturedPhoto} disabled={photoUploading}>Retake</button>
                  <button type="button" className="btn-take-photo" onClick={() => void applyCapturedPhoto()} disabled={photoUploading}>Use photo</button>
                </>
              ) : (
                <>
                  <button type="button" className="btn-take-photo" onClick={captureStudentPhoto} disabled={photoUploading}>Capture</button>
                  <button type="button" className="btn-upload-file" onClick={closeStudentCamera}>Cancel</button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {noSectionModalOpen && (
        <div 
          onClick={() => setNoSectionModalOpen(false)} 
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()} 
            role="dialog" 
            aria-modal="true" 
            aria-labelledby="no-section-title"
            style={{
              background: '#fff',
              borderRadius: 16,
              maxWidth: 500,
              width: '90%',
              padding: 0,
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
            }}
          >
            <div style={{ padding: '24px 28px', borderBottom: '1px solid #e5e7eb' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                <div style={{ 
                  width: 48, 
                  height: 48, 
                  borderRadius: '50%', 
                  background: '#fef3c7', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                </div>
                <div style={{ flex: 1 }}>
                  <h3 id="no-section-title" style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700, color: '#111827' }}>
                    No Sections Found
                  </h3>
                  <p style={{ margin: 0, fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
                    The class you selected has no sections set up yet. What would you like to do?
                  </p>
                </div>
              </div>
            </div>
            <div style={{ padding: '20px 28px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button
                type="button"
                onClick={() => {
                  setNoSectionModalOpen(false);
                  if (typeof window !== 'undefined') {
                    window.location.href = '/settings/sections';
                  }
                }}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  background: '#6c3ce1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ flex: 1 }}>Create Sections</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setSectionId("");
                  setSectionNotRequired(true);
                  setNoSectionModalOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  background: '#f3f4f6',
                  color: '#374151',
                  border: '1px solid #d1d5db',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span style={{ flex: 1 }}>Proceed Without Section</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setClassId("");
                  setSections([]);
                  setSectionId("");
                  setSectionNotRequired(false);
                  setNoSectionModalOpen(false);
                }}
                style={{
                  width: '100%',
                  padding: '12px 20px',
                  background: '#fff',
                  color: '#6b7280',
                  border: '1px solid #d1d5db',
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                Select Different Class
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage ? (
        <div
          className={toastType === "success" ? "save-toast save-toast-success" : "save-toast save-toast-error"}
          role="status"
          aria-live="polite"
          title="Click to dismiss"
          onClick={() => { setToastMessage(""); if (toastTimerRef.current) { window.clearTimeout(toastTimerRef.current); toastTimerRef.current = null; } }}
          style={{ cursor: "pointer" }}
        >
          {toastMessage}
          <span style={{ marginLeft: 10, opacity: 0.6, fontSize: 12, fontWeight: 700 }}>✕</span>
        </div>
      ) : null}

      {/* Hidden input + lightweight preview modal for "Upload signed" — bypasses ConsentForm so user sees only the file picker, then a focused preview screen */}
      <input
        ref={signedUploadInputRef}
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 10 * 1024 * 1024) {
            setSignedUploadError('File is larger than 10 MB. Please upload a smaller scan.');
            setSignedUploadStatus('error');
            setSignedUploadOpen(true);
            return;
          }
          if (signedUploadPreviewUrl) URL.revokeObjectURL(signedUploadPreviewUrl);
          const url = URL.createObjectURL(file);
          setSignedUploadFile(file);
          setSignedUploadPreviewUrl(url);
          setSignedUploadStatus('idle');
          setSignedUploadError('');
          setSignedUploadOpen(true);
        }}
      />

      {signedUploadOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Preview signed consent copy"
          onClick={() => { /* click on backdrop closes */
            setSignedUploadOpen(false);
            if (signedUploadPreviewUrl) { URL.revokeObjectURL(signedUploadPreviewUrl); }
            setSignedUploadPreviewUrl('');
            setSignedUploadFile(null);
            setSignedUploadStatus('idle');
            setSignedUploadError('');
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1200,
            background: 'rgba(15, 23, 42, 0.55)', backdropFilter: 'blur(2px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(880px, 100%)', maxHeight: '90vh',
              background: '#fff', borderRadius: 12, boxShadow: '0 24px 60px rgba(2, 6, 23, 0.35)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: '1px solid #e5e7eb' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>Preview signed consent copy</div>
                <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{signedUploadFile?.name || ''}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSignedUploadOpen(false);
                  if (signedUploadPreviewUrl) URL.revokeObjectURL(signedUploadPreviewUrl);
                  setSignedUploadPreviewUrl('');
                  setSignedUploadFile(null);
                  setSignedUploadStatus('idle');
                  setSignedUploadError('');
                }}
                style={{ background: 'transparent', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#334155' }}
              >Close</button>
            </div>

            <div style={{ flex: 1, overflow: 'auto', background: '#f1f5f9', padding: 16 }}>
              {signedUploadFile && signedUploadPreviewUrl ? (
                signedUploadFile.type === 'application/pdf' ? (
                  <iframe src={signedUploadPreviewUrl} title="Signed copy preview" style={{ width: '100%', height: '70vh', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
                ) : (
                  <img src={signedUploadPreviewUrl} alt="Signed copy preview" style={{ display: 'block', maxWidth: '100%', maxHeight: '70vh', margin: '0 auto', border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }} />
                )
              ) : (
                <div style={{ padding: 40, textAlign: 'center', color: '#64748b', fontSize: 13 }}>No file selected.</div>
              )}
            </div>

            {signedUploadStatus === 'error' && (
              <div style={{ padding: '10px 20px', background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>
                ⚠ {signedUploadError}
              </div>
            )}
            {signedUploadStatus === 'done' && (
              <div style={{ padding: '10px 20px', background: '#ecfdf5', borderTop: '1px solid #a7f3d0', color: '#047857', fontSize: 12 }}>
                ✓ Signed copy uploaded and saved to the student record.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: '1px solid #e5e7eb', background: '#fafafa' }}>
              <button
                type="button"
                onClick={() => signedUploadInputRef.current?.click()}
                disabled={signedUploadStatus === 'uploading'}
                style={{ background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 14px', fontSize: 13, color: '#334155', cursor: 'pointer' }}
              >Choose different file</button>
              <button
                type="button"
                disabled={!signedUploadFile || signedUploadStatus === 'uploading' || signedUploadStatus === 'done'}
                onClick={async () => {
                  if (!signedUploadFile) return;
                  if (!studentId) {
                    setSignedUploadError('Please save / enroll the student first, then upload the signed copy.');
                    setSignedUploadStatus('error');
                    return;
                  }
                  setSignedUploadStatus('uploading');
                  setSignedUploadError('');
                  try {
                    const fd = new FormData();
                    fd.append('student_id', String(studentId));
                    fd.append('document_type', 'consent_form');
                    fd.append('title', `Signed Consent Form — ${firstName} ${lastName}`.trim());
                    fd.append('file', signedUploadFile);
                    const res = await fetch('/api/students/documents/upload_document/', {
                      method: 'POST', body: fd, credentials: 'include',
                    });
                    if (!res.ok) {
                      const errBody = await res.json().catch(() => ({}));
                      throw new Error((errBody as Record<string,string>).error || `Upload failed (${res.status})`);
                    }
                    setSignedUploadStatus('done');
                    setToastType('success');
                    setToastMessage('Signed consent copy uploaded successfully.');
                    setTimeout(() => setToastMessage(''), 4000);
                  } catch (err: unknown) {
                    setSignedUploadError(err instanceof Error ? err.message : 'Upload failed. Please try again.');
                    setSignedUploadStatus('error');
                  }
                }}
                style={{
                  background: signedUploadStatus === 'done' ? '#10b981' : '#7c3aed',
                  border: 'none', color: '#fff', borderRadius: 8, padding: '8px 18px',
                  fontSize: 13, fontWeight: 600,
                  cursor: (!signedUploadFile || signedUploadStatus === 'uploading' || signedUploadStatus === 'done') ? 'not-allowed' : 'pointer',
                  opacity: (!signedUploadFile || signedUploadStatus === 'uploading') ? 0.6 : 1,
                }}
              >
                {signedUploadStatus === 'uploading' ? 'Uploading…' : signedUploadStatus === 'done' ? '✓ Uploaded' : 'Submit signed copy'}
              </button>
            </div>
          </div>
        </div>
      )}

      {consentOpen && (
        <ConsentForm
          onClose={() => { setConsentOpen(false); setConsentOpenWithSettings(false); setConsentInitialAction(null); }}
          openWithSettings={consentOpenWithSettings}
          initialAction={consentInitialAction}
          student={{
            firstName,
            lastName,
            admissionNo,
            dateOfBirth,
            classId,
            sectionId,
            photo,
            className: orderedClasses.find((c) => String(c.id) === classId)?.name ?? "",
            sectionName: sections.find((s) => String(s.id) === sectionId)?.name ?? "",
            gender,
            bloodGroup,
            motherTongue,
            religion,
            nationality,
            statusValue,
            academicYearName: validAcademicYears.find(y => String(y.id) === academicYearId)?.name,
            admissionType,
            categoryName: validCategories.find((c) => String(c.id) === categoryId)?.name,
            streamId,
            previousSchoolName,
            phone,
            email,
            addressLine,
            city,
            district,
            stateName,
            pincode,
            guardians: guardianDrafts.map(g => ({ full_name: g.fullName, relation: g.relation, phone: g.phone, email: g.email, occupation: g.occupation, isPrimary: g.isPrimary })),
            pen,
            abcId,
            documents: {
              birth_certificate: { status: documents.birth_certificate.status, fileName: documents.birth_certificate.fileName },
              aadhaar_card: { status: documents.aadhaar_card.status, fileName: documents.aadhaar_card.fileName },
              medical_information: { status: documents.medical_information.status, fileName: documents.medical_information.fileName },
              transfer_certificate: { status: documents.transfer_certificate.status, fileName: documents.transfer_certificate.fileName },
              caste_certificate: { status: documents.caste_certificate.status, fileName: documents.caste_certificate.fileName },
              udid_card: { status: documents.udid_card.status, fileName: documents.udid_card.fileName },
            },
            consentChecked,
            heightCm,
            weightKg,
            vision,
            medicalConditions,
            allergies,
            currentMedications,
            treatingDoctor,
            checkedVaccinations,
            emergencyName,
            emergencyPhone,
            isPwD,
            disabilityTypes,
            disabilityPercent,
            udid,
            accommodations,
            identityMarks,
            eyeColour,
            hairColour,
            complexion,
            build,
          }}
          onOcrApply={(results) => {
            if (results.firstName) setFirstName(results.firstName.charAt(0).toUpperCase() + results.firstName.slice(1).toLowerCase());
            if (results.lastName) setLastName(results.lastName.charAt(0).toUpperCase() + results.lastName.slice(1).toLowerCase());
            if (results.dateOfBirth) {
              const normalizedDob = normalizeExtractedDob(results.dateOfBirth);
              if (normalizedDob) setDateOfBirth(normalizedDob);
            }
            if (results.gender) setGender(normalizeExtractedGender(results.gender));
            if (results.bloodGroup) setBloodGroup(results.bloodGroup.toUpperCase());
            if (results.religion) setReligion(results.religion.charAt(0).toUpperCase() + results.religion.slice(1).toLowerCase());
            if (results.nationality) setNationality(results.nationality.charAt(0).toUpperCase() + results.nationality.slice(1).toLowerCase());
            if (results.motherTongue) setMotherTongue(results.motherTongue.charAt(0).toUpperCase() + results.motherTongue.slice(1).toLowerCase());
            if (results.aadhaarNo) setAadhaarNo(results.aadhaarNo.replace(/\s/g, ''));
            if (results.phone) setPhone(results.phone.replace(/\s/g, ''));
            if (results.email) setEmail(results.email.toLowerCase().replace(/\s/g, ''));
            if (results.addressLine) setAddressLine(results.addressLine);
            if (results.city) setCity(results.city.charAt(0).toUpperCase() + results.city.slice(1).toLowerCase());
            if (results.district) setDistrict(results.district.charAt(0).toUpperCase() + results.district.slice(1).toLowerCase());
            if (results.stateName) setStateName(results.stateName.charAt(0).toUpperCase() + results.stateName.slice(1).toLowerCase());
            if (results.pincode) setPincode(results.pincode.replace(/\s/g, ''));
            // Guardian: update first guardian draft if exists, else create
            if (results.guardianName || results.guardianPhone || results.guardianEmail) {
              setGuardianDrafts(prev => {
                const updated = [...prev];
                if (updated.length === 0) {
                  updated.push(makeEmptyGuardianDraft(true));
                }
                const g = { ...updated[0] };
                if (results.guardianName) g.fullName = results.guardianName;
                if (results.guardianPhone) g.phone = results.guardianPhone.replace(/\s/g, '');
                if (results.guardianEmail) g.email = results.guardianEmail.toLowerCase().replace(/\s/g, '');
                if (results.guardianRelation) g.relation = results.guardianRelation;
                if (results.guardianOccupation) g.occupation = results.guardianOccupation;
                updated[0] = g;
                return updated;
              });
            }
          }}
        />
      )}

      {scanFillOpen && (
        <ScanFillModal
          fieldGroups={STUDENT_FIELD_GROUPS}
          documentLabel="admission form"
          onClose={() => setScanFillOpen(false)}
          onApply={(results) => {
            if (results.firstName) setFirstName(results.firstName.charAt(0).toUpperCase() + results.firstName.slice(1).toLowerCase());
            if (results.lastName) setLastName(results.lastName.charAt(0).toUpperCase() + results.lastName.slice(1).toLowerCase());
            if (results.dateOfBirth) {
              const normalizedDob = normalizeExtractedDob(results.dateOfBirth);
              if (normalizedDob) setDateOfBirth(normalizedDob);
            }
            if (results.gender) setGender(normalizeExtractedGender(results.gender));
            if (results.bloodGroup) setBloodGroup(results.bloodGroup.toUpperCase());
            if (results.religion) setReligion(results.religion.charAt(0).toUpperCase() + results.religion.slice(1).toLowerCase());
            if (results.nationality) setNationality(results.nationality.charAt(0).toUpperCase() + results.nationality.slice(1).toLowerCase());
            if (results.motherTongue) setMotherTongue(results.motherTongue.charAt(0).toUpperCase() + results.motherTongue.slice(1).toLowerCase());
            if (results.aadhaarNo) setAadhaarNo(results.aadhaarNo.replace(/\s/g, ''));
            if (results.phone) setPhone(results.phone.replace(/\s/g, ''));
            if (results.email) setEmail(results.email.toLowerCase().replace(/\s/g, ''));
            if (results.addressLine) setAddressLine(results.addressLine);
            if (results.city) setCity(results.city.charAt(0).toUpperCase() + results.city.slice(1).toLowerCase());
            if (results.district) setDistrict(results.district.charAt(0).toUpperCase() + results.district.slice(1).toLowerCase());
            if (results.stateName) setStateName(results.stateName.charAt(0).toUpperCase() + results.stateName.slice(1).toLowerCase());
            if (results.pincode) setPincode(results.pincode.replace(/\s/g, ''));
            if (results.guardianName || results.guardianPhone || results.guardianEmail) {
              setGuardianDrafts(prev => {
                const updated = [...prev];
                if (updated.length === 0) updated.push(makeEmptyGuardianDraft(true));
                const g = { ...updated[0] };
                if (results.guardianName) g.fullName = results.guardianName;
                if (results.guardianPhone) g.phone = results.guardianPhone.replace(/\s/g, '');
                if (results.guardianEmail) g.email = results.guardianEmail.toLowerCase().replace(/\s/g, '');
                if (results.guardianRelation) g.relation = results.guardianRelation;
                if (results.guardianOccupation) g.occupation = results.guardianOccupation;
                updated[0] = g;
                return updated;
              });
            }
            setScanFillOpen(false);
          }}
        />
      )}

      {draftsOpen && (
        <div className="ai-overlay" onClick={() => setDraftsOpen(false)}>
          <div className="ai-modal ai-modal-drafts" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="drafts-title">
            <div className="ai-modal-head">
              <div className="ai-modal-head-left">
                <div className="ai-modal-icon ai-modal-icon-drafts">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                </div>
                <div>
                  <h3 id="drafts-title" className="ai-modal-title">Saved drafts</h3>
                  <p className="ai-modal-sub">Pick up where you left off — your work is safe on this device.</p>
                </div>
              </div>
              <button type="button" className="ai-close" onClick={() => setDraftsOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>

            {(() => {
              let drafts: Array<{id:string; savedAt:number; label:string; admissionNo:string; firstName:string; lastName:string; classId:string; data:Record<string,unknown>}> = [];
              try {
                const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STUDENT_DRAFTS_KEY) : null;
                if (raw) drafts = JSON.parse(raw);
              } catch { drafts = []; }

              if (drafts.length === 0) {
                return (
                  <div className="ai-empty">
                    <div className="ai-empty-illustration" aria-hidden="true">
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>
                    </div>
                    <h4 className="ai-empty-title">No drafts yet</h4>
                    <p className="ai-empty-text">Start filling the form and click <strong>Save draft</strong> in the footer — your drafts are stored on this device.</p>
                    <button type="button" className="ai-cta-btn" onClick={() => setDraftsOpen(false)}>Got it</button>
                  </div>
                );
              }

              const computeDraftStats = (data: Record<string, unknown>) => {
                // Same computeCompletionPercent used by the footer bar and AI Assist
                // modal — this used to derive % from how far the sidebar had been
                // clicked through (and cap it at 99% "until finalized"), so a draft
                // that was actually field-complete still showed 99% here while the
                // footer showed 100% for the same data (QA #8).
                const guardianDraftsArr = Array.isArray(data.guardianDrafts) ? data.guardianDrafts as Array<Record<string, unknown>> : [];
                const pct = computeCompletionPercent({
                  firstName: data.firstName, lastName: data.lastName, dateOfBirth: data.dateOfBirth,
                  gender: data.gender, classId: data.classId, sectionId: data.sectionId,
                  phone: data.phone, addressLine: data.addressLine, pincode: data.pincode,
                  guardianFullName: guardianDraftsArr[0]?.fullName,
                  guardianPhone: guardianDraftsArr[0]?.phone,
                  consentChecked: data.consentChecked,
                });
                const missing: string[] = [];
                if (!data.firstName || !data.lastName) missing.push('Name');
                if (!data.dateOfBirth) missing.push('DOB');
                if (!data.classId) missing.push('Class');
                if (!data.phone) missing.push('Phone');
                if (!Array.isArray(data.guardianDrafts) || (data.guardianDrafts as unknown[]).length === 0) missing.push('Guardian');
                return { pct, missing };
              };

              const filtered = drafts
                .filter(d => {
                  if (!draftSearch.trim()) return true;
                  const q = draftSearch.toLowerCase();
                  return (
                    (d.firstName || '').toLowerCase().includes(q) ||
                    (d.lastName || '').toLowerCase().includes(q) ||
                    (d.admissionNo || '').toLowerCase().includes(q)
                  );
                })
                .map(d => ({ ...d, stats: computeDraftStats(d.data) }));

              filtered.sort((a, b) => {
                if (draftSort === 'recent') return b.savedAt - a.savedAt;
                if (draftSort === 'oldest') return a.savedAt - b.savedAt;
                return b.stats.pct - a.stats.pct;
              });

              const DRAFTS_PER_PAGE = 15;
              const totalPages = Math.max(1, Math.ceil(filtered.length / DRAFTS_PER_PAGE));
              const safePage = Math.min(draftsPage, totalPages);
              const pageSlice = filtered.slice((safePage - 1) * DRAFTS_PER_PAGE, safePage * DRAFTS_PER_PAGE);

              return (
                <>
                  <div className="ai-toolbar">
                    <div className="ai-search">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                      <input type="text" placeholder="Search by name or admission no…" value={draftSearch} onChange={e => { setDraftSearch(e.target.value); setDraftsPage(1); }} />
                    </div>
                    <div className="ai-sort">
                      {(['recent', 'oldest', 'progress'] as const).map(s => (
                        <button key={s} type="button" className={draftSort === s ? 'ai-sort-pill active' : 'ai-sort-pill'} onClick={() => { setDraftSort(s); setDraftsPage(1); }}>
                          {s === 'recent' ? 'Recent' : s === 'oldest' ? 'Oldest' : 'Most complete'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="ai-modal-body">
                    {filtered.length === 0 ? (
                      <p className="ai-no-match">No drafts match &quot;{draftSearch}&quot;.</p>
                    ) : pageSlice.map(draft => {
                      const diffMs = Math.max(0, Date.now() - draft.savedAt);
                      const mins = Math.floor(diffMs / 60000);
                      const timeAgo = mins < 1 ? 'just now' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.floor(mins/60)} hr ago` : `${Math.floor(mins/1440)} day(s) ago`;
                      const name = [draft.firstName, draft.lastName].filter(Boolean).join(' ') || 'Unnamed draft';
                      const initials = (draft.firstName?.[0] || '?').toUpperCase() + (draft.lastName?.[0] || '').toUpperCase();
                      const { pct, missing } = draft.stats;
                      const tone = pct >= 78 ? 'high' : pct >= 44 ? 'mid' : 'low';
                      const smartTip = pct >= 89
                        ? 'Almost there — just the final review left!'
                        : pct >= 55
                        ? `Good progress. Still missing: ${missing.slice(0, 2).join(', ')}.`
                        : missing.length > 0
                        ? `Getting started — still need: ${missing.slice(0, 2).join(', ')}.`
                        : 'Just getting started — load to continue.';
                      return (
                        <div key={draft.id} className="ai-draft-card">
                          <div className="ai-draft-avatar" data-tone={tone}>{initials}</div>
                          <div className="ai-draft-body">
                            <div className="ai-draft-row">
                              <span className="ai-draft-name">{name}</span>
                              {draft.admissionNo && <span className="ai-draft-chip">#{draft.admissionNo}</span>}
                            </div>
                            <div className="ai-draft-meta">
                              <span>Saved {timeAgo}</span>
                              <span className="ai-dot" />
                              <span className={`ai-pct ai-pct-${tone}`}>{pct}% complete</span>
                            </div>
                            <div className="ai-progress-track">
                              <div className={`ai-progress-bar ai-progress-${tone}`} style={{ width: `${pct}%` }} />
                            </div>
                            <p className="ai-draft-tip">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.9 5.8L20 9.7l-5 3.6L16.5 19 12 15.7 7.5 19 9 13.3l-5-3.6 6.1-1.9L12 2z"/></svg>
                              {smartTip}
                            </p>
                          </div>
                          <div className="ai-draft-actions">
                            <button type="button" className="ai-btn-primary" onClick={() => {
                              restoreDraftFromObject(draft.data);
                              setDraftsOpen(false);
                              showToast(`Loaded "${name}". Continue from where you stopped.`, 'success', 4000);
                            }}>Resume</button>
                            <button type="button" className="ai-btn-ghost-danger" onClick={() => {
                              if (!confirm(`Delete draft "${name}"?`)) return;
                              try {
                                const raw = window.localStorage.getItem(STUDENT_DRAFTS_KEY);
                                let arr: typeof drafts = raw ? JSON.parse(raw) : [];
                                arr = arr.filter(d => d.id !== draft.id);
                                window.localStorage.setItem(STUDENT_DRAFTS_KEY, JSON.stringify(arr));
                              } catch { /* ignore */ }
                              setDraftsOpen(false);
                              setTimeout(() => setDraftsOpen(true), 0);
                            }} aria-label={`Delete draft ${name}`}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {totalPages > 1 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 20px', borderTop: '1px solid #f3f4f6' }}>
                      <button type="button" disabled={safePage <= 1} onClick={() => setDraftsPage(p => Math.max(1, p - 1))} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: safePage <= 1 ? '#f9fafb' : '#fff', cursor: safePage <= 1 ? 'default' : 'pointer', color: safePage <= 1 ? '#d1d5db' : '#374151', fontSize: 13 }}>← Prev</button>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>Page {safePage} of {totalPages} · {filtered.length} draft{filtered.length !== 1 ? 's' : ''}</span>
                      <button type="button" disabled={safePage >= totalPages} onClick={() => setDraftsPage(p => Math.min(totalPages, p + 1))} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e5e7eb', background: safePage >= totalPages ? '#f9fafb' : '#fff', cursor: safePage >= totalPages ? 'default' : 'pointer', color: safePage >= totalPages ? '#d1d5db' : '#374151', fontSize: 13 }}>Next →</button>
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {aiOpen && (() => {
        // Reuses the exact same value as the footer progress bar (computeCompletionPercent)
        // instead of the step-count formula this used to compute independently — the two
        // disagreeing (e.g. 100% footer vs 60% here for the same record) was QA finding #8.
        const overallPct = footerProgressPercent;

        const tips: Array<{ icon: string; title: string; body: string; tone: 'info' | 'warn' | 'success'; action?: { label: string; run: () => void } }> = [];

        if (!firstName.trim() || !lastName.trim() || !dateOfBirth) {
          tips.push({ icon: '👤', tone: 'warn', title: 'Start with the basics', body: 'Identity is the first step — name and date of birth unlock the rest of the form.', action: { label: 'Go to Identity', run: () => { setAiOpen(false); setActiveNavSection('identity'); } } });
        }
        if (phone && !/^\d{10}$/.test(phone.replace(/\D/g, ''))) {
          tips.push({ icon: '📱', tone: 'warn', title: 'Phone number looks off', body: 'Indian phone numbers should be exactly 10 digits. Re-check the contact step.', action: { label: 'Fix contact', run: () => { setAiOpen(false); setActiveNavSection('contact'); } } });
        }
        if (pincode && pincode.length !== 6) {
          tips.push({ icon: '📍', tone: 'warn', title: 'Pincode incomplete', body: 'Indian pincodes are 6 digits. Enter it and we&apos;ll auto-fill city/district/state.', action: { label: 'Fix pincode', run: () => { setAiOpen(false); setActiveNavSection('contact'); } } });
        }
        if (guardianDrafts.length === 0 || !guardianDrafts[0]?.fullName?.trim()) {
          tips.push({ icon: '👨‍👩‍👧', tone: 'warn', title: 'Add a guardian', body: 'At least one guardian (name + phone) is required before you can submit.', action: { label: 'Add guardian', run: () => { setAiOpen(false); setActiveNavSection('guardians'); } } });
        }
        if (overallPct >= 30 && overallPct < 100) {
          tips.push({ icon: '💾', tone: 'info', title: 'Save your progress', body: `You&apos;re ${overallPct}% done. Save a draft so nothing is lost — you can resume anytime from the Drafts panel.`, action: { label: 'Save draft now', run: () => { setAiOpen(false); saveDraftSnapshot(); showToast('Draft saved.', 'success', 3000); } } });
        }
        if (overallPct < 50) {
          tips.push({ icon: '⚡', tone: 'info', title: 'Speed tip — Aadhaar QR scan', body: 'Got the student&apos;s Aadhaar card? Scan the QR to auto-fill name, DOB, gender and address in one go.', });
        }
        if (overallPct === 100) {
          tips.push({ icon: '🎉', tone: 'success', title: "You're ready to submit!", body: 'Every required step is complete. Head to Review to do a final check, then submit.', action: { label: 'Go to Review', run: () => { setAiOpen(false); setActiveNavSection('review'); } } });
        }
        if (tips.length === 0) {
          tips.push({ icon: '✨', tone: 'success', title: "Everything looks great", body: "No issues spotted. Keep going!" });
        }

        return (
          <div className="ai-overlay" onClick={() => setAiOpen(false)}>
            <div className="ai-modal ai-modal-ai" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="ai-title">
              <div className="ai-modal-head ai-modal-head-gradient">
                <div className="ai-modal-head-left">
                  <div className="ai-modal-icon ai-modal-icon-ai">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l1.9 5.8L20 9.7l-5 3.6L16.5 19 12 15.7 7.5 19 9 13.3l-5-3.6 6.1-1.9L12 2z"/></svg>
                  </div>
                  <div>
                    <h3 id="ai-title" className="ai-modal-title ai-modal-title-light">Eskoolia AI Assist <span className="ai-beta-pill">BETA</span></h3>
                    <p className="ai-modal-sub ai-modal-sub-light">Smart tips based on your current form.</p>
                  </div>
                </div>
                <button type="button" className="ai-close ai-close-light" onClick={() => setAiOpen(false)} aria-label="Close">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              </div>

              <div className="ai-summary-card">
                <div className="ai-summary-left">
                  <p className="ai-summary-label">Overall completion</p>
                  <p className="ai-summary-pct">{overallPct}%</p>
                </div>
                <div className="ai-summary-ring" data-pct={overallPct} aria-hidden="true">
                  <svg width="76" height="76" viewBox="0 0 76 76">
                    <circle cx="38" cy="38" r="32" fill="none" stroke="rgba(108,60,225,0.15)" strokeWidth="6" />
                    <circle cx="38" cy="38" r="32" fill="none" stroke="url(#aiGrad)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${(overallPct / 100) * 201} 201`} transform="rotate(-90 38 38)" />
                    <defs>
                      <linearGradient id="aiGrad" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
              </div>

              <div className="ai-modal-body">
                <p className="ai-section-label">SUGGESTIONS FOR YOU</p>
                {tips.map((t, idx) => (
                  <div key={idx} className={`ai-tip ai-tip-${t.tone}`}>
                    <div className="ai-tip-icon">{t.icon}</div>
                    <div className="ai-tip-body">
                      <p className="ai-tip-title">{t.title}</p>
                      <p className="ai-tip-text" dangerouslySetInnerHTML={{ __html: t.body }} />
                    </div>
                    {t.action && (
                      <button type="button" className="ai-tip-action" onClick={t.action.run}>{t.action.label} →</button>
                    )}
                  </div>
                ))}

                <div className="ai-quickbar">
                  <button type="button" className="ai-quick" onClick={() => { setAiOpen(false); saveDraftSnapshot(); showToast('Draft saved.', 'success', 3000); }}>
                    <span>💾</span> Save draft
                  </button>
                  <button type="button" className="ai-quick" onClick={() => { setAiOpen(false); setDraftsOpen(true); }}>
                    <span>📋</span> View drafts
                  </button>
                  <button type="button" className="ai-quick" onClick={() => { setAiOpen(false); setConsentOpenWithSettings(true); setConsentOpen(true); }}>
                    <span>📄</span> Preview PDF
                  </button>
                </div>

                <p className="ai-disclaimer">Tips are generated locally from the data you&apos;ve entered. Nothing is sent to a server.</p>
              </div>
            </div>
          </div>
        );
      })()}

      <style jsx>{`
        /* Root fills the available <main> area AND bleeds through
           .dashboard-main's 18px padding so the footer can span full width. */
        .enroll-page {
          --brand: #6c3ce1;
          --ink: #111827;
          --muted: #6b7280;
          --line: #e5e7eb;
          --bg: #fafafb;
          color: var(--ink);
          height: 100%;
          margin: -18px;
          display: flex;
          flex-direction: column;
          min-width: 0;
          min-height: 0;
        }

        .student-add-panel-wrap form {
          flex: 1;
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: visible;
        }

        /* The only scrollable region on this page. Internal padding restores
           gutters that .enroll-page's negative margin bled out.
           overflow-x: hidden + min-width: 0 prevent children (wide grids,
           long labels) from forcing the container to grow sideways at
           narrow widths. */
        .enroll-scroll {
          flex: 1;
          min-width: 0;
          min-height: 0;
          overflow-y: auto;
          overflow-x: hidden;
          padding: 18px;
          padding-bottom: 32px;
        }

        /* Action bar — lives OUTSIDE .enroll-scroll so it's always visible.
           flex-shrink: 0 keeps it at its natural height; the scroll sibling
           (flex: 1) takes all remaining vertical space. */
        .enroll-footer {
          flex-shrink: 0;
          display: flex;
          flex-wrap: wrap;
          justify-content: space-between;
          align-items: center;
          gap: 12px 24px;
          min-height: 84px;
          background: #ffffff;
          border-top: 1px solid #ececf2;
          padding: 18px 28px;
          box-shadow: 0 -4px 12px rgba(15, 23, 42, 0.05);
          z-index: 40;
        }

        .top-row,
        .page-title-row,
        .scan-banner,
        .banner-error,
        .enroll-body {
          width: 100%;
          max-width: none;
          margin-left: 0;
          margin-right: 0;
        }

        .top-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 0 0 16px;
        }

        .crumbs {
          font-size: 13px;
          color: var(--muted);
          margin: 0;
        }

        .crumb-sep {
          margin: 0 4px;
          color: var(--muted);
        }

        .crumbs a {
          color: var(--muted);
          text-decoration: none;
        }

        .draft-right {
          display: flex;
          align-items: center;
          gap: 10px;
          color: var(--muted);
          font-size: 13px;
        }

        .dot-green {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          transition: background 0.3s;
        }

        @keyframes dot-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .review-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          gap: 12px;
        }

        .avatar-circle {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: var(--brand);
          color: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 13px;
          font-weight: 700;
        }

        .page-title-row {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
          gap: 20px;
          padding: 0;
        }

        .hero-title {
          margin: 0;
          font-size: 40px;
          font-weight: 700;
          font-family: var(--font-playfair-display), Georgia, "Times New Roman", serif;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }

        .title-accent {
          color: var(--brand);
          font-style: italic;
          font-family: var(--font-playfair-display), Georgia, "Times New Roman", serif;
          font-weight: 400;
        }

        .hero-subtitle {
          max-width: 520px;
          color: var(--muted);
          line-height: 1.5;
          margin-top: 8px;
          font-size: 14px;
        }

        .hero-kpi {
          text-align: right;
        }

        .hero-kpi-count {
          font-size: 40px;
          font-weight: 700;
          margin: 0;
        }

        .hero-kpi-label {
          margin: 4px 0 0;
          font-size: 11px;
          letter-spacing: 0.1em;
          color: var(--muted);
          font-weight: 600;
        }

        .scan-banner {
          background: #1a1a2e;
          border-radius: 12px;
          padding: 20px 24px;
          margin: 0 0 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .scan-left {
          display: flex;
          gap: 16px;
          align-items: flex-start;
        }

        .scan-icon-wrap {
          width: 40px;
          height: 40px;
          border-radius: 8px;
          background: rgba(108, 60, 225, 0.8);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
        }

        .scan-title {
          color: #fff;
          font-size: 15px;
          font-weight: 700;
          margin: 0;
        }

        .badge-new {
          margin-left: 8px;
          background: #10b981;
          color: #fff;
          border-radius: 999px;
          padding: 2px 8px;
          font-size: 10px;
          font-weight: 600;
        }

        .scan-copy {
          color: #9ca3af;
          margin: 4px 0 0;
          font-size: 13px;
          line-height: 1.5;
        }

        .scan-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .scan-now {
          border: none;
          background: var(--brand);
          color: #fff;
          border-radius: 8px;
          padding: 10px 20px;
          cursor: pointer;
        }

        .scan-dismiss {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          border: none;
          background: rgba(255, 255, 255, 0.15);
          color: #fff;
          cursor: pointer;
        }

        .banner-error,
        .banner-success {
          width: 100%;
          margin: 0 0 12px;
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 13px;
        }

        .banner-error {
          color: #b91c1c;
          background: #fee2e2;
          border: 1px solid #fecaca;
        }

        .banner-success {
          color: #065f46;
          background: #d1fae5;
          border: 1px solid #a7f3d0;
        }

        .enroll-body {
          display: flex;
          gap: 24px;
          align-items: flex-start;
          overflow: visible;
        }

        .section-nav-wrap {
          --sidebar-stick-top: 10px;
          position: sticky;
          top: var(--sidebar-stick-top);
          width: 280px;
          height: fit-content;
          max-height: calc(100vh - var(--sidebar-stick-top) - 12px);
          flex-shrink: 0;
          align-self: flex-start;
          z-index: 2;
        }

        .section-nav {
          max-height: inherit;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding-right: 4px;
        }

        .section-nav-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }

        .nav-item {
          position: relative;
          margin-bottom: 4px;
        }

        .nav-item-inner {
          width: 100%;
          border: none;
          background: transparent;
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 8px 12px 8px 8px;
          border-radius: 6px;
          cursor: pointer;
          text-align: left;
        }

        .nav-item-inner:hover {
          background: #f3f4f6;
        }

        .nav-bullet {
          width: 24px;
          height: 24px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          background: #f3f4f6;
          color: #9ca3af;
          border: 1px solid #e5e7eb;
        }

        .nav-label {
          font-size: 14px;
          color: #1f2937;
          font-weight: 500;
          line-height: 1.2;
        }

        .nav-text {
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .nav-copy {
          font-size: 12px;
          color: #6b7280;
          line-height: 1.3;
        }

        .nav-item.active::before {
          content: "";
          position: absolute;
          left: 0;
          top: 4px;
          bottom: 4px;
          width: 3px;
          border-radius: 0 2px 2px 0;
          background: var(--brand);
        }

        .nav-item.active .nav-bullet {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }

        .nav-item.active .nav-item-inner {
          background: #f5f3ff;
        }

        .nav-item.active .nav-label {
          color: var(--brand);
          font-weight: 600;
        }

        .nav-item.active .nav-copy {
          color: #6d28d9;
        }

        /* Locked steps: visible labels, but not interactive */
        .nav-item.locked .nav-item-inner {
          cursor: not-allowed;
        }
        .nav-item.locked .nav-item-inner:hover {
          background: transparent;
        }
        .nav-item.locked .nav-bullet {
          background: #f9fafb;
          color: #9ca3af;
          border-color: #e5e7eb;
        }
        .nav-item.locked .nav-label {
          color: #4b5563;
        }
        .nav-item.locked .nav-copy {
          color: #9ca3af;
        }

        .heads-up-card {
          margin-top: 20px;
          background: #ede9fe;
          border-radius: 8px;
          padding: 12px 14px;
        }

        .heads-up-title {
          margin: 0 0 4px;
          font-size: 13px;
          font-weight: 700;
        }

        .heads-up-body {
          margin: 0;
          font-size: 12px;
          color: #6b7280;
          line-height: 1.5;
        }

        .star {
          color: #dc2626;
          font-weight: 700;
        }

        .section-nav-buttons {
          display: flex;
          width: 100%;
          align-items: center;
          justify-content: space-between;
          margin-top: 32px;
          padding-top: 20px;
          border-top: 1px solid var(--line);
          gap: 12px;
        }

        .btn-nav-prev {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 22px;
          border: 1px solid #d1d5db;
          background: #fff;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          color: #374151;
          transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
          white-space: nowrap;
        }

        .btn-nav-prev:hover {
          background: #f3f4f6;
          border-color: #9ca3af;
          box-shadow: 0 1px 3px rgba(0,0,0,0.08);
        }

        .btn-nav-next {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 22px;
          border: 1px solid var(--brand);
          background: var(--brand);
          color: #fff;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          transition: background 0.15s, box-shadow 0.15s, transform 0.15s;
          box-shadow: 0 1px 2px rgba(108, 60, 225, 0.18);
          white-space: nowrap;
        }

        .btn-nav-next:hover {
          background: #5a2fc9;
          border-color: #5a2fc9;
          transform: translateY(-1px);
          box-shadow: 0 4px 10px rgba(108, 60, 225, 0.25);
        }

        .btn-nav-next:active {
          transform: translateY(0);
          box-shadow: 0 1px 2px rgba(108, 60, 225, 0.18);
        }

        .section-content {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .section-card {
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          padding: 24px;
          scroll-margin-top: 108px;
        }

        .section-card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 24px;
        }

        .section-title {
          font-size: 28px;
          margin: 0;
          font-weight: 700;
          font-family: var(--font-playfair-display), Georgia, "Times New Roman", serif;
          letter-spacing: -0.015em;
          line-height: 1.15;
        }

        .section-subtitle {
          margin: 6px 0 0;
          font-size: 14px;
          color: #6b7280;
        }

        .section-counter {
          font-size: 13px;
          color: #9ca3af;
          margin-left: 16px;
          white-space: nowrap;
        }

        .grid-3 {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }

        .grid-2 {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
        }

        .field-wrapper {
          min-width: 0;
        }

        .field-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 500;
          color: #374151;
          margin-bottom: 6px;
        }

        .req {
          color: #dc2626;
          font-weight: 700;
        }

        .field-input,
        .field-select,
        .field-textarea {
          width: 100%;
          min-width: 0;              /* critical: lets inputs shrink inside narrow grid cells */
          max-width: 100%;
          padding: 10px 12px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          font-size: 14px;
          background: #fff;
          box-sizing: border-box;
          appearance: auto;
          -webkit-appearance: menulist;
        }

        /* Icon-only calendar trigger next to the masked DOB text input. Squeezing
           a native <input type="date"> down to 32px doesn't shrink its internal
           "mm/dd/yyyy" placeholder sub-fields below their natural width — with a
           transparent background and no border, that overflowing placeholder text
           had no opaque backing and rendered as ghosted letters bleeding through
           (QA: "DOB calendar background issue showing alphabets"). Hiding the
           text sub-fields entirely and keeping only the picker icon fixes this
           without needing the box to be wide enough to fit real date text.
        */
        .dob-picker-trigger {
          width: 32px;
          height: 100%;
          padding: 0;
          border: none;
          background: #fff;
          cursor: pointer;
          color: transparent;
        }
        .dob-picker-trigger::-webkit-datetime-edit,
        .dob-picker-trigger::-webkit-datetime-edit-fields-wrapper,
        .dob-picker-trigger::-webkit-datetime-edit-text,
        .dob-picker-trigger::-webkit-datetime-edit-month-field,
        .dob-picker-trigger::-webkit-datetime-edit-day-field,
        .dob-picker-trigger::-webkit-datetime-edit-year-field {
          display: none;
        }
        .dob-picker-trigger::-webkit-calendar-picker-indicator {
          opacity: 0.7;
          cursor: pointer;
        }

        .field-input:focus,
        .field-select:focus,
        .field-textarea:focus {
          border-color: var(--brand);
          box-shadow: 0 0 0 3px rgba(108, 60, 225, 0.12);
          outline: none;
        }

        .field-input.error,
        .field-select.error,
        .field-textarea.error {
          border-color: #dc2626;
          background: #fef2f2;
        }

        .help-text {
          font-size: 12px;
          color: #6b7280;
          margin-top: 4px;
        }

        .error-msg {
          font-size: 12px;
          color: #dc2626;
          margin: 4px 0 0;
        }

        .status-info {
          font-size: 12px;
          color: #6b7280;
          margin: 4px 0 0;
        }

        .badge {
          font-size: 10px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 999px;
        }

        .badge-optional,
        .badge-assigned-later {
          background: #f3f4f6;
          color: #6b7280;
        }

        .badge-recommended {
          background: #ecfdf5;
          color: #065f46;
        }

        .badge-required-doc {
          background: #fef3c7;
          color: #92400e;
        }

        .field-inline-action {
          position: relative;
        }

        .edit-btn {
          position: absolute;
          right: 10px;
          top: 34px;
          border: none;
          background: transparent;
          color: var(--brand);
          cursor: pointer;
          font-size: 12px;
        }

        .photo-upload-block {
          display: flex;
          align-items: flex-start;
          gap: 24px;
          margin-bottom: 24px;
        }

        .photo-circle {
          width: 128px;
          height: 128px;
          border-radius: 50%;
          border: 2px dashed #d1d5db;
          background: #fafafa;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          padding: 0;
        }

        .photo-circle.has-photo {
          border: none;
          overflow: hidden;
        }

        .photo-circle img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .camera-icon {
          font-size: 26px;
          color: #9ca3af;
        }

        .photo-label {
          font-size: 9px;
          letter-spacing: 0.12em;
          color: #9ca3af;
          margin-top: 6px;
        }

        .photo-title {
          margin: 0 0 4px;
          font-size: 14px;
          font-weight: 600;
        }

        .photo-desc {
          margin: 0 0 12px;
          font-size: 12px;
          color: #6b7280;
          line-height: 1.4;
        }

        .photo-actions {
          display: flex;
          gap: 12px;
        }

        .btn-upload-file {
          padding: 7px 14px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          background: #fff;
          cursor: pointer;
          text-decoration: none;
          color: #374151;
          font-size: 13px;
        }

        .btn-take-photo {
          border: none;
          background: none;
          color: var(--brand);
          text-decoration: underline;
          cursor: pointer;
          font-size: 13px;
        }

        .status-toggle {
          display: inline-flex;
          border: 1.5px solid #d1d5db;
          border-radius: 10px;
          overflow: hidden;
          background: #f3f4f6;
        }

        .toggle-pill {
          flex: 1;
          border: none;
          background: transparent;
          color: #6b7280;
          padding: 9px 24px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.18s, color 0.18s, box-shadow 0.18s;
          white-space: nowrap;
        }

        .toggle-pill:first-child { border-radius: 8px 0 0 8px; }
        .toggle-pill:last-child  { border-radius: 0 8px 8px 0; }

        .toggle-pill.active {
          background: var(--brand);
          color: #fff;
          font-weight: 600;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.12);
        }

        .toggle-pill:not(.active):hover {
          background: #e5e7eb;
          color: #374151;
        }

        .doc-check {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
        }

        .consent-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 14px;
        }

        .review-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .review-pdf-section { 
          margin: 24px 0; 
          padding: 20px; 
          background: linear-gradient(135deg, #f8f7ff 0%, #ede9fe 100%); 
          border-radius: 10px; 
          border: 1px solid #c4b5fd; 
          text-align: center; 
        }
        .review-pdf-title { 
          font-size: 16px; 
          font-weight: 700; 
          color: #1f2937; 
          margin-bottom: 6px; 
        }
        .review-pdf-note { 
          font-size: 13px; 
          color: #6b7280; 
          margin-bottom: 14px; 
        }
        .review-pdf-actions { 
          display: flex; 
          gap: 12px; 
          justify-content: center; 
          flex-wrap: wrap; 
        }
        .review-pdf-btn { 
          padding: 10px 22px; 
          background: #6c3ce1; 
          color: #fff; 
          border: none; 
          border-radius: 8px; 
          font-size: 14px; 
          font-weight: 600; 
          cursor: pointer; 
          transition: background 120ms ease;
        }
        .review-pdf-btn:hover { 
          background: #5a2fc0; 
        }
        .review-pdf-btn.secondary { 
          background: #fff; 
          color: #6c3ce1; 
          border: 2px solid #6c3ce1; 
        }
        .review-pdf-btn.secondary:hover { 
          background: #f5f3ff; 
        }

        .age-warning {
          margin: 12px 0 0;
          border: 1px solid #f59e0b;
          background: #fffbeb;
          color: #92400e;
          border-radius: 8px;
          padding: 8px 10px;
          font-size: 12px;
        }

        /* .sticky-footer / .sticky-footer-inner rules removed — the action bar
           is now .enroll-footer, a flex sibling of .enroll-scroll (not sticky). */

        .footer-progress-wrap {
          display: flex;
          align-items: center;
          gap: 12px;
          flex: 1 1 260px;
          min-width: 0;
          max-width: 100%;
          padding-right: 8px;
          overflow: hidden;
        }

        .footer-progress-label {
          font-size: 13px;
          color: #6b7280;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .footer-progress-track {
          position: relative;
          flex: 0 0 220px;
          width: 220px;
          height: 6px;
          border-radius: 999px;
          background: #e5e7eb;
          overflow: hidden;
        }

        .footer-progress-fill {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #6c3ce1 0%, #4f39f6 100%);
          transition: width 0.25s ease;
          width: 0;
        }

        .footer-progress-fill.progress-fill-0 { width: 0%; }
        .footer-progress-fill.progress-fill-10 { width: 10%; }
        .footer-progress-fill.progress-fill-20 { width: 20%; }
        .footer-progress-fill.progress-fill-30 { width: 30%; }
        .footer-progress-fill.progress-fill-40 { width: 40%; }
        .footer-progress-fill.progress-fill-50 { width: 50%; }
        .footer-progress-fill.progress-fill-60 { width: 60%; }
        .footer-progress-fill.progress-fill-70 { width: 70%; }
        .footer-progress-fill.progress-fill-80 { width: 80%; }
        .footer-progress-fill.progress-fill-90 { width: 90%; }
        .footer-progress-fill.progress-fill-100 { width: 100%; }

        .footer-progress-value {
          font-size: 14px;
          font-weight: 600;
          color: #6b7280;
          white-space: nowrap;
        }

        .footer-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          align-items: center;
          flex: 0 1 auto;
          min-width: 0;
        }

        .btn-discard {
          border: none;
          background: transparent;
          color: #6b7280;
          cursor: pointer;
          font-size: 14px;
          padding: 8px 4px;
          white-space: nowrap;
          flex-shrink: 0;
        }

        .btn-discard:hover {
          color: #374151;
        }

        .btn-draft {
          padding: 12px 22px;
          border: 1px solid #d1d5db;
          border-radius: 14px;
          background: #fff;
          color: #374151;
          cursor: pointer;
          font-size: 14px;
          line-height: 1.2;
          text-decoration: none;
        }

        .btn-outline {
          padding: 12px 20px;
          border: 1px solid var(--brand);
          border-radius: 14px;
          background: transparent;
          color: var(--brand);
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          line-height: 1.2;
          transition: background 140ms ease;
        }

        .btn-outline:hover:not(:disabled) {
          background: rgba(108,60,225,.06);
        }

        .btn-outline:disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }

        /* Pill buttons — e.g. Vision options */
        .pill-btn-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 4px;
        }

        .pill-btn {
          border: 1px solid var(--border-mid, #d1d5db);
          padding: 8px 16px;
          border-radius: 999px;
          background: transparent;
          font-size: 13px;
          font-family: inherit;
          cursor: pointer;
          color: #374151;
          transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
        }

        .pill-btn:hover {
          border-color: var(--brand);
          color: var(--brand);
        }

        .pill-btn-active {
          background: var(--brand);
          color: #fff;
          border-color: var(--brand);
        }

        .btn-draft:hover {
          border-color: #9ca3af;
          background: #f9fafb;
        }

        .footer-status {
          margin: 0;
          padding: 6px 10px;
          border-radius: 8px;
          font-size: 12px;
          max-width: 55%;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          border: 1px solid transparent;
        }

        .footer-status-success {
          color: #065f46;
          background: #d1fae5;
          border-color: #a7f3d0;
        }

        .footer-status-error {
          color: #b91c1c;
          background: #fee2e2;
          border-color: #fecaca;
        }

        .save-toast {
          position: fixed;
          right: 18px;
          top: 20px;
          z-index: 1200;
          min-width: 240px;
          max-width: min(420px, calc(100vw - 24px));
          border-radius: 10px;
          padding: 12px 14px;
          font-size: 13px;
          font-weight: 500;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.2);
          border: 1px solid transparent;
        }

        .save-toast-success {
          color: #065f46;
          background: #d1fae5;
          border-color: #a7f3d0;
        }

        .save-toast-error {
          color: #b91c1c;
          background: #fee2e2;
          border-color: #fecaca;
        }

        .btn-cancel {
          padding: 9px 14px;
          border: 1px solid #d1d5db;
          border-radius: 8px;
          text-decoration: none;
          color: #374151;
          font-size: 14px;
        }

        .btn-save {
          padding: 12px 26px;
          border: 1px solid var(--brand);
          background: var(--brand);
          color: #fff;
          border-radius: 14px;
          cursor: pointer;
          text-decoration: none;
          font-size: 14px;
          font-weight: 600;
          box-shadow: 0 8px 22px rgba(79, 57, 246, 0.2);
        }

        .btn-save-cta:hover {
          background: #5a2ee0;
          border-color: #5a2ee0;
        }

        .btn-save-cta:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          box-shadow: none;
          pointer-events: none;
        }

        .btn-green {
          padding: 9px 14px;
          border: 1px solid #0f766e;
          background: #0f766e;
          color: #fff;
          border-radius: 8px;
          cursor: pointer;
        }

        .photo-preview-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.68);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          padding: 16px;
        }

        .photo-preview-card {
          position: relative;
          max-width: 720px;
          width: 100%;
          background: #fff;
          border-radius: 12px;
          padding: 12px;
          border: 1px solid #e2e8f0;
        }

        .photo-preview-close {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid #cbd5e1;
          background: #fff;
          cursor: pointer;
          font-weight: 700;
        }

        .photo-preview-image {
          width: 100%;
          max-height: 80vh;
          object-fit: contain;
          border-radius: 8px;
          background: #f8fafc;
        }

        .camera-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.72);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1100;
          padding: 16px;
        }

        .camera-card {
          width: min(600px, 95%);
          max-height: 85vh;
          background: #fff;
          border-radius: 14px;
          border: 1px solid #e2e8f0;
          overflow: hidden;
          box-shadow: 0 18px 50px rgba(15, 23, 42, 0.28);
          display: flex;
          flex-direction: column;
        }

        .camera-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          padding: 16px 18px;
          border-bottom: 1px solid #e5e7eb;
        }

        .camera-head h3 {
          margin: 0;
          font-size: 18px;
          color: #111827;
        }

        .camera-head p {
          margin: 4px 0 0;
          font-size: 13px;
          color: #6b7280;
        }

        .camera-close {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          border: 1px solid #d1d5db;
          background: #fff;
          cursor: pointer;
          font-weight: 700;
        }

        .camera-body {
          padding: 16px 18px;
          background: #0f172a;
          flex: 1;
          overflow-y: auto;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .camera-video {
          width: 100%;
          max-height: 50vh;
          aspect-ratio: 4 / 3;
          object-fit: cover;
          background: #020617;
          border-radius: 12px;
        }

        .camera-preview-image {
          width: 100%;
          max-height: 50vh;
          aspect-ratio: 4 / 3;
          object-fit: contain;
          background: #020617;
          border-radius: 12px;
        }

        .camera-error {
          margin: 0 0 12px;
          color: #fecaca;
          font-size: 13px;
        }

        .camera-actions {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
          padding: 14px 18px 18px;
          background: #fff;
        }

        .mt-20 {
          margin-top: 20px;
        }

        .mt-8 {
          margin-top: 8px;
        }

        /* Review Section */
        .review-summary-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
          background: #F8F9FB;
          padding: 20px;
          border-radius: 12px;
        }

        .review-item {
          display: flex;
          flex-direction: column;
        }

        .review-label {
          font-size: 11px;
          letter-spacing: 0.1em;
          font-weight: 600;
          color: #64748B;
          margin-bottom: 6px;
        }

        .review-value {
          font-size: 14px;
          color: #111827;
          line-height: 1.5;
        }

        /* ============================================================
           MEDIUM BREAKPOINT (≤1280px): keep Claude-style two-column
           layout — stepper on the left (vertical, readable labels),
           form on the right. Just narrow the stepper column so the
           form has room to breathe.
           ============================================================ */
        @media (max-width: 1280px) {
          .hero-title {
            font-size: 32px;
          }
          .section-title {
            font-size: 24px;
          }
          .section-card {
            padding: 20px;
          }
          .grid-3 {
            grid-template-columns: repeat(2, 1fr);
          }

          /* Narrow stepper column but keep it vertical with full labels. */
          .section-nav-wrap {
            width: 220px;
            min-width: 220px;
            flex-shrink: 0;
          }

          /* Defensive: never clip, ellipsize, or hide step text. */
          .nav-label,
          .nav-copy {
            white-space: normal;
            overflow: visible;
            text-overflow: unset;
          }
          .nav-text {
            min-width: 0;
            white-space: normal;
          }
        }

        @media (max-width: 1024px) {
          /* Progress bar takes full first row; buttons move to second row */
          .enroll-footer {
            padding: 12px 16px;
          }
          .footer-progress-wrap {
            flex: 1 1 100%;
            max-width: 100%;
            padding-right: 0;
          }
          .footer-actions {
            flex: 1 1 100%;
            justify-content: flex-end;
          }
        }

        /* ============================================================
           MOBILE (≤900px): at this width the global sidebar also
           stacks on top (Sidebar.module.css) — the stepper column
           can't fit alongside the form anymore, so flatten it to a
           horizontal pill strip above the form.
           ============================================================ */
        @media (max-width: 900px) {
          .enroll-body {
            flex-direction: column;
          }

          .section-nav-wrap {
            position: relative;
            top: auto;
            width: 100%;
            min-width: 0;
            max-height: none;
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
            padding: 10px 12px;
            z-index: 5;
          }

          .section-nav {
            max-height: none;
            overflow-x: auto;
            overflow-y: visible;
            padding-right: 0;
            scrollbar-width: thin;
          }

          .section-nav-list {
            display: flex;
            flex-direction: row;
            gap: 6px;
            align-items: stretch;
          }

          .nav-item {
            margin-bottom: 0;
            flex-shrink: 0;
          }

          .nav-item-inner {
            align-items: center;
            gap: 8px;
            padding: 6px 12px 6px 8px;
            white-space: nowrap;
            border-radius: 999px;
          }

          /* Compact mode only — sub-copy dropped on mobile to fit in a row. */
          .nav-copy {
            display: none;
          }

          .nav-item.active::before {
            display: none;
          }
          .nav-item.active .nav-item-inner {
            background: #ede9fe;
          }
        }

        @media (max-width: 768px) {
          .grid-3,
          .grid-2,
          .review-grid {
            grid-template-columns: 1fr;
          }

          .review-summary-grid {
            grid-template-columns: 1fr;
          }

          .page-title-row,
          .top-row,
          .scan-banner {
            flex-direction: column;
            align-items: flex-start;
          }

          .hero-kpi {
            text-align: left;
          }

          .scan-actions {
            width: 100%;
          }

          .enroll-footer {
            width: 100%;
            flex-direction: column;
            align-items: stretch;
            padding: 14px 16px;
          }

          .footer-progress-wrap,
          .footer-actions {
            width: 100%;
            max-width: 100%;
            flex: 1 1 100%;
          }

          .footer-actions {
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 8px;
          }

          .footer-progress-track {
            min-width: 0;
            width: 100%;
          }

          .footer-status {
            max-width: 100%;
            white-space: normal;
          }
        }

        .nav-group-heading {
          font-size: 11px;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--text-3, #6b7280);
          padding: 14px 12px 6px;
          font-weight: 600;
          list-style: none;
        }

        .nav-badge {
          font-size: 9px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          margin-left: 8px;
          letter-spacing: 0.05em;
        }
        .nav-badge-goi { background: #fef3c7; color: #92400e; }
        .nav-badge-new { background: #dbeafe; color: #1e40af; }
        .nav-badge-sensitive { background: #fee2e2; color: #991b1b; }

        .apaar-tip {
          background: #f3f4f6;
          border-left: 3px solid var(--purple, #6c3ce1);
          padding: 12px 16px;
          border-radius: 6px;
          margin-bottom: 20px;
          font-size: 13px;
          color: var(--text-2, #4b5563);
        }
        .apaar-tip code {
          background: #fff;
          padding: 2px 6px;
          border-radius: 3px;
          font-family: monospace;
        }

        .form-divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 28px 0 16px;
        }
        .form-divider::before, .form-divider::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border, #e5e7eb);
        }
        .form-divider span {
          font-size: 11px;
          letter-spacing: 0.08em;
          color: var(--text-3, #6b7280);
          font-weight: 600;
        }

        .encryption-disclosure {
          background: #fef3c7;
          border: 1px solid #f59e0b;
          border-radius: 8px;
          padding: 14px 18px;
          margin-top: 20px;
          font-size: 12px;
          color: #78350f;
          line-height: 1.6;
        }

        .toggle-switch {
          position: relative;
          display: inline-block;
          width: 44px;
          height: 24px;
        }
        .toggle-switch input { opacity: 0; width: 0; height: 0; }
        .toggle-slider {
          position: absolute;
          cursor: pointer;
          inset: 0;
          background: #cbd5e1;
          transition: .25s;
          border-radius: 999px;
        }
        .toggle-slider::before {
          position: absolute;
          content: '';
          height: 18px;
          width: 18px;
          left: 3px;
          bottom: 3px;
          background: #fff;
          transition: .25s;
          border-radius: 50%;
          box-shadow: 0 1px 3px rgba(0,0,0,.2);
        }
        .toggle-switch input:checked + .toggle-slider { background: var(--purple, #6c3ce1); }
        .toggle-switch input:checked + .toggle-slider::before { transform: translateX(20px); }

        .pwd-toggle-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border: 1px solid var(--border-mid, #d1d5db);
          border-radius: 10px;
          margin: 20px 0;
        }
        .pwd-toggle-label { font-weight: 600; color: var(--text-1, #1f2937); }
        .pwd-toggle-hint { font-size: 12px; color: var(--text-3, #6b7280); margin-top: 2px; }

        .disclosure-banner-green {
          background: #d1fae5;
          border: 1px solid #10b981;
          color: #065f46;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          margin-bottom: 20px;
        }

        .identity-marks-grid {
          display: grid;
          grid-template-columns: 200px 1fr;
          gap: 24px;
          margin-top: 20px;
        }
        .body-diagram {
          background: #f9fafb;
          border-radius: 12px;
          padding: 16px;
          text-align: center;
        }
        .diagram-hint { font-size: 11px; color: var(--text-3, #6b7280); margin-top: 8px; }
        .marks-hint { font-size: 13px; color: var(--text-3, #6b7280); margin-bottom: 12px; }
        .marks-list { min-width: 0; }
        .btn-outline-sm {
          padding: 6px 12px;
          border: 1px solid var(--border-mid, #d1d5db);
          background: #fff;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
        }
        .btn-outline-sm:hover { background: #f3f4f6; }

        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

        .adm-type-tooltip-wrap:hover .adm-type-tooltip-body { display: block !important; }

        @media (max-width: 720px) {
          .identity-marks-grid { grid-template-columns: 1fr; }
        }

        /* ===== Hero action buttons (Drafts / AI / PDF) ===== */
        .hero-actions-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .hero-action-btn {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 18px;
          border-radius: 11px;
          font-size: 13.5px;
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          transition: transform 0.15s ease, box-shadow 0.2s ease, background 0.2s ease, border-color 0.2s ease;
          letter-spacing: 0.1px;
          border: 1px solid transparent;
          backdrop-filter: blur(6px);
        }
        .hero-action-btn:hover { transform: translateY(-1px); }
        .hero-action-btn:active { transform: translateY(0); }
        .hero-action-btn svg { flex-shrink: 0; }
        .hero-action-drafts {
          background: rgba(255,255,255,0.85);
          border-color: #e5e7eb;
          color: #374151;
        }
        .hero-action-drafts:hover {
          background: #fff;
          border-color: #c7d2fe;
          box-shadow: 0 4px 14px -4px rgba(99,102,241,0.25);
        }
        .hero-action-pdf {
          background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
          border-color: #ddd6fe;
          color: #6c3ce1;
        }
        .hero-action-pdf:hover {
          background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
          border-color: #c4b5fd;
          box-shadow: 0 6px 18px -6px rgba(108,60,225,0.35);
        }
        .hero-action-info {
          background: linear-gradient(135deg, #ecfeff 0%, #cffafe 100%);
          border-color: #a5f3fc;
          color: #0e7490;
        }
        .hero-action-info:hover {
          background: linear-gradient(135deg, #cffafe 0%, #a5f3fc 100%);
          border-color: #67e8f9;
          box-shadow: 0 4px 14px -4px rgba(8,145,178,0.3);
        }
        .hero-action-ai {
          background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
          color: #fff;
          border-color: transparent;
          box-shadow: 0 4px 14px -3px rgba(139,92,246,0.45);
        }
        .hero-action-ai:hover {
          box-shadow: 0 8px 22px -4px rgba(236,72,153,0.55);
          background: linear-gradient(135deg, #7c3aed 0%, #db2777 100%);
        }
        .hero-action-pulse {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 7px;
          height: 7px;
          background: #fff;
          border-radius: 50%;
          box-shadow: 0 0 0 0 rgba(255,255,255,0.85);
          animation: aiPulse 2s infinite;
        }
        @keyframes aiPulse {
          0% { box-shadow: 0 0 0 0 rgba(255,255,255,0.7); }
          70% { box-shadow: 0 0 0 8px rgba(255,255,255,0); }
          100% { box-shadow: 0 0 0 0 rgba(255,255,255,0); }
        }
        .hero-action-badge {
          background: rgba(108,60,225,0.12);
          color: #6c3ce1;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 999px;
          margin-left: 2px;
          min-width: 16px;
          text-align: center;
        }

        /* ===== AI / Drafts modal shell ===== */
        .ai-overlay {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, 0.55);
          backdrop-filter: blur(4px);
          z-index: 9998;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          animation: aiFade 0.2s ease;
        }
        @keyframes aiFade { from { opacity: 0; } to { opacity: 1; } }
        .ai-modal {
          background: #fff;
          border-radius: 16px;
          width: 100%;
          max-width: 600px;
          max-height: 88vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 30px 80px -20px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.04);
          overflow: hidden;
          animation: aiSlideUp 0.25s cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes aiSlideUp { from { opacity: 0; transform: translateY(12px) scale(0.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

        .ai-modal-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          padding: 18px 22px;
          border-bottom: 1px solid #f1f5f9;
          background: #fff;
        }
        .ai-modal-head-gradient {
          background: linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%);
          border-bottom: none;
          color: #fff;
        }
        .ai-modal-head-left {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .ai-modal-icon {
          width: 38px;
          height: 38px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .ai-modal-icon-drafts {
          background: linear-gradient(135deg, #ede9fe, #f5f3ff);
          color: #6c3ce1;
        }
        .ai-modal-icon-ai {
          background: rgba(255,255,255,0.22);
          color: #fff;
        }
        .ai-modal-title {
          margin: 0;
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.2;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .ai-modal-title-light { color: #fff; }
        .ai-beta-pill {
          background: rgba(255,255,255,0.22);
          color: #fff;
          font-size: 9px;
          font-weight: 700;
          padding: 2px 7px;
          border-radius: 999px;
          letter-spacing: 0.6px;
        }
        .ai-modal-sub {
          margin: 3px 0 0;
          font-size: 12.5px;
          color: #64748b;
          line-height: 1.4;
        }
        .ai-modal-sub-light { color: rgba(255,255,255,0.85); }

        .ai-close {
          background: rgba(0,0,0,0.04);
          border: none;
          width: 30px;
          height: 30px;
          border-radius: 8px;
          color: #64748b;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s;
          flex-shrink: 0;
        }
        .ai-close:hover { background: rgba(0,0,0,0.08); color: #0f172a; }
        .ai-close-light {
          background: rgba(255,255,255,0.15);
          color: #fff;
        }
        .ai-close-light:hover { background: rgba(255,255,255,0.25); color: #fff; }

        .ai-toolbar {
          padding: 12px 22px;
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          border-bottom: 1px solid #f1f5f9;
          background: #fafafa;
        }
        .ai-search {
          flex: 1;
          min-width: 180px;
          display: flex;
          align-items: center;
          gap: 8px;
          background: #fff;
          border: 1px solid #e5e7eb;
          border-radius: 9px;
          padding: 7px 12px;
          color: #94a3b8;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .ai-search:focus-within { border-color: #c4b5fd; box-shadow: 0 0 0 3px rgba(139,92,246,0.12); }
        .ai-search input {
          flex: 1;
          border: none;
          outline: none;
          font-size: 13px;
          color: #0f172a;
          background: transparent;
        }
        .ai-sort { display: flex; gap: 4px; }
        .ai-sort-pill {
          padding: 6px 11px;
          border-radius: 7px;
          border: 1px solid transparent;
          background: transparent;
          font-size: 12px;
          font-weight: 500;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s;
        }
        .ai-sort-pill:hover { color: #0f172a; background: rgba(0,0,0,0.04); }
        .ai-sort-pill.active {
          background: #fff;
          border-color: #ddd6fe;
          color: #6c3ce1;
          box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        }

        .ai-modal-body {
          flex: 1;
          overflow-y: auto;
          padding: 14px 22px 20px;
        }
        .ai-no-match {
          text-align: center;
          color: #94a3b8;
          font-size: 13px;
          padding: 24px 0;
        }

        /* ===== Draft cards ===== */
        .ai-draft-card {
          display: flex;
          gap: 12px;
          padding: 12px;
          border: 1px solid #e5e7eb;
          border-radius: 12px;
          margin-bottom: 10px;
          background: #fff;
          transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
        }
        .ai-draft-card:hover {
          border-color: #c7d2fe;
          box-shadow: 0 6px 16px -8px rgba(108,60,225,0.2);
          transform: translateY(-1px);
        }
        .ai-draft-avatar {
          width: 42px;
          height: 42px;
          border-radius: 11px;
          background: linear-gradient(135deg, #c4b5fd, #a78bfa);
          color: #fff;
          font-size: 14px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .ai-draft-avatar[data-tone="high"] { background: linear-gradient(135deg, #34d399, #10b981); }
        .ai-draft-avatar[data-tone="mid"] { background: linear-gradient(135deg, #fbbf24, #f59e0b); }
        .ai-draft-avatar[data-tone="low"] { background: linear-gradient(135deg, #cbd5e1, #94a3b8); }

        .ai-draft-body { flex: 1; min-width: 0; }
        .ai-draft-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .ai-draft-name {
          font-size: 14px;
          font-weight: 600;
          color: #0f172a;
        }
        .ai-draft-chip {
          background: #f1f5f9;
          color: #475569;
          font-size: 11px;
          font-weight: 600;
          padding: 2px 8px;
          border-radius: 999px;
        }
        .ai-draft-meta {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11.5px;
          color: #94a3b8;
          margin-top: 3px;
        }
        .ai-dot { width: 3px; height: 3px; background: #cbd5e1; border-radius: 50%; }
        .ai-pct { font-weight: 600; }
        .ai-pct-high { color: #059669; }
        .ai-pct-mid { color: #d97706; }
        .ai-pct-low { color: #64748b; }
        .ai-progress-track {
          margin-top: 7px;
          height: 4px;
          background: #f1f5f9;
          border-radius: 999px;
          overflow: hidden;
        }
        .ai-progress-bar { height: 100%; border-radius: 999px; transition: width 0.4s ease; }
        .ai-progress-high { background: linear-gradient(90deg, #34d399, #10b981); }
        .ai-progress-mid { background: linear-gradient(90deg, #fbbf24, #f59e0b); }
        .ai-progress-low { background: linear-gradient(90deg, #cbd5e1, #94a3b8); }
        .ai-progress-bar[data-pct="0"] { width: 0%; }
        .ai-progress-bar[data-pct] { width: var(--ai-pct, 0%); }
        .ai-draft-tip {
          margin: 7px 0 0;
          font-size: 12px;
          color: #6366f1;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .ai-draft-actions {
          display: flex;
          flex-direction: column;
          gap: 6px;
          flex-shrink: 0;
        }
        .ai-btn-primary {
          padding: 7px 14px;
          background: linear-gradient(135deg, #6c3ce1, #8b5cf6);
          color: #fff;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12.5px;
          font-weight: 600;
          transition: transform 0.15s, box-shadow 0.15s;
        }
        .ai-btn-primary:hover {
          transform: translateY(-1px);
          box-shadow: 0 6px 14px -4px rgba(108,60,225,0.45);
        }
        .ai-btn-ghost-danger {
          padding: 6px;
          width: 30px;
          height: 30px;
          background: #fff;
          color: #dc2626;
          border: 1px solid #fecaca;
          border-radius: 7px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          align-self: center;
          transition: background 0.15s;
        }
        .ai-btn-ghost-danger:hover { background: #fef2f2; }

        /* ===== Empty state ===== */
        .ai-empty {
          padding: 40px 22px;
          text-align: center;
        }
        .ai-empty-illustration {
          display: inline-flex;
          padding: 18px;
          background: linear-gradient(135deg, #f5f3ff, #ede9fe);
          border-radius: 50%;
          margin-bottom: 14px;
        }
        .ai-empty-title {
          margin: 0 0 6px;
          font-size: 16px;
          color: #0f172a;
        }
        .ai-empty-text {
          margin: 0 auto 16px;
          max-width: 340px;
          font-size: 13px;
          color: #64748b;
          line-height: 1.5;
        }
        .ai-cta-btn {
          padding: 9px 22px;
          background: linear-gradient(135deg, #6c3ce1, #8b5cf6);
          color: #fff;
          border: none;
          border-radius: 9px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }

        /* ===== AI assistant — summary card + tips ===== */
        .ai-summary-card {
          margin: 16px 22px 0;
          padding: 16px 18px;
          background: linear-gradient(135deg, #faf5ff 0%, #fdf2f8 100%);
          border-radius: 14px;
          border: 1px solid #ede9fe;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
        }
        .ai-summary-label {
          margin: 0;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.6px;
          color: #8b5cf6;
          text-transform: uppercase;
        }
        .ai-summary-pct {
          margin: 4px 0 2px;
          font-size: 32px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1;
        }
        .ai-summary-hint {
          margin: 0;
          font-size: 12px;
          color: #64748b;
        }
        .ai-summary-ring { flex-shrink: 0; }

        .ai-section-label {
          margin: 14px 0 10px;
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.8px;
          color: #94a3b8;
          text-transform: uppercase;
        }
        .ai-tip {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 12px 14px;
          border-radius: 11px;
          margin-bottom: 8px;
          border: 1px solid transparent;
          transition: background 0.15s;
        }
        .ai-tip-info { background: #f0f9ff; border-color: #e0f2fe; }
        .ai-tip-warn { background: #fffbeb; border-color: #fef3c7; }
        .ai-tip-success { background: #f0fdf4; border-color: #dcfce7; }
        .ai-tip-icon {
          font-size: 18px;
          line-height: 1;
          flex-shrink: 0;
          padding-top: 1px;
        }
        .ai-tip-body { flex: 1; min-width: 0; }
        .ai-tip-title {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: #0f172a;
        }
        .ai-tip-text {
          margin: 3px 0 0;
          font-size: 12.5px;
          color: #475569;
          line-height: 1.45;
        }
        .ai-tip-action {
          background: rgba(255,255,255,0.7);
          border: 1px solid rgba(0,0,0,0.06);
          color: #6c3ce1;
          font-size: 12px;
          font-weight: 600;
          padding: 6px 11px;
          border-radius: 7px;
          cursor: pointer;
          flex-shrink: 0;
          align-self: center;
          transition: background 0.15s;
        }
        .ai-tip-action:hover { background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.08); }

        .ai-quickbar {
          display: flex;
          gap: 8px;
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #f1f5f9;
        }
        .ai-quick {
          flex: 1;
          padding: 9px 10px;
          background: #fafafa;
          border: 1px solid #e5e7eb;
          border-radius: 9px;
          font-size: 12.5px;
          font-weight: 500;
          color: #475569;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          transition: all 0.15s;
        }
        .ai-quick:hover {
          background: #fff;
          border-color: #c4b5fd;
          color: #6c3ce1;
          transform: translateY(-1px);
        }
        .ai-disclaimer {
          margin: 14px 0 0;
          font-size: 11px;
          color: #94a3b8;
          text-align: center;
          line-height: 1.4;
        }

        @media (max-width: 600px) {
          .hero-action-btn span:not(.hero-action-badge):not(.hero-action-pulse) { display: none; }
          .hero-action-btn { padding: 8px 10px; }
          .ai-quickbar { flex-direction: column; }
          .ai-summary-card { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
    </div>
  );
}

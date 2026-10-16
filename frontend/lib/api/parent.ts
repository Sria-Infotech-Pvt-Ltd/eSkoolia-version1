/**
 * Parent Portal API client
 *
 * All functions hit /api/v1/parent/* endpoints, scoped to the
 * authenticated guardian's profile. No URL params carry student identity —
 * all scoping is enforced server-side via Guardian.user.
 */

import { apiRequestWithRefresh } from "@/lib/api-auth";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ChildSummary {
  id: number;
  name: string;
  admission_no: string;
  roll_no: string;
  class_name: string;
  section_name: string;
  class_id: number | null;
  section_id: number | null;
  photo_url: string | null;
  gender: string;
}

export interface ChildWithStats extends ChildSummary {
  /** Attendance percentage over the last 90 days. null if no records yet. */
  attendance_pct: number | null;
}

export interface ParentMe {
  guardian_id: number;
  name: string;
  relation: string;
  phone: string;
  email: string;
  occupation: string;
  children: ChildSummary[];
  children_count: number;
}

export interface AttendanceSummary {
  present: number;
  late: number;
  absent: number;
  half_day: number;
  total: number;
  pct: number | null;
}

export interface ExamMarkRow {
  subject: string;
  exam_name: string;
  term: string;
  obtained: number;
  full_marks: number;
  pass_marks: number;
  absent: boolean;
  exam_date: string | null;
}

export interface ChildGuardian {
  id: number;
  full_name: string;
  relation: string;
  phone: string;
  email: string;
  occupation: string;
  is_primary: boolean;
}

/** All fields captured during the admission wizard, as recorded at onboarding. */
export interface ChildOnboardingProfile {
  contact: { phone: string; email: string; emergency_contact_name: string; emergency_contact_phone: string };
  address: { address_line: string; landmark: string; city: string; district: string; state: string; pincode: string };
  background: { mother_tongue: string; other_mother_tongue: string; religion: string; nationality: string; other_nationality: string };
  admission: { admission_type: string; previous_school_name: string; rte_certificate_no: string; stream: string; transport_modes: string[]; transport_custom: string };
  identity_documents: { apaar_id: string; aadhaar_no: string; pen: string; digilocker_mobile: string; abc_id: string };
  physical: { height_cm: number | null; weight_kg: number | null; eye_colour: string; hair_colour: string; complexion: string; build: string; identity_marks: string[] };
  medical: {
    vision: string; medical_conditions: string[]; allergies: string[]; current_medications: string;
    treating_doctor: string; vaccinations: string[]; medical_notes: string; is_pwd: boolean;
    disability_types: string[]; disability_percent: number | null; disability_accommodations: string[]; disability_notes: string;
  };
  guardians: ChildGuardian[];
}

export interface ChildDetail extends ChildSummary, ChildOnboardingProfile {
  first_name: string;
  middle_name: string;
  last_name: string;
  custom_gender: string;
  date_of_birth: string | null;
  blood_group: string;
  attendance: AttendanceSummary;
  recent_marks: ExamMarkRow[];
  behaviour_points: number;
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function parentGet<T>(path: string): Promise<T> {
  return apiRequestWithRefresh<T>(`/api/v1/parent${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
}

// ── API functions ─────────────────────────────────────────────────────────────

/**
 * GET /api/v1/parent/me/
 * Returns the guardian's profile and lightweight children list.
 * Called once by ParentChildContext — not called directly in pages.
 */
export function fetchParentMe(): Promise<ParentMe> {
  return parentGet<ParentMe>("/me/");
}

/**
 * GET /api/v1/parent/children/
 * Returns children with attendance stats (last 90 days).
 */
export function fetchParentChildren(): Promise<ChildWithStats[]> {
  return parentGet<ChildWithStats[]>("/children/");
}

/**
 * GET /api/v1/parent/children/<id>/
 * Returns one child's full profile: attendance summary, exam marks, behaviour.
 * Returns 404 if the child does not belong to the authenticated guardian.
 */
export function fetchChildDetail(childId: number): Promise<ChildDetail> {
  return parentGet<ChildDetail>(`/children/${childId}/`);
}

// ── Attendance calendar ───────────────────────────────────────────────────────

export interface AttendanceDay {
  date: string;
  type: "P" | "A" | "L" | "F" | "H";
}

export interface HolidayDay {
  date: string;
  title: string;
}

export interface AttendanceCalendarSummary {
  present: number;
  absent: number;
  late: number;
  half_day: number;
  total: number;
  pct: number | null;
}

export interface AttendanceCalendar {
  year: number;
  month: number;
  child_id: number;
  child_name: string;
  days: AttendanceDay[];
  holidays: HolidayDay[];
  summary: AttendanceCalendarSummary;
}

/**
 * GET /api/v1/parent/attendance/?child_id=<id>&month=YYYY-MM
 */
export function fetchAttendanceCalendar(childId: number, month: string): Promise<AttendanceCalendar> {
  return parentGet<AttendanceCalendar>(`/attendance/?child_id=${childId}&month=${month}`);
}

// ── Fees ──────────────────────────────────────────────────────────────────────

export interface FeeItem {
  id: number;
  fee_name: string;
  amount: number;
  discount: number;
  net_amount: number;
  paid_amount: number;
  due_amount: number;
  due_date: string;
  status: "unpaid" | "partial" | "paid";
}

export interface FeeGroup {
  group_name: string;
  items: FeeItem[];
}

export interface FeesSummary {
  total_billed: number;
  total_paid: number;
  total_due: number;
}

export interface ChildFees {
  child_id: number;
  child_name: string;
  summary: FeesSummary;
  groups: FeeGroup[];
}

/**
 * GET /api/v1/parent/fees/?child_id=<id>
 */
export function fetchChildFees(childId: number): Promise<ChildFees> {
  return parentGet<ChildFees>(`/fees/?child_id=${childId}`);
}

// ── Notices ───────────────────────────────────────────────────────────────────

export interface NoticeItem {
  id: number;
  title: string;
  message: string;
  notice_date: string;
  publish_on: string;
}

/**
 * GET /api/v1/parent/notices/
 */
export function fetchParentNotices(): Promise<NoticeItem[]> {
  return parentGet<NoticeItem[]>("/notices/");
}

// ── Write helpers ─────────────────────────────────────────────────────────────

function parentPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequestWithRefresh<T>(`/api/v1/parent${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

// ── Timetable ─────────────────────────────────────────────────────────────────

export interface TimetableSlotItem {
  day_of_week: string;
  period_number: string | number | null;
  subject: string;
  teacher: string;
  start_time: string | null;
  end_time: string | null;
  room: string;
}

export interface ChildTimetable {
  child_id: number;
  slots: TimetableSlotItem[];
}

/**
 * GET /api/v1/parent/timetable/?child_id=<id>
 */
export function fetchChildTimetable(childId: number): Promise<ChildTimetable> {
  return parentGet<ChildTimetable>(`/timetable/?child_id=${childId}`);
}

// ── Homework ──────────────────────────────────────────────────────────────────

export interface ChildHomeworkSubmission {
  complete_status: "C" | "I" | "P";
  marks: number | null;
  note: string;
  file: string | null;
}

export interface ChildHomeworkItem {
  id: number;
  subject: string;
  section_name: string;
  homework_date: string;
  submission_date: string;
  description: string;
  file: string | null;
  marks: number | null;
  submission: ChildHomeworkSubmission | null;
}

/**
 * GET /api/v1/parent/homework/?child_id=<id>
 */
export function fetchChildHomework(childId: number): Promise<ChildHomeworkItem[]> {
  return parentGet<ChildHomeworkItem[]>(`/homework/?child_id=${childId}`);
}

// ── Syllabus ──────────────────────────────────────────────────────────────────

export interface SyllabusTopicItem {
  title: string;
  status: string;
}

export interface SyllabusGroupItem {
  id: number;
  subject: string;
  lesson_name: string;
  topics_done: number;
  topics_total: number;
  topics: SyllabusTopicItem[];
}

/**
 * GET /api/v1/parent/syllabus/?child_id=<id>
 */
export function fetchChildSyllabus(childId: number): Promise<SyllabusGroupItem[]> {
  return parentGet<SyllabusGroupItem[]>(`/syllabus/?child_id=${childId}`);
}

// ── Exam results (grouped) + Report card ────────────────────────────────────────

export interface TermMarkRow {
  subject: string;
  exam_name: string;
  obtained: number;
  full_marks: number;
  pass_marks: number;
  absent: boolean;
  exam_date: string | null;
}

export interface TermGroup {
  term: string;
  marks: TermMarkRow[];
}

export interface ChildResults {
  child_id: number;
  terms: TermGroup[];
}

/**
 * GET /api/v1/parent/results/?child_id=<id>
 * Only published exam results.
 */
export function fetchChildResults(childId: number): Promise<ChildResults> {
  return parentGet<ChildResults>(`/results/?child_id=${childId}`);
}

export interface ReportCardRow {
  subject: string;
  term: string;
  obtained: number;
  full_marks: number;
  pass_marks: number;
  grade: string;
  pass_fail: "Pass" | "Fail" | "Absent";
}

export interface ChildReportCard {
  child_id: number;
  rows: ReportCardRow[];
}

/**
 * GET /api/v1/parent/results/report-card/?child_id=<id>
 */
export function fetchChildReportCard(childId: number): Promise<ChildReportCard> {
  return parentGet<ChildReportCard>(`/results/report-card/?child_id=${childId}`);
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface MessageParticipant {
  id: number;
  first_name: string;
  last_name: string;
  username: string;
  email: string;
}

export interface InAppMessageItem {
  id: number;
  sender: MessageParticipant;
  recipient: MessageParticipant;
  subject: string;
  body: string;
  category: "general" | "alert" | "announcement";
  is_read: boolean;
  read_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

/**
 * GET /api/v1/parent/messages/
 */
export function fetchParentMessages(): Promise<InAppMessageItem[]> {
  return parentGet<InAppMessageItem[]>("/messages/");
}

/**
 * POST /api/v1/parent/messages/
 */
export function sendParentMessage(payload: { recipient_id: number; subject: string; body: string; category?: "general" | "alert" | "announcement" }): Promise<InAppMessageItem> {
  return parentPost<InAppMessageItem>("/messages/", payload);
}

// ── Teachers (message recipient directory) ──────────────────────────────────────

export interface ChildTeacherItem {
  id: number;
  name: string;
  role: string;
}

/**
 * GET /api/v1/parent/teachers/?child_id=<id>
 */
export function fetchChildTeachers(childId: number): Promise<ChildTeacherItem[]> {
  return parentGet<ChildTeacherItem[]>(`/teachers/?child_id=${childId}`);
}

// ── Behaviour Log ─────────────────────────────────────────────────────────────

export interface BehaviourEntry {
  id: number;
  incident_title: string;
  point: number;
  date: string;
  note: string;
}

/**
 * GET /api/v1/parent/behaviour/?child_id=<id>
 */
export function fetchChildBehaviour(childId: number): Promise<BehaviourEntry[]> {
  return parentGet<BehaviourEntry[]>(`/behaviour/?child_id=${childId}`);
}

// ── Health Log ────────────────────────────────────────────────────────────────

export interface HealthProfile {
  child_id: number;
  vision: string;
  medical_conditions: string[];
  allergies: string[];
  current_medications: string;
  treating_doctor: string;
  vaccinations: string[];
  medical_notes: string;
  is_pwd: boolean;
  disability_types: string[];
  disability_percent: number | null;
  disability_accommodations: string[];
  disability_notes: string;
}

/**
 * GET /api/v1/parent/health/?child_id=<id>
 */
export function fetchChildHealth(childId: number): Promise<HealthProfile> {
  return parentGet<HealthProfile>(`/health/?child_id=${childId}`);
}

// ── Library (Current and Due, History) ────────────────────────────────────────
// Read only. The child is always sent as ?child_id= and checked against the guardian on the server.
// Background reads pass silent401 so a stray 401 does not log the parent out; the first load of a page uses the default.

function parentLibraryGet<T>(path: string, silent401 = false): Promise<T> {
  return apiRequestWithRefresh<T>(`/api/v1/parent/library${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    silent401,
  });
}

export type LibraryLoanState = "open" | "due_today" | "overdue";

export interface LibraryNextSlot {
  id: number;
  date: string;
  day: string;
  period_name: string;
  start_time: string;
  end_time: string;
  room_label: string;
}

export interface LibraryCurrentLoan {
  id: number;
  book_title: string;
  author: string;
  copy_code: string;
  issue_date: string;
  due_date: string;
  overdue: boolean;
  days_overdue: number;
  /** Exact money string such as "20.00". */
  accrued_fine: string;
  state: LibraryLoanState;
  renew_count: number;
}

export interface LibraryReplacementFee {
  book_title: string;
  amount: string;
  assessed_on: string;
}

export interface LibraryCurrent {
  /** False when the child has no library card yet: an explicit state, not an error. */
  registered: boolean;
  is_active: boolean | null;
  card_no: string;
  next_slot: LibraryNextSlot | null;
  loans: LibraryCurrentLoan[];
  open_loans: number;
  loan_limit: number | null;
  /** Borrowing is on hold because of an overdue fine or an unpaid replacement fee. */
  suspended: boolean;
  fines: { total: string };
  replacement_fees: { total: string; items: LibraryReplacementFee[] };
  registration: { status: "unpaid" | "paid" | "waived" | null; amount: string };
  total_due: string;
}

export interface LibraryHistoryLoan {
  id: number;
  book_title: string;
  author: string;
  copy_code: string;
  issue_date: string;
  due_date: string;
  return_date: string | null;
  state: "returned" | "lost";
  returned_late: boolean;
  fine_amount: string;
}

export interface LibraryHistoryPage {
  count: number;
  next: string | null;
  previous: string | null;
  results: LibraryHistoryLoan[];
}

/** GET /api/v1/parent/library/current/?child_id=<id> */
export function fetchChildLibraryCurrent(childId: number, silent401 = false): Promise<LibraryCurrent> {
  return parentLibraryGet<LibraryCurrent>(`/current/?child_id=${childId}`, silent401);
}

/** GET /api/v1/parent/library/history/?child_id=<id>&page=<n>: closed loans, newest first, 20 a page. */
export function fetchChildLibraryHistory(childId: number, page = 1, silent401 = false): Promise<LibraryHistoryPage> {
  return parentLibraryGet<LibraryHistoryPage>(`/history/?child_id=${childId}&page=${page}`, silent401);
}

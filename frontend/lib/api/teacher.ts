/**
 * Teacher Portal API client
 *
 * All functions:
 *  - Read the auth token from localStorage
 *  - Hit /api/v1/teacher/* endpoints
 *  - Throw on non-2xx (let callers handle errors)
 *  - Return typed interfaces only — no raw API shapes leaking to components
 *
 * Endpoints are added sprint-by-sprint. Sprint 0 has /teacher/me/.
 */

import { apiRequestWithRefresh } from '@/lib/api-auth';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClassTeacherFor {
  class_id: number;
  class_name: string;
  section_id: number;
  section_name: string;
  student_count: number;
}

export interface SubjectSection {
  class_id: number;
  class_name: string;
  section_id: number;
  section_name: string;
  student_count: number;
}

export interface SubjectAssignment {
  subject_id: number;
  subject_name: string;
  total_sections: number;
  total_students: number;
  sections: SubjectSection[];
}

export interface PendingItems {
  homework_to_review: number;
  lesson_plans_pending: number;
  unread_messages: number;
  attendance_pending: boolean;
}

export interface TodayPeriod {
  period: number;
  subject: string;
  class_name: string;
  section_name: string;
  room: string;
  from: string;
  to: string;
  is_now: boolean;
  is_done: boolean;
}

export type TimetablePeriodStatus = 'teaching' | 'break' | 'free';

export interface TimetableSlot extends TodayPeriod {
  /** ClassPeriod label, e.g. "Period 3" — '' when the school has no period grid configured. */
  period_label: string;
  status: TimetablePeriodStatus;
  is_break: boolean;
  /** A real, working period with nothing scheduled — only ever true when has_period_grid is true. */
  is_free: boolean;
}

export interface TimetableDay {
  day: string;
  day_key: string;
  is_today: boolean;
  periods: TimetableSlot[];
}

export interface TimetableKpis {
  total_periods: number;
  /** Real count of unscheduled working periods this week — 0 when has_period_grid is false, not "no free time." */
  free_periods: number;
  /** Distinct (class, section) pairs taught this week. */
  sections_taught: number;
  teaching_days: number;
}

export interface TeacherTimetable {
  week_of: string;
  days: TimetableDay[];
  kpis: TimetableKpis;
  /** false when the school hasn't configured ClassPeriod rows — free/break periods can't be inferred then. */
  has_period_grid: boolean;
}

export interface TeacherMe {
  staff_id: string;
  name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  designation: string;
  designation_id: number | null;
  department: string;
  department_id: number | null;
  photo_url: string | null;

  /** The section this teacher is class teacher of — null for subject-only teachers */
  class_teacher_for: ClassTeacherFor | null;

  /**
   * All subject+class+section assignments.
   * Grouped by subject — used to compute the home screen layout dynamically.
   */
  subject_assignments: SubjectAssignment[];

  pending_items: PendingItems;
  /** Today's period-by-period schedule from ClassRoutineSlot */
  todays_periods: TodayPeriod[];
}

// ── View config ───────────────────────────────────────────────────────────────

export type TeacherViewLayout =
  | 'single_subject_many_classes'  // Art teacher: 1 subject, many classes
  | 'multi_subject'                 // Priya: Hindi + Maths, different classes
  | 'class_teacher_primary';        // Class teacher with few subjects

/**
 * Computes how the teacher home screen should be laid out
 * based purely on the teacher's assignment data.
 *
 * No hardcoded logic per role name. Adding new roles or changing
 * assignments requires zero code change — the layout updates automatically.
 */
export function computeTeacherViewLayout(me: TeacherMe): TeacherViewLayout {
  const subjectCount = me.subject_assignments.length;
  const totalSections = me.subject_assignments.reduce(
    (sum, s) => sum + s.total_sections, 0
  );

  // Single subject across many classes (e.g. Art teacher, Class 1–10)
  if (subjectCount === 1 && totalSections > 4) {
    return 'single_subject_many_classes';
  }

  // Class teacher with 1–2 subjects — class teacher card is the primary anchor
  if (me.class_teacher_for && subjectCount <= 2) {
    return 'class_teacher_primary';
  }

  // Multiple subjects — group by subject
  return 'multi_subject';
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function teacherGet<T>(path: string): Promise<T> {
  return apiRequestWithRefresh<T>(`/api/v1/teacher${path}`, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
}

// ── Sprint 3 types ────────────────────────────────────────────────────────────

/** One class+section entry returned by GET /teacher/my-classes/ */
export interface MyClass {
  class_id: number;
  class_name: string;
  section_id: number;
  section_name: string;
  /** True when the teacher is the designated class teacher for this section */
  is_class_teacher: boolean;
  /** Subjects they teach in this section (empty when they are CT only) */
  subjects: string[];
  student_count: number;
}

/** One row in the student list returned by GET /teacher/students/ */
export interface StudentListItem {
  id: number;
  student_id: string;          // UUID string
  name: string;
  roll_no: string;
  admission_no: string;
  gender: string;
  photo_url: string | null;
  /** null until Sprint 5 (Attendance module) */
  attendance_pct: number | null;
  /** null until Sprint 6 (Results module) */
  avg_score: number | null;
}

// ── Sprint 4 types ────────────────────────────────────────────────────────────

export type ProfileTab =
  | 'overview'
  | 'academic'
  | 'attendance'
  | 'behaviour'
  | 'homework'
  | 'communication'
  | 'notes'
  | 'credentials';

export interface StudentOverview {
  id: number;
  student_id: string;
  name: string;
  roll_no: string;
  admission_no: string;
  gender: string;
  photo_url: string | null;
  date_of_birth: string | null;
  blood_group: string;
  phone: string;
  email: string;
  class_name: string;
  section_name: string;
  class_id: number | null;
  section_id: number | null;
  guardian_name: string;
  guardian_phone: string;
  guardian_relation: string;
}

export interface ExamMarkRow {
  exam_name: string;
  term: string;
  subject: string;
  obtained: number;
  full_marks: number;
  pass_marks: number;
  absent: boolean;
  exam_date: string | null;
}

export interface AttendanceRecord {
  date: string;
  status: 'P' | 'A' | 'L' | 'F' | 'H';
  label: string;
  notes: string;
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  half_day: number;
  holiday: number;
  attendance_pct: number | null;
}

export interface BehaviourRecord {
  title: string;
  point: number;
  description: string;
  assigned_by: string;
  date: string;
}

export interface StudentHomeworkRecord {
  homework_id: number | null;
  subject: string;
  description: string;
  homework_date: string | null;
  submission_date: string | null;
  marks: number | null;
  complete_status: 'C' | 'I' | 'P';
  note: string;
}

export interface StudentCommunicationRecord {
  id: number;
  from_me: boolean;
  subject: string;
  body: string;
  is_read: boolean;
  created_at: string;
}

export interface StudentProfile {
  sections_available: ProfileTab[];
  overview: StudentOverview;
  academic: { marks: ExamMarkRow[] } | null;
  attendance: { records: AttendanceRecord[]; summary: AttendanceSummary } | null;
  behaviour: { records: BehaviourRecord[]; total_points: number } | null;
  homework: StudentHomeworkRecord[];
  communication: StudentCommunicationRecord[];
  notes: null;
}

// ── API functions ─────────────────────────────────────────────────────────────

// ── /me/ cache ────────────────────────────────────────────────────────────────
// Home, Homework, Lessons, and Messages each call fetchTeacherMe() independently
// on mount (for subject_assignments / pending_items) — without this, navigating
// between them refetches the same payload every time. Short TTL (not the 5-minute
// one usePermissions uses) because pending_items.unread_messages / homework_to_review
// are notification counts that should catch up quickly, not just on next login.
const TEACHER_ME_CACHE_TTL_MS = 30 * 1000;
let _teacherMeCache: { data: TeacherMe; at: number } | null = null;

/**
 * GET /api/v1/teacher/me/
 * Returns the authenticated teacher's profile, assigned classes, and today's periods.
 * Cached for 30s — pass { force: true } to bypass (e.g. right after an action
 * that changes pending_items, like grading a submission).
 */
export function fetchTeacherMe(options?: { force?: boolean }): Promise<TeacherMe> {
  if (!options?.force && _teacherMeCache && Date.now() - _teacherMeCache.at < TEACHER_ME_CACHE_TTL_MS) {
    return Promise.resolve(_teacherMeCache.data);
  }
  return teacherGet<TeacherMe>('/me/').then((data) => {
    _teacherMeCache = { data, at: Date.now() };
    return data;
  });
}

/**
 * GET /api/v1/teacher/timetable/
 * Returns the teacher's full weekly timetable grouped by day.
 */
export function fetchTeacherTimetable(): Promise<TeacherTimetable> {
  return teacherGet<TeacherTimetable>('/timetable/');
}

/**
 * GET /api/v1/teacher/my-classes/
 * Returns all class+section pairs assigned to the teacher (as CT or subject teacher).
 * Scope-safe by construction — no params needed.
 */
export function fetchMyClasses(): Promise<MyClass[]> {
  return teacherGet<MyClass[]>('/my-classes/');
}

/**
 * GET /api/v1/teacher/students/?class_id=<id>&section_id=<id>
 * Returns the student roster for a specific class+section.
 * Throws if the teacher is not assigned to that class+section (403).
 */
export function fetchStudentList(classId: number, sectionId: number): Promise<StudentListItem[]> {
  return teacherGet<StudentListItem[]>(`/students/?class_id=${classId}&section_id=${sectionId}`);
}

/**
 * GET /api/v1/teacher/students/<pk>/
 * Returns the permission-scoped student profile.
 * sections_available[] tells the frontend exactly which tabs to render.
 * Throws 403 if the student is not in this teacher's assigned class.
 * Throws 404 if the student does not exist.
 */
export function fetchStudentProfile(studentPk: number): Promise<StudentProfile> {
  return teacherGet<StudentProfile>(`/students/${studentPk}/`);
}

// ── Sprint 5 types — Credentials ─────────────────────────────────────────────

export interface PortalAccountInfo {
  has_account: boolean;
  /** Numeric portal user id — the value to pass as recipient_id when messaging this person. */
  id?: number;
  username?: string;
  is_active?: boolean;
  last_login?: string | null;
  date_joined?: string | null;
}

export interface StudentCredentials {
  student: PortalAccountInfo;
  parent: PortalAccountInfo & {
    guardian_name?: string | null;
    guardian_relation?: string | null;
  };
}

export interface ResetPasswordResult {
  success: boolean;
  new_password: string;
  username: string;
  target: 'student' | 'parent';
}

/**
 * GET /api/v1/teacher/students/<pk>/credentials/
 * Returns portal account info for the student and their guardian.
 */
export function fetchStudentCredentials(studentPk: number): Promise<StudentCredentials> {
  return teacherGet<StudentCredentials>(`/students/${studentPk}/credentials/`);
}

/**
 * POST /api/v1/teacher/students/<pk>/reset-password/
 * Resets the portal password for the student or guardian.
 * Returns the new one-time password (requires students.manage).
 */
export function resetStudentPortalPassword(
  studentPk: number,
  target: 'student' | 'parent',
): Promise<ResetPasswordResult> {
  return apiRequestWithRefresh<ResetPasswordResult>(
    `/api/v1/teacher/students/${studentPk}/reset-password/`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
      cache: 'no-store',
    },
  );
}

// ── Sprint 6 — write helpers ──────────────────────────────────────────────────

function teacherPost<T>(path: string, body: unknown): Promise<T> {
  return apiRequestWithRefresh<T>(`/api/v1/teacher${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

function teacherPatch<T>(path: string, body: unknown): Promise<T> {
  return apiRequestWithRefresh<T>(`/api/v1/teacher${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

function teacherDelete(path: string): Promise<void> {
  return apiRequestWithRefresh<void>(`/api/v1/teacher${path}`, {
    method: 'DELETE',
    cache: 'no-store',
  });
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// ── Sprint 6 — Homework ───────────────────────────────────────────────────────

export interface HomeworkSubmissionItem {
  id: number;
  student: number;
  marks: number;
  complete_status: 'C' | 'I' | 'P';
  note: string;
  file: string | null;
}

export interface HomeworkItem {
  id: number;
  /** class_id/section_id/subject_id only — HomeworkSerializer returns raw FK ids,
   *  not names. Resolve display names client-side via resolveScopeName() against
   *  TeacherMe.subject_assignments, since a homework row's triplet is always
   *  inside the requesting teacher's own scope. */
  class_id: number;
  section_id: number | null;
  subject_id: number;
  homework_date: string;
  submission_date: string;
  evaluation_date: string | null;
  marks: number;
  description: string;
  file: string | null;
  evaluations: HomeworkSubmissionItem[];
}

export interface HomeworkFormInput {
  class_id: number;
  section_id?: number | null;
  subject_id: number;
  homework_date: string;
  submission_date: string;
  evaluation_date?: string | null;
  marks?: number;
  description: string;
  file?: string;
}

/** GET /api/v1/teacher/homework/ — homework in the teacher's subject scope. */
export function fetchHomeworkList(params?: { class_id?: number; section_id?: number; subject_id?: number }): Promise<HomeworkItem[]> {
  return teacherGet<HomeworkItem[]>(`/homework/${qs(params ?? {})}`);
}

/** GET /api/v1/teacher/homework/<id>/ */
export function fetchHomeworkDetail(id: number): Promise<HomeworkItem> {
  return teacherGet<HomeworkItem>(`/homework/${id}/`);
}

/** POST /api/v1/teacher/homework/ */
export function createHomework(payload: HomeworkFormInput): Promise<HomeworkItem> {
  return teacherPost<HomeworkItem>('/homework/', payload);
}

/** PATCH /api/v1/teacher/homework/<id>/ */
export function updateHomework(id: number, payload: Partial<HomeworkFormInput>): Promise<HomeworkItem> {
  return teacherPatch<HomeworkItem>(`/homework/${id}/`, payload);
}

/** DELETE /api/v1/teacher/homework/<id>/ — soft delete. */
export function deleteHomework(id: number): Promise<void> {
  return teacherDelete(`/homework/${id}/`);
}

/**
 * GET /api/v1/teacher/homework/<id>/submissions/
 * Returns raw student ids only (no nested name/roll_no) — resolve display
 * names client-side via fetchStudentList(classId, sectionId) for the
 * parent homework's class+section, same as the Homework list resolves
 * class/subject names via subject_assignments.
 */
export function fetchHomeworkSubmissions(homeworkId: number): Promise<HomeworkSubmissionItem[]> {
  return teacherGet<HomeworkSubmissionItem[]>(`/homework/${homeworkId}/submissions/`);
}

/** PATCH /api/v1/teacher/homework/submissions/<id>/grade/ */
export function gradeSubmission(
  submissionId: number,
  payload: { marks?: number; complete_status?: 'C' | 'I' | 'P'; note?: string },
): Promise<HomeworkSubmissionItem> {
  return teacherPatch<HomeworkSubmissionItem>(`/homework/submissions/${submissionId}/grade/`, payload);
}

// ── Sprint 6 — Lesson groups (the "Lesson" a plan belongs to) ────────────────

export interface LessonGroupItem {
  id: number;
  class_id: number;
  section_id: number | null;
  subject_id: number;
  class_name: string;
  section_name: string;
  subject_name: string;
  lesson_name: string;
  topics_done: number;
  topics_total: number;
}

/** GET /api/v1/teacher/lesson-groups/ */
export function fetchLessonGroups(params?: { class_id?: number; section_id?: number; subject_id?: number }): Promise<LessonGroupItem[]> {
  return teacherGet<LessonGroupItem[]>(`/lesson-groups/${qs(params ?? {})}`);
}

/** POST /api/v1/teacher/lesson-groups/ — titles: one or several new lesson-group names to create at once. */
export function createLessonGroups(payload: { class_id: number; section_id?: number | null; subject_id: number; lesson: string | string[] }): Promise<LessonGroupItem[]> {
  return teacherPost<LessonGroupItem[]>('/lesson-groups/', payload);
}

// ── Sprint 6 — Lesson plans ────────────────────────────────────────────────────

export type LessonWorkflowStatus = 'draft' | 'submitted' | 'under_review' | 'approved' | 'revision_requested';

export interface LessonPlanTopicItem {
  id: number;
  sub_topic_title: string;
}

export interface LessonPlanItem {
  id: number;
  class_id: number;
  section_id: number | null;
  subject_id: number;
  class_name: string;
  section_name: string;
  subject_name: string;
  lesson_detail_id: number;
  lesson_detail_name: string;
  sub_topic: string;
  teaching_method: string;
  general_objectives: string;
  previous_knowledge: string;
  video_url: string;
  note: string;
  lesson_date: string;
  completed_date: string | null;
  completed_status: string;
  workflow_status: LessonWorkflowStatus;
  teacher_name: string;
  topics: LessonPlanTopicItem[];
}

export interface LessonPlanFormInput {
  class_id: number;
  section_id?: number | null;
  subject_id: number;
  lesson_detail_id: number;
  lesson_date: string;
  sub_topic?: string;
  teaching_method?: string;
  general_objectives?: string;
  previous_knowledge?: string;
  note?: string;
  workflow_status?: LessonWorkflowStatus;
}

/** GET /api/v1/teacher/lessons/ */
export function fetchLessonPlans(params?: { class_id?: number; section_id?: number; subject_id?: number; workflow_status?: LessonWorkflowStatus }): Promise<LessonPlanItem[]> {
  return teacherGet<LessonPlanItem[]>(`/lessons/${qs(params ?? {})}`);
}

/** GET /api/v1/teacher/lessons/<id>/ */
export function fetchLessonPlanDetail(id: number): Promise<LessonPlanItem> {
  return teacherGet<LessonPlanItem>(`/lessons/${id}/`);
}

/** POST /api/v1/teacher/lessons/ */
export function createLessonPlan(payload: LessonPlanFormInput): Promise<LessonPlanItem> {
  return teacherPost<LessonPlanItem>('/lessons/', payload);
}

/** PATCH /api/v1/teacher/lessons/<id>/ */
export function updateLessonPlan(id: number, payload: Partial<LessonPlanFormInput>): Promise<LessonPlanItem> {
  return teacherPatch<LessonPlanItem>(`/lessons/${id}/`, payload);
}

// ── Sprint 7 — Notices ────────────────────────────────────────────────────────

export interface NoticeItem {
  id: number;
  title: string;
  message: string;
  notice_date: string;
  publish_on: string;
}

/** GET /api/v1/teacher/notices/ */
export function fetchTeacherNotices(): Promise<NoticeItem[]> {
  return teacherGet<NoticeItem[]>('/notices/');
}

// ── Sprint 7 — Messages ────────────────────────────────────────────────────────

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
  category: 'general' | 'alert' | 'announcement';
  is_read: boolean;
  read_at: string | null;
  delivered_at: string | null;
  created_at: string;
}

/** GET /api/v1/teacher/messages/ */
export function fetchTeacherMessages(): Promise<InAppMessageItem[]> {
  return teacherGet<InAppMessageItem[]>('/messages/');
}

/** POST /api/v1/teacher/messages/ */
export function sendTeacherMessage(payload: { recipient_id: number; subject: string; body: string; category?: 'general' | 'alert' | 'announcement' }): Promise<InAppMessageItem> {
  return teacherPost<InAppMessageItem>('/messages/', payload);
}

// ── Sprint 6 — Student Results tab ────────────────────────────────────────────

export interface StudentResultsData {
  marks: ExamMarkRow[];
}

/** GET /api/v1/teacher/students/<id>/results/ */
export function fetchStudentResults(studentPk: number): Promise<StudentResultsData> {
  return teacherGet<StudentResultsData>(`/students/${studentPk}/results/`);
}

// ── Sprint 8 — Exam Marks Entry ───────────────────────────────────────────────

/** One exam the teacher can enter marks for */
export interface TeacherExamItem {
  exam_id: number;
  exam_name: string;
  exam_type: string;
  class_id: number;
  class_name: string;
  section_id: number | null;
  section_name: string;
  subject_id: number;
  subject_name: string;
  status: 'pending' | 'submitted' | 'locked';
  /** ISO date string */
  end_date: string | null;
}

/** Mark setup column (each exam_title = one component like "Theory", "Practical") */
export interface MarkColumn {
  id: number;
  exam_title: string;
  exam_mark: string;
}

/** Per-student row for mark entry */
export interface StudentMarkRow {
  student_record_id: number;
  student: number;
  admission_no: string;
  first_name: string;
  last_name: string;
  roll_no: string;
  class: number;
  section: number | null;
  marks: Record<string, string>;
  teacher_remarks: string;
  is_absent: boolean;
  total_marks: string;
  total_gpa_point: string;
  total_gpa_grade: string;
}

export interface ExamMarksPayload {
  students: StudentMarkRow[];
  marks_entry_form: MarkColumn[];
  search_info: { exam_name: string; class_name: string; section_name: string };
  exam_id: number;
  subject_id: number;
  class_id: number;
  section_id: number | null;
}

/** GET /api/v1/teacher/exam-marks/ — exams available for mark entry */
export function fetchTeacherExamList(): Promise<TeacherExamItem[]> {
  return teacherGet<TeacherExamItem[]>('/exam-marks/');
}

/** POST /api/v1/teacher/exam-marks/students/ — load the student+marks grid */
export function fetchExamStudents(payload: {
  exam_id: number;
  class_id: number;
  section_id?: number | null;
  subject_id: number;
}): Promise<ExamMarksPayload> {
  return teacherPost<ExamMarksPayload>('/exam-marks/students/', payload);
}

/** POST /api/v1/teacher/exam-marks/save/ — save (draft) marks */
export function saveExamMarks(payload: {
  exam_id: number;
  class_id: number;
  section_id?: number | null;
  subject_id: number;
  students: Array<{
    student_record_id: number;
    marks: Record<string, string>;
    teacher_remarks?: string;
    is_absent?: boolean;
  }>;
}): Promise<{ success: boolean; saved_count: number }> {
  return teacherPost('/exam-marks/save/', payload);
}

/** POST /api/v1/teacher/exam-marks/lock/ — lock (final submit) */
export function lockExamMarks(payload: {
  exam_id: number;
  class_id: number;
  section_id?: number | null;
  subject_id: number;
}): Promise<{ success: boolean; locked_count: number }> {
  return teacherPost('/exam-marks/lock/', payload);
}

// ── Sprint 8 — Notification Bell ─────────────────────────────────────────────

export interface TeacherNotification {
  id: number;
  title: string;
  body: string;
  is_read: boolean;
  notification_type: string;
  link_url: string;
  created_at: string;
}

/** GET /api/v1/teacher/notifications/ */
export function fetchTeacherNotifications(): Promise<TeacherNotification[]> {
  return teacherGet<TeacherNotification[]>('/notifications/');
}

/** POST /api/v1/teacher/notifications/<id>/read/ */
export function markNotificationRead(id: number): Promise<{ success: boolean }> {
  return teacherPost(`/notifications/${id}/read/`, {});
}

// ── Library (My Class, My Books, Recommend a Book) ───────────────────────────
// Plain JSON from /api/v1/teacher/library/. Background reads pass { silent401: true } so a stray 401
// does not log the teacher out mid-form; actions use the default so a dead session redirects.

function libraryRequest<T>(path: string, init?: { method?: 'GET' | 'POST'; body?: unknown; silent401?: boolean }): Promise<T> {
  return apiRequestWithRefresh<T>(`/api/v1/teacher/library${path}`, {
    method: init?.method ?? 'GET',
    headers: { 'Content-Type': 'application/json' },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: 'no-store',
    silent401: init?.silent401,
  });
}

export interface LibraryOverview {
  registered: boolean;
  member: { card_no: string; is_active: boolean; borrowing_limit: number; open_loans: number; suspended: boolean } | null;
  has_class_scope: boolean;
  class_count: number;
}

export type LibraryLoanState = 'open' | 'due_today' | 'overdue';

export interface LibraryClassLoan {
  id: number;
  student_name: string;
  section_name: string;
  book_title: string;
  copy_code: string;
  due_date: string;
  days_overdue: number;
  accrued_fine: string;
  state: LibraryLoanState;
  reminded_today: boolean;
}

export interface LibraryNextSlot {
  id: number;
  date: string;
  day: string;
  period_name: string;
  start_time: string;
  end_time: string;
  room_label: string;
}

export interface LibraryClassGroup {
  school_class: number;
  class_name: string;
  section: number | null;
  section_name: string;
  next_slot: LibraryNextSlot | null;
  loans: LibraryClassLoan[];
  loan_count: number;
}

export interface LibraryMyClass {
  has_class_scope: boolean;
  today: string;
  classes: LibraryClassGroup[];
}

export type RenewBlockReason = '' | 'overdue' | 'cap' | 'hold';

export interface LibraryMyLoan {
  id: number;
  book_title: string;
  author: string;
  copy_code: string;
  issue_date: string;
  due_date: string;
  days_overdue: number;
  accrued_fine: string;
  renew_count: number;
  max_renewals: number;
  state: LibraryLoanState;
  can_renew: boolean;
  reason: RenewBlockReason;
  /** "On hold for someone else", "Renewal limit reached" or "Overdue, please return"; "" when it can be renewed. */
  reason_text: string;
}

export interface LibraryMyBooks {
  registered: boolean;
  is_active?: boolean;
  card_no?: string;
  borrowing_limit: number | null;
  open_loans: number;
  loans: LibraryMyLoan[];
}

export interface LibraryRenewResult {
  id: number;
  due_date: string;
  snapped: boolean;
  note: string;
  renew_count: number;
}

export type LibraryRequestStatus = 'pending' | 'approved' | 'rejected' | 'ordered' | 'fulfilled';

export interface LibraryBookRequestItem {
  id: number;
  title: string;
  notes: string;
  status: LibraryRequestStatus;
  review_note: string;
  reviewed_at: string | null;
  linked_book_title: string;
  created_at: string;
}

export interface LibraryBookSearchRow {
  id: number;
  title: string;
  author: string;
  edition: string;
  category_name: string;
  available_copies: number;
  total_copies: number;
  reference_only: boolean;
}

/** GET /api/v1/teacher/library/overview/ */
export function fetchLibraryOverview(silent401 = false): Promise<LibraryOverview> {
  return libraryRequest<LibraryOverview>('/overview/', { silent401 });
}

/** GET /api/v1/teacher/library/my-class/. An empty `classes` list means the teacher has no class-teacher scope. */
export function fetchLibraryMyClass(silent401 = false): Promise<LibraryMyClass> {
  return libraryRequest<LibraryMyClass>('/my-class/', { silent401 });
}

/** POST .../my-class/loans/<id>/remind/. 409 library_reminder_already_sent after the first reminder of the day. */
export function sendLibraryReminder(issueId: number): Promise<{ queued: boolean; loan: number; reminded_today: boolean }> {
  return libraryRequest(`/my-class/loans/${issueId}/remind/`, { method: 'POST', body: {} });
}

/** GET /api/v1/teacher/library/my-books/ */
export function fetchLibraryMyBooks(silent401 = false): Promise<LibraryMyBooks> {
  return libraryRequest<LibraryMyBooks>('/my-books/', { silent401 });
}

/** POST .../my-books/loans/<id>/renew/ */
export function renewLibraryLoan(issueId: number): Promise<LibraryRenewResult> {
  return libraryRequest(`/my-books/loans/${issueId}/renew/`, { method: 'POST', body: {} });
}

/** GET /api/v1/teacher/library/book-requests/ */
export function fetchLibraryBookRequests(silent401 = false): Promise<{ count: number; results: LibraryBookRequestItem[] }> {
  return libraryRequest('/book-requests/', { silent401 });
}

/** POST /api/v1/teacher/library/book-requests/. Class and section are set by the server. */
export function createLibraryBookRequest(payload: { title: string; notes?: string }): Promise<LibraryBookRequestItem> {
  return libraryRequest('/book-requests/', { method: 'POST', body: payload });
}

/** GET /api/v1/teacher/library/books/search/?q= (two or more characters). */
export function searchLibraryBooks(q: string, silent401 = true): Promise<{ count: number; results: LibraryBookSearchRow[] }> {
  return libraryRequest(`/books/search/?q=${encodeURIComponent(q)}`, { silent401 });
}

/**
 * The message to show for a failed library call. The server's text is already in plain words
 * ("This loan is already closed."); a field error (a blank title) is shown in preference to the generic line.
 */
export function libraryErrorMessage(error: unknown, fallback: string): string {
  const thrown = error as { status?: number; message?: string; details?: { error?: { message?: string }; field_errors?: Record<string, string[] | string> } };
  if (thrown?.status === 503) return 'The library is temporarily unavailable. Please try again in a few seconds.';
  const fields = thrown?.details?.field_errors;
  if (fields) {
    const first = Object.values(fields)[0];
    const text = Array.isArray(first) ? first[0] : first;
    if (text) return String(text);
  }
  const message = thrown?.details?.error?.message ?? thrown?.message;
  return message && message !== '401' ? message : fallback;
}

/** The error code of a failed library call (for example library_reminder_already_sent), or ''. */
export function libraryErrorCode(error: unknown): string {
  const thrown = error as { details?: { error?: { code?: string } } };
  return thrown?.details?.error?.code ?? '';
}

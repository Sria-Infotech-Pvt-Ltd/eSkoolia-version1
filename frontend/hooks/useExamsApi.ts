/**
 * Examination module API hooks — uses the project's existing apiRequestWithRefresh
 * pattern (see hooks/useHrApi.ts for the template this mirrors).
 */
import { useCallback, useEffect, useState } from "react";
import { apiRequestWithRefresh, apiRequestWithRefreshResponse } from "@/lib/api-auth";
import type {
  AdmitCardSetting,
  ClassOption,
  CommandCenterSummary,
  ExamAttendanceCriteria,
  ExamAttendanceStudentRow,
  ExamGradeScaleGroup,
  ExamGradeScale,
  ExamMarkRegisterRow,
  ExamMarksProgressSummary,
  ExamPlanStudentRecord,
  ExamResultPublish,
  ExamResultPublishSearchResponse,
  ExamRoutineRow,
  ExamScheduleCriteria,
  ExamSetupCriteria,
  ExamSetupSearchResponse,
  ExamType,
  ExamTypeOption,
  HolidayItem,
  MeritListRow,
  ModerationFlag,
  OnlineExamIndexResponse,
  PaginatedExams,
  ReportCardSetting,
  RoomOption,
  SeatPlanSetting,
  SectionOption,
  StudentReportResponse,
  SubjectOption,
} from "@/types/exams";

const BASE = "/api/v1/exams";

// ─── Generic fetch hook (same shape as useHrApi.ts::useFetch) ────────────────
function useFetch<T>(url: string, deps: unknown[] = [], fetchOptions?: { silent401?: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!url) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequestWithRefresh<T>(url, { method: "GET", silent401: fetchOptions?.silent401 });
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [url, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchData(); }, [fetchData]);
  return { data, loading, error, refetch: fetchData };
}

export class ExamsApiError extends Error {
  errors?: Record<string, unknown>;
  constructor(message: string, errors?: Record<string, unknown>) {
    super(message);
    this.name = "ExamsApiError";
    this.errors = errors;
  }
}

async function throwExamsApiError(res: Response): Promise<never> {
  const text = await res.text();
  let message = text || `Request failed (${res.status})`;
  let errors: Record<string, unknown> | undefined;
  try {
    const parsed = JSON.parse(text) as { message?: string; detail?: string; errors?: Record<string, unknown>; field_errors?: Record<string, unknown> };
    if (parsed && typeof parsed === "object") {
      if (parsed.message) message = parsed.message;
      else if (parsed.detail) message = parsed.detail;
      const fieldErrors = parsed.errors ?? parsed.field_errors;
      if (fieldErrors) {
        errors = fieldErrors;
        if (message === text) {
          const firstKey = Object.keys(fieldErrors)[0];
          const firstVal = fieldErrors[firstKey];
          const firstMsg = Array.isArray(firstVal) ? firstVal[0] : firstVal;
          if (typeof firstMsg === "string") message = firstMsg;
        }
      }
    }
  } catch {
    // Response wasn't JSON — fall back to the raw text as the message.
  }
  throw new ExamsApiError(message, errors);
}

async function postJson<T>(path: string, body: unknown, method: "POST" | "PUT" | "PATCH" = "POST"): Promise<T> {
  const res = await apiRequestWithRefreshResponse(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) await throwExamsApiError(res);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function deleteRequest(path: string): Promise<void> {
  const res = await apiRequestWithRefreshResponse(`${BASE}${path}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) await throwExamsApiError(res);
}

// ─── Exam Configuration ───────────────────────────────────────────────────────
export function useExamTypes() {
  return useFetch<PaginatedExams<ExamType>>(`${BASE}/types/?page_size=200`);
}

export async function createExamType(body: Partial<ExamType>) {
  return postJson<ExamType>("/types/", body);
}

export async function updateExamType(id: number, body: Partial<ExamType>) {
  return postJson<ExamType>(`/types/${id}/`, body, "PATCH");
}

export async function deleteExamType(id: number) {
  return deleteRequest(`/types/${id}/`);
}

export function useExamGradeScaleGroups() {
  return useFetch<PaginatedExams<ExamGradeScaleGroup>>(`${BASE}/grade-scale-groups/?page_size=200`);
}

export async function createGradeScaleGroup(body: Partial<ExamGradeScaleGroup>) {
  return postJson<ExamGradeScaleGroup>("/grade-scale-groups/", body);
}

export async function updateGradeScaleGroup(id: number, body: Partial<ExamGradeScaleGroup>) {
  return postJson<ExamGradeScaleGroup>(`/grade-scale-groups/${id}/`, body, "PATCH");
}

export async function deleteGradeScaleGroup(id: number) {
  return deleteRequest(`/grade-scale-groups/${id}/`);
}

export function useExamGradeScaleBands(groupId: number | null) {
  return useFetch<PaginatedExams<ExamGradeScale>>(
    groupId ? `${BASE}/grade-scales/?group=${groupId}&page_size=200` : "",
    [groupId],
  );
}

export async function createGradeScaleBand(body: Partial<ExamGradeScale>) {
  return postJson<ExamGradeScale>("/grade-scales/", body);
}

export async function updateGradeScaleBand(id: number, body: Partial<ExamGradeScale>) {
  return postJson<ExamGradeScale>(`/grade-scales/${id}/`, body, "PATCH");
}

export async function deleteGradeScaleBand(id: number) {
  return deleteRequest(`/grade-scales/${id}/`);
}

// ─── Exam Setup ───────────────────────────────────────────────────────────────
export function useExamSetupCriteria() {
  return useFetch<ExamSetupCriteria>(`${BASE}/exam-setup/index/`);
}

export async function searchExamSetup(params: {
  class_id: number; section: number; subject: number; exam_term_id: number;
}): Promise<ExamSetupSearchResponse> {
  const q = new URLSearchParams({
    class: String(params.class_id),
    section: String(params.section),
    subject: String(params.subject),
    exam_term_id: String(params.exam_term_id),
  });
  return apiRequestWithRefresh<ExamSetupSearchResponse>(`${BASE}/exam-setup/search/?${q.toString()}`, { method: "GET" });
}

export async function storeExamSetup(payload: {
  class_id: number; section: number; subject: number; exam_term_id: number;
  total_exam_mark: string; totalMark: string; exam_title: string[]; exam_mark: string[];
}) {
  return postJson<{ message: string }>("/exam-setup/store/", payload);
}

export async function cloneExamSetup(payload: {
  from_exam_term_id: number; to_exam_term_id: number; class_id: number; section: number; subject?: number;
}) {
  return postJson<{ message: string; cloned_count: number }>("/exam-setup/clone/", payload);
}

export function useExamSetupSubjectsByClass(classId: number | null) {
  return useFetch<SubjectOption[]>(classId ? `${BASE}/exam-setup/subjects/?class_id=${classId}` : "", [classId]);
}

export interface ExamSetupAnalyticsRow {
  class_id: number;
  class_name: string;
  section_id: number;
  section_name: string;
  student_count: number;
  has_teacher: boolean;
}

export function useExamSetupAnalytics() {
  return useFetch<ExamSetupAnalyticsRow[]>(`${BASE}/exam-setup/analytics/`);
}

export interface ConfiguredExamRow {
  id: number;
  exam_name: string;
  classes: string;
  status: string;
  class_ids: number[];
}

export async function fetchConfiguredExams() {
  return apiRequestWithRefresh<{ items: ConfiguredExamRow[] }>(`${BASE}/exam-setup/list/`, { method: "GET" });
}

export async function deleteExamSetup(examTermId: number) {
  return deleteRequest(`/exam-setup/delete/${examTermId}/`);
}

export async function openExamForMarksEntry(examTermId: number) {
  return postJson<{ detail?: string }>("/exam-open-marks-entry/", { exam_term_id: examTermId });
}

// ─── Schedule & Logistics ─────────────────────────────────────────────────────
export function useExamScheduleCriteria() {
  return useFetch<ExamScheduleCriteria>(`${BASE}/exam-schedule/index/`);
}

export function useExamHolidays(month?: number, year?: number) {
  const q = month && year ? `?month=${month}&year=${year}` : "";
  return useFetch<HolidayItem[]>(`${BASE}/holidays/${q}`, [month, year]);
}

export function useExamRooms() {
  return useFetch<RoomOption[]>(`${BASE}/exam-rooms/`);
}

export interface ExamRoutineFilters {
  date: string; exam_type_id?: number; class_id?: number; section_id?: number; room_id?: number;
}

export function useExamRoutines(filters: ExamRoutineFilters) {
  const q = new URLSearchParams({ date: filters.date });
  if (filters.exam_type_id) q.set("exam_type_id", String(filters.exam_type_id));
  if (filters.class_id) q.set("class_id", String(filters.class_id));
  if (filters.section_id) q.set("section_id", String(filters.section_id));
  if (filters.room_id) q.set("room_id", String(filters.room_id));
  return useFetch<ExamRoutineRow[]>(
    filters.date ? `${BASE}/exam-command-center/?${q.toString()}` : "",
    [filters.date, filters.exam_type_id, filters.class_id, filters.section_id, filters.room_id],
  );
}

export interface ExamRoutinePayload {
  exam_type_id: number; class_id: number; section_id?: number | null; subject: number;
  teacher_id?: number | null; period?: number | null; exam_date: string;
  start_time: string; end_time: string; room?: string; room_id?: number | null;
}

export async function createExamRoutine(payload: ExamRoutinePayload) {
  return postJson<ExamRoutineRow>("/exam-command-center/", payload);
}

export async function updateExamRoutine(id: number, payload: ExamRoutinePayload) {
  return postJson<ExamRoutineRow>(`/exam-command-center/${id}/`, payload, "PUT");
}

export async function deleteExamRoutine(id: number) {
  return deleteRequest(`/exam-command-center/${id}/`);
}

export function useAdmitCardSetting() {
  return useFetch<{ setting: AdmitCardSetting }>(`${BASE}/exam-plan/admit-card/setting/`);
}

export async function saveAdmitCardSetting(body: Partial<AdmitCardSetting>) {
  return postJson<{ message: string; setting: AdmitCardSetting }>("/exam-plan/admit-card/setting/", body);
}

export function useAdmitCardIndex() {
  return useFetch<{ exams: ExamTypeOption[]; classes: ClassOption[]; sections: SectionOption[] }>(
    `${BASE}/exam-plan/admit-card/`,
  );
}

export async function searchAdmitCard(payload: { exam: number; class_id: number; section: number }) {
  return postJson<{ exam_id: number; class_id: number; section_id: number; records: ExamPlanStudentRecord[]; old_admit_ids: number[] }>(
    "/exam-plan/admit-card/search/",
    payload,
  );
}

export async function generateAdmitCard(exam_type_id: number, data: Record<string, unknown>) {
  return postJson<{ message: string; created_count: number }>("/exam-plan/admit-card/generate/", { exam_type_id, data });
}

export function useSeatPlanSetting() {
  return useFetch<{ setting: SeatPlanSetting }>(`${BASE}/exam-plan/seat-plan/setting/`);
}

export async function saveSeatPlanSetting(body: Partial<SeatPlanSetting>) {
  return postJson<{ message: string; setting: SeatPlanSetting }>("/exam-plan/seat-plan/setting/", body);
}

export function useSeatPlanIndex() {
  return useFetch<{ exams: ExamTypeOption[]; classes: ClassOption[]; sections: SectionOption[] }>(
    `${BASE}/exam-plan/seat-plan/`,
  );
}

export async function searchSeatPlan(payload: { exam: number; class_id: number; section: number }) {
  return postJson<{ exam_id: number; class_id: number; section_id: number; records: ExamPlanStudentRecord[]; seat_plan_ids: number[] }>(
    "/exam-plan/seat-plan/search/",
    payload,
  );
}

export async function generateSeatPlan(exam_type_id: number, data: Record<string, unknown>) {
  return postJson<{ message: string; created_count: number }>("/exam-plan/seat-plan/generate/", { exam_type_id, data });
}

export function useOnlineExamIndex() {
  return useFetch<OnlineExamIndexResponse>(`${BASE}/online-exam/`);
}

export interface OnlineExamPayload {
  title: string;
  class_id: number;
  section: number[];
  subject: number;
  date: string;
  start_time: string;
  end_time: string;
  percentage?: string;
  instruction?: string;
  auto_mark: boolean;
}

export async function createOnlineExam(payload: OnlineExamPayload) {
  return postJson<{ message: string }>("/online-exam/store/", payload);
}

export async function updateOnlineExam(payload: OnlineExamPayload & { id: number }) {
  return postJson<{ message: string }>("/online-exam/update/", payload);
}

export async function deleteOnlineExam(id: number) {
  return postJson<{ message: string }>("/online-exam/delete/", { id });
}

export async function publishOnlineExam(id: number) {
  return apiRequestWithRefresh<{ message: string }>(`${BASE}/online-exam/publish/${id}/`, { method: "GET" });
}

export async function cancelPublishOnlineExam(id: number) {
  return apiRequestWithRefresh<{ message: string }>(`${BASE}/online-exam/publish-cancel/${id}/`, { method: "GET" });
}

// ─── Conduct & Marks ──────────────────────────────────────────────────────────
export function useExamAttendanceCriteria() {
  return useFetch<ExamAttendanceCriteria>(`${BASE}/exam-attendance/index/`);
}

export async function searchExamAttendanceCreate(payload: {
  exam: number; subject: number; class_id: number; section?: number; exam_date?: string;
}) {
  return postJson<{ students: ExamAttendanceStudentRow[]; search_info: Record<string, string> }>(
    "/exam-attendance/create-search/",
    { exam: payload.exam, subject: payload.subject, class_id: payload.class_id, section: payload.section, exam_date: payload.exam_date },
  );
}

export async function storeExamAttendance(payload: {
  exam_id: number; subject_id: number; class_id: number; section_id?: number | null;
  attendance: Record<string, { student: number; class?: number; section?: number; attendance_type: "P" | "A" }>;
}) {
  return postJson<{ message: string }>("/exam-attendance/store/", payload);
}

export async function searchExamAttendanceReport(payload: { exam: number; subject: number; class_id: number; section?: number }) {
  return postJson<{ exam_attendance_childs: ExamAttendanceStudentRow[] }>(
    "/exam-attendance/report-search/",
    { exam: payload.exam, subject: payload.subject, class_id: payload.class_id, section: payload.section },
  );
}

export function useExamMarksProgress(examId: number | null, classId?: number, sectionId?: number) {
  const q = new URLSearchParams();
  if (examId) q.set("exam", String(examId));
  if (classId) q.set("class_id", String(classId));
  if (sectionId) q.set("section", String(sectionId));
  return useFetch<ExamMarksProgressSummary>(examId ? `${BASE}/exam-marks/progress-summary/?${q.toString()}` : "", [examId, classId, sectionId]);
}

export async function searchExamMarksReport(payload: { exam: number; subject: number; class_id: number; section?: number }) {
  return postJson<{ marks_registers: ExamMarkRegisterRow[]; marks_entry_form: { id: number; exam_title: string; exam_mark: string }[]; search_info: Record<string, string> }>(
    "/exam-marks/report-search/",
    { exam: payload.exam, subject: payload.subject, class_id: payload.class_id, section: payload.section },
  );
}

export async function searchExamMarksCreate(payload: { exam: number; subject: number; class_id: number; section?: number }) {
  return postJson<{ students: unknown[]; marks_entry_form: { id: number; exam_title: string; exam_mark: string }[]; search_info: Record<string, string> }>(
    "/exam-marks/create-search/",
    { exam: payload.exam, subject: payload.subject, class_id: payload.class_id, section: payload.section },
  );
}

export async function storeExamMarks(payload: {
  exam_id: number; class_id: number; section_id?: number | null; subject_id: number; markStore: Record<string, unknown>;
}) {
  return postJson<{ message: string }>("/exam-marks/store/", payload);
}

// ─── Results & Reports ─────────────────────────────────────────────────────────
export function useExamResultPublishCriteria() {
  return useFetch<{ exams: ExamTypeOption[]; classes: ClassOption[]; sections: SectionOption[] }>(
    `${BASE}/exam-result-publish/index/`,
  );
}

export async function searchExamResultPublish(payload: { exam: number; class_id: number; section?: number }) {
  return postJson<ExamResultPublishSearchResponse>("/exam-result-publish/search/", {
    exam: payload.exam,
    class_id: payload.class_id,
    section: payload.section,
  });
}

export async function storeExamResultPublish(payload: { exam_id: number; class_id: number; section_id?: number | null }) {
  return postJson<{ message: string }>("/exam-result-publish/store/", payload);
}

export async function signoffExamResultPublish(payload: { exam_id: number; class_id: number; section_id?: number | null }) {
  return postJson<ExamResultPublish>("/exam-result-publish/signoff/", payload);
}

export function useReportCardSetting() {
  return useFetch<{ setting: ReportCardSetting }>(`${BASE}/exam-result-publish/report-card-setting/`);
}

export async function saveReportCardSetting(body: Partial<ReportCardSetting>) {
  return postJson<{ message: string; setting: ReportCardSetting }>("/exam-result-publish/report-card-setting/", body);
}

export interface ModerationFlagFilters {
  exam_term?: number; school_class?: number; section?: number; status?: string;
}

export function useModerationFlags(filters: ModerationFlagFilters = {}) {
  const q = new URLSearchParams({ page_size: "100" });
  if (filters.exam_term) q.set("exam_term", String(filters.exam_term));
  if (filters.school_class) q.set("school_class", String(filters.school_class));
  if (filters.section) q.set("section", String(filters.section));
  if (filters.status) q.set("status", filters.status);
  return useFetch<PaginatedExams<ModerationFlag>>(
    `${BASE}/result-publish-moderation-flags/?${q.toString()}`,
    [filters.exam_term, filters.school_class, filters.section, filters.status],
  );
}

export async function approveModerationFlag(id: number) {
  return postJson<ModerationFlag>(`/result-publish-moderation-flags/${id}/approve/`, {});
}

export async function rejectModerationFlag(id: number) {
  return postJson<ModerationFlag>(`/result-publish-moderation-flags/${id}/reject/`, {});
}

export function useExamReportIndex() {
  return useFetch<{ exams: ExamTypeOption[]; classes: ClassOption[]; sections: SectionOption[]; students: ExamPlanStudentRecord[] }>(
    `${BASE}/exam-report/index/`,
  );
}

export async function searchExamMerit(payload: { exam: number; class_id: number; section?: number }) {
  return postJson<{ search_info: Record<string, string>; merit_list: MeritListRow[] }>(
    "/exam-report/merit-search/",
    { exam: payload.exam, class_id: payload.class_id, section: payload.section },
  );
}

export async function searchExamStudentReport(payload: { exam: number; class_id: number; section?: number; student: number }) {
  return postJson<StudentReportResponse>("/exam-report/student-search/", {
    exam: payload.exam,
    class_id: payload.class_id,
    section: payload.section,
    student: payload.student,
  });
}

// ─── Command Center ───────────────────────────────────────────────────────────
export function useExamCommandCenterSummary() {
  return useFetch<CommandCenterSummary>(`${BASE}/exam-command-center/summary/`);
}

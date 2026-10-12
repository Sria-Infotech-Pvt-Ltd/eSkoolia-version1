/**
 * Phase 3 state operations: student allocation, boarding registers and alerts
 * (Master Prompt §7.7, §7.8, §7.10). Pure functions over the shared store.
 */
import { nextIdFrom } from "./ids";
import type { TransportData } from "./mock";
import type { AlertSeverity, AlertType, AllocationStatus, AttendanceEntry, AttendanceShift, Student, TransportAlert } from "./types";

// ─── Allocation ──────────────────────────────────────────────────────────────

export function allocateStudents(state: TransportData, ids: string[], routeCode: string, stopId: string): TransportData {
  const route = state.routes.find((r) => r.code === routeCode);
  const stop = route?.stops.find((s) => s.id === stopId);
  if (!route || !stop) return state;
  const set = new Set(ids);
  return {
    ...state,
    students: state.students.map((s) => (set.has(s.id)
      ? { ...s, status: "Allocated", routeCode, stopId, busReg: route.busReg, fare: stop.fare }
      : s)),
  };
}

export function updateAllocation(state: TransportData, id: string, routeCode: string, stopId: string, status: AllocationStatus): TransportData {
  if (status === "Allocated") return allocateStudents(state, [id], routeCode, stopId);
  return {
    ...state,
    students: state.students.map((s) => (s.id === id ? { ...s, status, routeCode: null, stopId: null, busReg: null, fare: 0 } : s)),
  };
}

export function removeFromTransport(state: TransportData, ids: string[]): TransportData {
  const set = new Set(ids);
  return {
    ...state,
    students: state.students.map((s) => (set.has(s.id) ? { ...s, status: "Pending", routeCode: null, stopId: null, busReg: null, fare: 0 } : s)),
  };
}

// ─── Boarding registers ──────────────────────────────────────────────────────

export const REGISTER_DATES = [
  { idx: 0, label: "06 Oct 2026 · Today", date: "06 Oct 2026" },
  { idx: 1, label: "05 Oct 2026 · Mon", date: "05 Oct 2026" },
  { idx: 2, label: "03 Oct 2026 · Sat", date: "03 Oct 2026" },
  { idx: 3, label: "01 Oct 2026 · Thu", date: "01 Oct 2026" },
];

export function registerKey(shift: AttendanceShift, dateIdx: number): string {
  return `${shift}|${dateIdx}`;
}

/** Today's morning register forces these five R3 students to not boarded (§7.8). */
const FORCED_NO_SHOW = new Set([3, 12, 21, 30, 39].map((k) => 2 + k * 9));

/** Deterministic register line: seed = dateIdx, h = (i*37 + seed*13 + (afternoon?7:0)) % 100. */
export function generatedEntry(student: Student, shift: AttendanceShift, dateIdx: number): AttendanceEntry {
  const i = Number(student.id.replace(/\D/g, "")) - 1000;
  const h = (i * 37 + dateIdx * 13 + (shift === "afternoon" ? 7 : 0)) % 100;
  if (shift === "morning" && dateIdx === 0 && FORCED_NO_SHOW.has(i)) return { boarded: false, late: false };
  return {
    boarded: h >= 4,
    late: h >= 4 && h < 9,
    ...(h === 50 ? { note: "Parent will drop directly today" } : {}),
  };
}

export function entryFor(state: TransportData, student: Student, shift: AttendanceShift, dateIdx: number): AttendanceEntry {
  return state.attendance[registerKey(shift, dateIdx)]?.[student.id] ?? generatedEntry(student, shift, dateIdx);
}

/** Writes full entries for the given students; past-date edits are appended to the change log. */
export function setAttendance(
  state: TransportData, shift: AttendanceShift, dateIdx: number, entries: Record<string, AttendanceEntry>, change: string,
): TransportData {
  const key = registerKey(shift, dateIdx);
  const attendance = { ...state.attendance, [key]: { ...(state.attendance[key] ?? {}), ...entries } };
  const attendanceLog = dateIdx > 0
    ? [...state.attendanceLog, { key, studentIds: Object.keys(entries), change }]
    : state.attendanceLog;
  return { ...state, attendance, attendanceLog };
}

// ─── Alerts ──────────────────────────────────────────────────────────────────

export function acknowledgeAlerts(state: TransportData, ids: string[], owner: string): TransportData {
  const set = new Set(ids);
  return { ...state, alerts: state.alerts.map((a) => (set.has(a.id) && a.state === "open" ? { ...a, state: "acknowledged", owner } : a)) };
}

export function resolveAlerts(state: TransportData, ids: string[], owner: string): TransportData {
  const set = new Set(ids);
  return { ...state, alerts: state.alerts.map((a) => (set.has(a.id) && a.state !== "resolved" ? { ...a, state: "resolved", owner: a.owner ?? owner } : a)) };
}

export interface RaiseAlertInput {
  title: string; type: AlertType; severity: AlertSeverity; routeCode: string; detail: string;
  state: TransportAlert["state"]; owner?: string;
}

/** Prepends a new alert (AL-54NN continues the sequence). */
export function raiseAlert(state: TransportData, input: RaiseAlertInput): TransportData {
  const alert: TransportAlert = { id: nextAlertId(state), ageMin: 0, ...input };
  return { ...state, alerts: [alert, ...state.alerts] };
}

export function nextAlertId(state: TransportData): string {
  return nextIdFrom(state.alerts.map((a) => a.id), "AL-", 4);
}

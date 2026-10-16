/** Fixed Transport vocabularies and small lookups shared by the screens (no records). */
import type { ShiftGroup, TransportRoute, Vehicle, VehicleStatus, VehicleType } from "./types";

export const VEHICLE_TYPES: VehicleType[] = ["Bus · 42-seater", "Mini-bus · 26-seater", "Van · 12-seater"];
export const VEHICLE_STATUSES: VehicleStatus[] = ["On route", "Active", "Idle", "Under maintenance", "Breakdown"];

/** Default seats per vehicle type (backend DEFAULT_CAPACITY_BY_TYPE). */
export const CAPACITY_BY_TYPE: Record<VehicleType, number> = {
  "Bus · 42-seater": 42,
  "Mini-bus · 26-seater": 26,
  "Van · 12-seater": 12,
};

/** Seats on a vehicle: its recorded capacity, else the default for its type. */
export function capacityOf(v: Pick<Vehicle, "type"> & Partial<Pick<Vehicle, "capacity">>): number {
  return v.capacity || CAPACITY_BY_TYPE[v.type];
}

export const SHIFT_LABELS: Record<ShiftGroup, string> = {
  "Full day": "Full day · morning + afternoon",
  "Morning only": "Morning shift only",
  "Relief & reserve": "Relief & reserve",
};

/** Natural sort for class names from the Students module ("LKG", "Class 2", "10"). */
export function sortClasses(names: string[]): string[] {
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

/** "Class 4" for a bare number, otherwise the school's own class name; "No class" when unset. */
export function classLabel(cls: string): string {
  if (!cls) return "No class";
  return /^\d+$/.test(cls) ? `Class ${cls}` : cls;
}

/** "Class 4-A · Roll 12" style subtitle, leaving out what is not recorded. */
export function classLine(s: { cls: string; section: string; roll?: string }): string {
  const cls = s.cls ? `${classLabel(s.cls)}${s.section ? `-${s.section}` : ""}` : "No class";
  return s.roll ? `${cls} · Roll ${s.roll}` : cls;
}

/** "R3 · Madhapur" */
export function routeLabel(routes: TransportRoute[], code: string | null): string {
  if (!code) return "Unassigned";
  const r = routes.find((x) => x.code === code);
  return r ? `${r.code} · ${r.name}` : code;
}

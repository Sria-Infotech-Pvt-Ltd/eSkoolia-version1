/** Seeds the full Transport mock dataset for all 14 screens (Master Prompt §6). */
import { seedAlerts } from "./alerts";
import { DASHBOARD_STATIC, RECENT_REPORTS, REPORTS, SETTINGS_DEFAULTS } from "./catalogue";
import { seedRoutes } from "./routes";
import { seedAttendants, seedDrivers } from "./staff";
import { seedStudents } from "./students";
import { seedFuel, seedMaintenance } from "./upkeep";
import { seedVehicles } from "./vehicles";
import type {
  AttendanceEntry, Attendant, DashboardStatic, Driver, FuelEntry, GeneratedReport, ReportDef, ServiceRecord, Student,
  TransportAlert, TransportRoute, TransportSettings, Vehicle,
} from "../types";

export interface TransportData {
  routes: TransportRoute[];
  vehicles: Vehicle[];
  drivers: Driver[];
  attendants: Attendant[];
  students: Student[];
  alerts: TransportAlert[];
  maintenance: ServiceRecord[];
  fuel: FuelEntry[];
  reports: ReportDef[];
  recentReports: GeneratedReport[];
  settings: TransportSettings;
  dashboard: DashboardStatic;
  /** Last issued route-stop number (S70 / PP-070); new stops continue the sequence. */
  stopCounter: number;
  /** Routes removed via "Archive route" (kept for reference, hidden everywhere). */
  archivedRoutes: TransportRoute[];
  /** Register edits per "shift|dateIdx" → studentId; untouched lines are generated deterministically. */
  attendance: Record<string, Record<string, AttendanceEntry>>;
  /** Edits made on past-date registers (§7.8: "edits are logged"). */
  attendanceLog: { key: string; studentIds: string[]; change: string }[];
  /** Alert count open at seed time — the Dashboard figure moves by the delta from this. */
  seedOpenAlerts: number;
}

export function seedTransportData(): TransportData {
  const routes = seedRoutes();
  const drivers = seedDrivers();
  const attendants = seedAttendants(routes);
  const vehicles = seedVehicles(drivers);
  return {
    routes,
    vehicles,
    drivers,
    attendants,
    students: seedStudents(routes),
    alerts: seedAlerts(),
    maintenance: seedMaintenance(vehicles),
    fuel: seedFuel(vehicles),
    reports: REPORTS.map((r) => ({ ...r })),
    recentReports: RECENT_REPORTS.map((r) => ({ ...r })),
    settings: structuredClone(SETTINGS_DEFAULTS),
    dashboard: structuredClone(DASHBOARD_STATIC),
    stopCounter: routes.reduce((s, r) => s + r.stops.length, 0),
    archivedRoutes: [],
    attendance: {},
    attendanceLog: [],
    seedOpenAlerts: seedAlerts().filter((a) => a.state !== "resolved").length,
  };
}

export { routeLabel, stopPoint } from "./routes";
export { CAPACITY_BY_TYPE, VEHICLE_STATUSES, VEHICLE_TYPES, capacityOf } from "./vehicles";
export { SHIFT_LABELS } from "./staff";
export { FLEET_KML_TREND } from "./upkeep";

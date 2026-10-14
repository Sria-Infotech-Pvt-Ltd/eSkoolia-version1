/**
 * Transport API client: loads every Transport screen's data from the backend
 * (/api/v1/core/...) and maps it onto the screen types in ./types.
 *
 * Nothing here is invented. Values the backend does not hold yet are null / ""
 * and the screens show "—": trips per staff member, a stop's missing schedule
 * time, a school location that was never set.
 */
import { apiRequestWithRefresh } from "@/lib/api-auth";
import { minutesOf, pad, TODAY, toISO } from "./format";
import type {
  AlertSeverity, AlertState, AlertType, AllocationStatus, Attendant, AttendanceEntry, AttendanceShift,
  DashboardSummary, Driver, FuelEntry, FuelSummary, GeneratedReport, ReportDef, RouteShift, RouteStop,
  ServiceRecord, ServiceStatus, ShiftGroup, StaffStatus, Student, TransportAlert, TransportRoute,
  TransportSettings, Vehicle, VehicleDoc, VehicleStatus, VehicleType,
} from "./types";

export const BASE = "/api/v1/core";

type Raw = Record<string, any>;

// ─── HTTP ────────────────────────────────────────────────────────────────────

export function tget<T = any>(path: string): Promise<T> {
  return apiRequestWithRefresh<T>(`${BASE}${path}`, { silent401: true });
}

export function tsend<T = any>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return apiRequestWithRefresh<T>(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Every row of a (paginated) list endpoint. */
export async function tlist<T = Raw>(path: string): Promise<T[]> {
  const sep = path.includes("?") ? "&" : "?";
  const body = await tget<any>(`${path}${sep}page_size=10000`);
  if (Array.isArray(body)) return body as T[];
  return (body?.results ?? []) as T[];
}

// ─── Ids ─────────────────────────────────────────────────────────────────────

/** Backend pk from a screen id ("VH-012" → 12, "S45" → 45). */
export function pkOf(id: string | null | undefined): number {
  return Number(String(id ?? "").replace(/\D/g, "")) || 0;
}

export const ids = {
  vehicle: (pk: number) => `VH-${pad(pk, 3)}`,
  stop: (pk: number) => `S${pk}`,
  driver: (pk: number) => `DR-${pad(pk, 3)}`,
  attendant: (pk: number) => `AT-${pad(pk, 3)}`,
  student: (pk: number) => `ST${pk}`,
  alert: (pk: number) => `AL-${pad(pk, 4)}`,
  service: (pk: number) => `SV-${pad(pk, 4)}`,
  fuel: (pk: number) => `FL-${pad(pk, 4)}`,
};

/** Route code shown on screens; routes without a code get RT<pk>. */
export function routeCodeOf(route: { id: number; code?: string | null }): string {
  return (route.code || "").trim() || `RT${route.id}`;
}

// ─── Enum maps (backend value ↔ screen label) ────────────────────────────────

export const VEHICLE_TYPE: Record<string, VehicleType> = { bus: "Bus · 42-seater", mini_bus: "Mini-bus · 26-seater", van: "Van · 12-seater" };
export const VEHICLE_STATUS: Record<string, VehicleStatus> = {
  on_route: "On route", active: "Active", idle: "Idle", under_maintenance: "Under maintenance", breakdown: "Breakdown",
};
export const DOC_FIELD: Record<VehicleDoc, string> = {
  "Fitness certificate": "fitness_valid_till", Insurance: "insurance_valid_till",
  "Road permit": "permit_valid_till", "Pollution (PUC)": "pollution_valid_till",
};
export const ROUTE_SHIFT: Record<string, RouteShift> = { both: "Morning + afternoon", morning: "Morning only", afternoon: "Afternoon only" };
export const STAFF_SHIFT: Record<string, ShiftGroup> = { full_day: "Full day", morning: "Morning only", relief: "Relief & reserve" };
export const STAFF_STATUS: Record<string, StaffStatus> = {
  on_duty: "On duty", on_route: "On route", off_duty: "Off duty", on_leave: "On leave", inactive: "Inactive",
};
export const ALLOCATION_STATUS: Record<string, AllocationStatus> = { allocated: "Allocated", pending: "Pending", waitlisted: "Waitlisted" };
const ALERT_TYPE: Record<string, AlertType> = {
  sos: "SOS", overspeed: "Overspeed", breakdown: "Breakdown", mechanical: "Breakdown",
  running_late: "Late arrival", traffic: "Late arrival", stopped: "Late arrival",
  route_deviation: "Route deviation", document_expiry: "Document expiry",
};
export const ALERT_TYPE_VALUE: Record<AlertType, string> = {
  SOS: "sos", Overspeed: "overspeed", Breakdown: "breakdown", "Late arrival": "running_late",
  "Route deviation": "route_deviation", "Document expiry": "document_expiry",
};
const SEVERITY: Record<string, AlertSeverity> = { critical: "Critical", warning: "Warning", info: "Info" };
const SERVICE_STATUS: Record<string, ServiceStatus> = {
  completed: "Completed", overdue: "Overdue", in_workshop: "In workshop", due_soon: "Due soon", scheduled: "Scheduled",
};
const REPORT_ICON: Record<string, ReportDef["icon"]> = {
  "route-strength": "Users", "vehicle-utilisation": "Car", "fee-collection": "FileBarChart",
  "driver-roster": "IdCard", "boarding-register": "ClipboardCheck", "fuel-maintenance-cost": "Fuel",
};

export function invert<K extends string, V extends string>(map: Record<K, V>): Record<V, K> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k])) as Record<V, K>;
}

const num = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const hhmm = (v: unknown): string => (typeof v === "string" && v.length >= 5 ? v.slice(0, 5) : "");
const name = (first?: string, last?: string) => `${first ?? ""} ${last ?? ""}`.trim();

// ─── Geometry for the SVG maps (viewBox 600×480, school at 300,240) ──────────

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface Projection { x: (lat: number, lng: number) => number; y: (lat: number, lng: number) => number }

/** Centre on the school (or the stops' centroid when its location is not set) and fit every stop. */
export function makeProjection(points: { lat: number; lng: number }[], school: { lat: number | null; lng: number | null }): Projection {
  const centre = school.lat !== null && school.lng !== null
    ? { lat: school.lat, lng: school.lng }
    : points.length
      ? { lat: points.reduce((s, p) => s + p.lat, 0) / points.length, lng: points.reduce((s, p) => s + p.lng, 0) / points.length }
      : { lat: 0, lng: 0 };
  const cos = Math.cos((centre.lat * Math.PI) / 180) || 1;
  const maxDx = Math.max(1e-6, ...points.map((p) => Math.abs((p.lng - centre.lng) * cos)));
  const maxDy = Math.max(1e-6, ...points.map((p) => Math.abs(p.lat - centre.lat)));
  const scale = Math.min(270 / maxDx, 210 / maxDy);
  return {
    x: (_lat, lng) => 300 + (lng - centre.lng) * cos * scale,
    y: (lat) => 240 - (lat - centre.lat) * scale,
  };
}

// ─── Store shape ─────────────────────────────────────────────────────────────

export interface TransportData {
  routes: TransportRoute[];
  /** Routes switched off (active_status false) - kept so their codes stay reserved. */
  archivedRoutes: TransportRoute[];
  vehicles: Vehicle[];
  drivers: Driver[];
  attendants: Attendant[];
  /** Students with a transport allocation (allocated, pending or waitlisted). */
  students: Student[];
  /** School students without an allocation - candidates for Bulk Allocate. */
  studentPool: Student[];
  /** HR staff without a transport profile - candidates for Add driver / attendant. */
  staffPool: { pk: number; name: string; staffNo: string; role: string | null; licence: string }[];
  alerts: TransportAlert[];
  maintenance: ServiceRecord[];
  fuel: FuelEntry[];
  fuelSummary: FuelSummary | null;
  reports: ReportDef[];
  recentReports: GeneratedReport[];
  settings: TransportSettings;
  dashboard: DashboardSummary | null;
  /** Boarding registers loaded from the API, keyed "shift|YYYY-MM-DD" → student id. */
  attendance: Record<string, Record<string, AttendanceEntry>>;
  /** Map projection used for every route / stop / bus marker. */
  projection: Projection;
  /** Sections the signed-in user may not read (403) - screens show them empty. */
  unavailable: string[];
}

export const EMPTY_SETTINGS: TransportSettings = {
  geofence: { lat: null, lng: null, radius: 150 },
  shifts: { morningPickup: "06:30", schoolArrival: "08:50", afternoonDrop: "15:20" },
  thresholds: { overspeed: 50, lateMin: 8, deviationM: 500, idleMin: 10, sosEscalation: "Transport in-charge" },
  notifications: { boardedDropped: true, approaching: true, delay: true, smsFallback: false, language: "English" },
  fees: { billingCycle: "Monthly", siblingConcession: 10 },
  fareSlabs: [],
  reminders: { vehicleDocsDays: 30, licenceDays: 60, firstAidDays: 60, blockExpired: true },
};

export function emptyTransportData(): TransportData {
  return {
    routes: [], archivedRoutes: [], vehicles: [], drivers: [], attendants: [], students: [], studentPool: [], staffPool: [],
    alerts: [], maintenance: [], fuel: [], fuelSummary: null, reports: [], recentReports: [],
    settings: structuredClone(EMPTY_SETTINGS), dashboard: null, attendance: {},
    projection: makeProjection([], { lat: null, lng: null }), unavailable: [],
  };
}

// ─── Load ────────────────────────────────────────────────────────────────────

async function guarded<T>(section: string, task: Promise<T>, fallback: T, unavailable: string[]): Promise<T> {
  try {
    return await task;
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 403 || status === 404) {
      unavailable.push(section);
      return fallback;
    }
    throw error;
  }
}

export async function loadTransportData(): Promise<TransportData> {
  const unavailable: string[] = [];
  const g = <T,>(section: string, task: Promise<T>, fallback: T) => guarded(section, task, fallback, unavailable);
  const [
    vehiclesRaw, routesRaw, stopsRaw, staffRaw, staffPoolRaw, allocRaw, poolRaw, alertsRaw, serviceRaw, fuelRaw,
    fuelSummaryRaw, reportsRaw, recentRaw, settingsRaw, dashboardRaw, attendance30Raw,
  ] = await Promise.all([
    g("vehicles", tlist("/vehicles/"), []),
    g("routes", tlist("/transport-routes/"), []),
    g("stops", tlist("/bus-stops/"), []),
    g("staff", tlist("/transport-staff/"), []),
    g("staff", tget<Raw[]>("/transport-staff/candidates/"), []),
    g("allocation", tlist("/transport-allocations/"), []),
    g("allocation", tget<Raw[]>("/transport-allocations/candidates/"), []),
    g("alerts", tlist("/transport-alerts/?exclude_types=arrived,left,near_school"), []),
    g("maintenance", tlist("/transport-maintenance/"), []),
    g("fuel", tlist("/transport-fuel/"), []),
    g("fuel", tget<Raw>("/transport-fuel/summary/"), null),
    g("reports", tget<Raw[]>("/transport-reports/"), []),
    g("reports", tget<Raw[]>("/transport-reports/recent/"), []),
    g("settings", tget<Raw>("/transport-settings/"), null),
    g("dashboard", tget<Raw>("/transport-dashboard/"), null),
    g("attendance", tget<Raw>("/transport-attendance/boarding-rates/?days=30").then((r) => (r.results ?? []) as Raw[]), [] as Raw[]),
  ]);

  const settings = settingsRaw ? (settingsRaw as TransportSettings) : structuredClone(EMPTY_SETTINGS);
  const activeStops = stopsRaw.filter((s) => s.active_status !== false);
  const projection = makeProjection(
    activeStops.map((s) => ({ lat: num(s.latitude), lng: num(s.longitude) })),
    settings.geofence,
  );

  const routeCode = new Map<number, string>(routesRaw.map((r) => [r.id as number, routeCodeOf(r as { id: number; code?: string })]));
  const vehiclesByPk = new Map<number, Raw>(vehiclesRaw.map((v) => [v.id, v]));

  // Staff profiles: drivers are linked to vehicles through Vehicle.driver (hr.Staff pk).
  const driverByStaff = new Map<number, Raw>(staffRaw.filter((p) => p.role === "driver").map((p) => [p.staff, p]));
  const attendantByVehicle = new Map<number, Raw>();
  staffRaw.filter((p) => p.role === "attendant" && p.assigned_vehicle).forEach((p) => {
    if (!attendantByVehicle.has(p.assigned_vehicle)) attendantByVehicle.set(p.assigned_vehicle, p);
  });

  const allocatedAtStop = new Map<number, number>();
  allocRaw.filter((a) => a.status === "allocated" && a.stop).forEach((a) => allocatedAtStop.set(a.stop, (allocatedAtStop.get(a.stop) ?? 0) + 1));

  // Routes and their stops
  const allRoutes: TransportRoute[] = routesRaw.map((r, idx) => {
    const stopsOfRoute = stopsRaw
      .filter((s) => s.route === r.id && s.active_status !== false)
      .sort((a, b) => a.stop_order - b.stop_order || a.id - b.id);
    const code = routeCode.get(r.id)!;
    const stops: RouteStop[] = stopsOfRoute.map((s, i) => {
      const lat = num(s.latitude);
      const lng = num(s.longitude);
      return {
        id: ids.stop(s.id), pk: s.id, pickupId: `PP-${pad(s.id, 3)}`, name: s.stop_name, routeCode: code, seq: i + 1,
        landmark: s.landmark ?? "", students: allocatedAtStop.get(s.id) ?? 0, fare: num(s.effective_fare),
        pickupTime: hhmm(s.scheduled_time), dropTime: hhmm(s.drop_time),
        x: projection.x(lat, lng), y: projection.y(lat, lng), lat, lng,
      };
    });
    const vehicle = r.vehicle ? vehiclesByPk.get(r.vehicle.id) : undefined;
    const attendant = r.vehicle ? attendantByVehicle.get(r.vehicle.id) : undefined;
    const firstPickup = hhmm(r.first_pickup_time) || stops[0]?.pickupTime || "";
    const start = minutesOf(firstPickup);
    const arrival = minutesOf(settings.shifts.schoolArrival);
    const path = [...stops, ...(settings.geofence.lat !== null && settings.geofence.lng !== null ? [{ lat: settings.geofence.lat, lng: settings.geofence.lng }] : [])];
    const distance = path.slice(1).reduce((sum, p, i) => sum + haversineKm(path[i], p), 0);
    const cx = stops.length ? stops.reduce((s, x) => s + x.x, 0) / stops.length : 300;
    const cy = stops.length ? stops.reduce((s, x) => s + x.y, 0) / stops.length : 240;
    return {
      code, pk: r.id, active: r.active_status !== false, name: r.title, zone: r.zone ?? "",
      busReg: r.vehicle?.vehicle_no ?? "", driverName: r.vehicle?.driver_name ?? "",
      attendantName: attendant?.staff_name ?? "", firstPickup,
      capacity: vehicle ? num(vehicle.capacity) : 0,
      routeTimeMin: start !== null && arrival !== null && arrival > start ? arrival - start : 0,
      distanceKm: Math.round(distance * 10) / 10,
      geoIdx: idx, angleDeg: Math.round((Math.atan2(cy - 240, cx - 300) * 180) / Math.PI),
      shift: ROUTE_SHIFT[r.shift] ?? "Morning + afternoon", stops,
    };
  });
  const routes = allRoutes.filter((r) => r.active);
  const archivedRoutes = allRoutes.filter((r) => !r.active);

  // Fuel spend this month per vehicle (Vehicles screen column)
  const monthStart = toISO(new Date(TODAY.getFullYear(), TODAY.getMonth(), 1));
  const fuelMtd = new Map<number, number>();
  fuelRaw.filter((f) => f.date >= monthStart).forEach((f) => fuelMtd.set(f.vehicle, (fuelMtd.get(f.vehicle) ?? 0) + num(f.amount)));

  const vehicles: Vehicle[] = vehiclesRaw.map((v) => {
    const driver = v.driver ? driverByStaff.get(v.driver) : undefined;
    return {
      id: ids.vehicle(v.id), pk: v.id, capacity: num(v.capacity), reg: v.vehicle_no, model: v.vehicle_model ?? "",
      type: VEHICLE_TYPE[v.vehicle_type] ?? "Bus · 42-seater",
      routeCode: v.route ? routeCode.get(v.route.id) ?? null : null,
      driverId: driver ? ids.driver(driver.id) : null,
      fitness: v.fitness_valid_till ?? "", insurance: v.insurance_valid_till ?? "",
      permit: v.permit_valid_till ?? "", puc: v.pollution_valid_till ?? "",
      status: VEHICLE_STATUS[v.operational_status] ?? "Active",
      occupied: num(v.seats_occupied), odometer: num(v.odometer_km), fuelMtd: fuelMtd.get(v.id) ?? 0,
      archived: v.active_status === false,
    };
  });

  const routeLabelOf = (detail: Raw | null) => (detail?.route ? `${routeCodeOf(detail.route as { id: number; code?: string })} · ${detail.route.title}` : "—");
  const drivers: Driver[] = staffRaw.filter((p) => p.role === "driver").map((p) => {
    const status = STAFF_STATUS[p.duty_status] ?? "Off duty";
    return {
      id: ids.driver(p.id), pk: p.id, staffPk: p.staff, name: p.staff_name ?? "", shift: STAFF_SHIFT[p.shift] ?? "Full day",
      licenceNo: p.licence_number ?? "", licenceValidTill: p.licence_valid_till ?? "", experience: num(p.experience_years),
      status, rating: num(p.rating), vehicleReg: p.vehicle_detail?.vehicle_no ?? "Unassigned", routeLabel: routeLabelOf(p.vehicle_detail),
      phone: p.phone ?? "", online: status === "On route" || status === "On duty", tripsThisMonth: null,
      badgeNo: p.badge_number ?? "", emergencyContact: p.emergency_contact ?? "",
    };
  });
  const occupiedByReg = new Map(vehicles.map((v) => [v.reg, v.occupied]));
  const attendants: Attendant[] = staffRaw.filter((p) => p.role === "attendant").map((p) => {
    const reg = p.vehicle_detail?.vehicle_no ?? "Unassigned";
    return {
      id: ids.attendant(p.id), pk: p.id, staffPk: p.staff, name: p.staff_name ?? "", shift: STAFF_SHIFT[p.shift] ?? "Full day",
      firstAidValidTill: p.first_aid_valid_till ?? "", certificateNo: p.first_aid_certificate_no ?? "",
      experience: num(p.experience_years), status: STAFF_STATUS[p.duty_status] ?? "Off duty", busReg: reg,
      routeLabel: routeLabelOf(p.vehicle_detail), phone: p.phone ?? "", trips: null,
      studentsOnBus: occupiedByReg.get(reg) ?? 0, emergencyContact: p.emergency_contact ?? "",
    };
  });

  // Boarding register over the last 30 days → per-student boarded share
  const boardedShare = new Map<number, { marked: number; boarded: number }>(
    attendance30Raw.map((r) => [r.student as number, { marked: num(r.marked), boarded: num(r.boarded) }]),
  );
  const share = (pk: number) => {
    const row = boardedShare.get(pk);
    return row && row.marked ? Math.round((row.boarded / row.marked) * 100) : null;
  };

  const students: Student[] = allocRaw.map((a) => ({
    id: ids.student(a.student), pk: a.student, allocationId: a.id, admission: a.admission_no ?? "", name: a.student_name ?? "",
    cls: a.class_name ?? "", section: a.section_name ?? "", roll: a.roll_no ?? "",
    routeCode: a.route ? routeCode.get(a.route) ?? null : null, stopId: a.stop ? ids.stop(a.stop) : null,
    busReg: a.vehicle_no ?? null, fare: num(a.monthly_fare), status: ALLOCATION_STATUS[a.status] ?? "Pending",
    parentName: a.guardian_name ?? "—", mobile: a.guardian_phone ?? "—", attendance30d: share(a.student),
  }));
  const studentPool: Student[] = poolRaw.map((c) => ({
    id: ids.student(c.id), pk: c.id, allocationId: null, admission: c.admission_no ?? "", name: c.name ?? "",
    cls: c.class_name ?? "", section: c.section_name ?? "", roll: c.roll_no ?? "",
    routeCode: null, stopId: null, busReg: null, fare: 0, status: "Pending",
    parentName: c.guardian_name ?? "—", mobile: c.guardian_phone ?? "—", attendance30d: null,
  }));

  const now = Date.now();
  const docLabel = invert(DOC_FIELD);
  const alerts: TransportAlert[] = alertsRaw
    .filter((a) => ALERT_TYPE[a.alert_type])
    .map((a) => {
      const type = ALERT_TYPE[a.alert_type];
      const at = a.created_at ? new Date(a.created_at) : null;
      const detail = [a.vehicle_no, a.route_title, at ? at.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null]
        .filter(Boolean).join(" · ");
      return {
        id: ids.alert(a.id), pk: a.id, type, severity: SEVERITY[a.severity] ?? "Info", title: a.message, detail,
        routeCode: a.route ? routeCode.get(a.route) ?? "" : "",
        ageMin: at ? Math.max(0, Math.round((now - at.getTime()) / 60000)) : 0,
        state: (a.state ?? (a.is_resolved ? "resolved" : "open")) as AlertState,
        owner: a.resolved_by_name ?? a.acknowledged_by_name ?? undefined,
        ref: type === "Document expiry" && a.document ? { vehicleId: ids.vehicle(a.vehicle), doc: docLabel[a.document] } : undefined,
      };
    });

  const maintenance: ServiceRecord[] = serviceRaw.map((r) => ({
    id: ids.service(r.id), pk: r.id, vehicleId: ids.vehicle(r.vehicle), date: r.service_date, type: r.service_type,
    workDone: r.work_done ?? "", cost: num(r.cost), odometer: num(r.odometer_km), vendor: r.vendor ?? "",
    status: SERVICE_STATUS[r.display_status] ?? "Scheduled",
  }));

  const fuel: FuelEntry[] = fuelRaw.map((f) => ({
    id: ids.fuel(f.id), pk: f.id, vehicleId: ids.vehicle(f.vehicle), date: f.date, litres: num(f.litres), rate: num(f.rate),
    amount: num(f.amount), odometer: num(f.odometer_km), station: f.station ?? "", kml: numOrNull(f.kml),
    baseKml: numOrNull(f.baseline_kml), anomaly: !!f.anomaly, verified: !!f.verified,
  }));

  const fuelSummary: FuelSummary | null = fuelSummaryRaw ? {
    month: fuelSummaryRaw.month, spend: num(fuelSummaryRaw.spend), litres: num(fuelSummaryRaw.litres), km: num(fuelSummaryRaw.km),
    avgKml: numOrNull(fuelSummaryRaw.avg_kml), entries: num(fuelSummaryRaw.entries), anomalies: num(fuelSummaryRaw.anomalies),
    unverified: num(fuelSummaryRaw.unverified),
    perVehicle: (fuelSummaryRaw.per_vehicle ?? []).map((row: Raw) => ({
      vehicleId: ids.vehicle(row.vehicle), reg: row.vehicle_no, spend: num(row.spend), litres: num(row.litres), km: num(row.km),
      avgKml: numOrNull(row.avg_kml), baseKml: numOrNull(row.baseline_kml), anomalies: num(row.anomalies),
    })),
    trend: (fuelSummaryRaw.trend ?? []).map((row: Raw) => ({ month: row.month, spend: num(row.spend), litres: num(row.litres) })),
  } : null;

  const reports: ReportDef[] = reportsRaw.map((r) => ({
    key: r.key, name: r.name, rhythm: r.rhythm, icon: REPORT_ICON[r.key] ?? "FileBarChart", category: r.category,
    dot: r.last_generated ? "ok" : "warn", lastGenerated: r.last_generated ? String(r.last_generated).slice(0, 10) : "",
    description: r.description,
  }));
  const reportName = new Map(reports.map((r) => [r.key, r.name]));
  const recentReports: GeneratedReport[] = recentRaw.map((r) => ({
    report: reportName.get(r.report) ?? r.report, period: r.period, scope: r.scope,
    format: r.file_format === "excel" ? "Excel" : "PDF",
    generated: r.created_at ? new Date(r.created_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—",
  }));

  return {
    routes, archivedRoutes, vehicles, drivers, attendants, students, studentPool,
    staffPool: staffPoolRaw.map((s) => ({ pk: s.id, name: s.name, staffNo: s.staff_no ?? "", role: s.role ?? null, licence: s.driving_license ?? "" })),
    alerts, maintenance, fuel, fuelSummary, reports, recentReports, settings,
    dashboard: dashboardRaw ? toDashboard(dashboardRaw) : null,
    attendance: {}, projection, unavailable: [...new Set(unavailable)],
  };
}

function toDashboard(d: Raw): DashboardSummary {
  return {
    date: d.date, shift: d.shift, lastSynced: d.last_synced ?? null,
    fleet: {
      total: num(d.fleet?.total), byStatus: d.fleet?.by_status ?? {},
      documentsExpired: num(d.fleet?.documents_expired), documentsExpiring: num(d.fleet?.documents_expiring),
    },
    students: {
      allocated: num(d.students?.allocated), pending: num(d.students?.pending), waitlisted: num(d.students?.waitlisted),
      boarded: num(d.students?.boarded), marked: num(d.students?.marked), late: num(d.students?.late),
    },
    seats: { used: num(d.seats?.used), total: num(d.seats?.total), utilisationPct: numOrNull(d.seats?.utilisation_pct) },
    alerts: { open: num(d.alerts?.open), critical: num(d.alerts?.critical), delaysToday: num(d.alerts?.delays_today) },
    maintenance: {
      overdue: num(d.maintenance?.overdue), dueSoon: num(d.maintenance?.due_soon), due: num(d.maintenance?.due),
      inWorkshop: num(d.maintenance?.in_workshop), spendMtd: num(d.maintenance?.spend_mtd),
    },
    fuel: { spendMtd: num(d.fuel?.spend_mtd), litresMtd: num(d.fuel?.litres_mtd), openAnomalies: num(d.fuel?.open_anomalies) },
    boardingsWeek: (d.boardings_week ?? []).map((row: Raw) => ({ date: row.date, day: row.day, value: num(row.value) })),
  };
}

// ─── Boarding register ───────────────────────────────────────────────────────

export function registerKey(shift: AttendanceShift, date: string): string {
  return `${shift}|${date}`;
}

/** GET register/ → student id → entry (unmarked lines have marked: false). */
export async function loadRegister(date: string, shift: AttendanceShift): Promise<Record<string, AttendanceEntry>> {
  const body = await tget<Raw>(`/transport-attendance/register/?date=${date}&shift=${shift}`);
  const out: Record<string, AttendanceEntry> = {};
  (body.results ?? []).forEach((row: Raw) => {
    out[ids.student(row.student)] = {
      boarded: !!row.boarded, late: !!row.late, ...(row.note ? { note: row.note } : {}),
      marked: !!row.marked, scannedAt: row.scanned_at ?? null, source: row.source ?? null,
    };
  });
  return out;
}

// ─── Reports ─────────────────────────────────────────────────────────────────

export interface ApiReport {
  key: string; name: string; scope: string; period: string; notes: string[];
  stats: { label: string; value: unknown; kind: string }[];
  columns: { key: string; header: string; kind: string }[];
  rows: Raw[];
  totals: Raw;
}

export function fetchReport(key: string, params: { route?: number | null; month?: string; date?: string; shift?: AttendanceShift }): Promise<ApiReport> {
  const q = new URLSearchParams();
  if (params.route) q.set("route", String(params.route));
  if (params.month) q.set("month", params.month);
  if (params.date) q.set("date", params.date);
  if (params.shift) q.set("shift", params.shift);
  return tget<ApiReport>(`/transport-reports/${key}/?${q.toString()}`);
}

export function logReport(key: string, body: { period: string; scope: string; file_format: "pdf" | "excel" | "csv" }) {
  return tsend(`/transport-reports/${key}/log/`, "POST", body);
}

// ─── Live tracking ───────────────────────────────────────────────────────────

export interface LivePosition {
  vehiclePk: number; reg: string; lat: number | null; lng: number | null; speed: number; status: string;
  nextStop: string | null; lastUpdate: string | null; simulated: boolean;
}

export async function loadLive(): Promise<LivePosition[]> {
  const rows = await tget<Raw[]>("/bus-locations/live/");
  return (rows ?? []).map((r) => ({
    vehiclePk: r.vehicle_id, reg: r.vehicle_no, lat: numOrNull(r.latitude), lng: numOrNull(r.longitude),
    speed: num(r.speed), status: r.status ?? "idle", nextStop: r.next_stop ?? null,
    lastUpdate: r.last_location_update ?? null, simulated: !!r.is_simulated,
  }));
}

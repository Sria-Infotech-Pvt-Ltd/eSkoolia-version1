/**
 * Transport module domain types (Master Prompt §6). Records are loaded from the
 * Transport APIs (lib/transport/api.ts); string ids keep the screen formats
 * (VH-012, S45, DR-007 …) and `pk` is the backend primary key.
 */

/** Free-text zone set on the route (e.g. "West"); empty when not set. */
export type Zone = string;
export type RouteShift = "Morning + afternoon" | "Morning only" | "Afternoon only";

export interface RouteStop {
  /** Route-stop id S<pk> */
  id: string;
  pk: number;
  /** Canonical pickup point id PP-001…PP-070 */
  pickupId: string;
  name: string;
  routeCode: string;
  seq: number;
  landmark: string;
  students: number;
  fare: number;
  pickupTime: string; // "HH:MM", "" when not scheduled
  dropTime: string; // "HH:MM", "" when not scheduled
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface TransportRoute {
  code: string; // route code (R1 …), or RT<pk> when the route has no code
  pk: number;
  active: boolean;
  name: string;
  zone: Zone;
  busReg: string;
  driverName: string;
  attendantName: string;
  firstPickup: string; // "HH:MM", "" when not set
  capacity: number;
  /** First pickup to school arrival (Settings), minutes; 0 when either time is unknown. */
  routeTimeMin: number;
  /** Along the stops (and on to the school when its location is set), km. */
  distanceKm: number;
  /** Geometry index for the SVG maps (route i uses angle i*40−80°). */
  geoIdx: number;
  angleDeg: number;
  shift: RouteShift;
  stops: RouteStop[];
}

export type VehicleType = "Bus · 42-seater" | "Mini-bus · 26-seater" | "Van · 12-seater";
export type VehicleStatus = "On route" | "Active" | "Idle" | "Under maintenance" | "Breakdown";
export type VehicleDoc = "Fitness certificate" | "Insurance" | "Road permit" | "Pollution (PUC)";

export interface Vehicle {
  id: string; // VH-<pk>
  pk: number;
  /** Seats: explicit seating capacity, else the default for the vehicle type. */
  capacity: number;
  reg: string;
  model: string;
  type: VehicleType;
  routeCode: string | null;
  driverId: string | null;
  /** Document valid-till dates ("YYYY-MM-DD"), "" when not recorded. */
  fitness: string;
  insurance: string;
  permit: string;
  puc: string;
  status: VehicleStatus;
  occupied: number;
  odometer: number;
  fuelMtd: number;
  archived?: boolean;
}

export type StaffStatus = "On route" | "On duty" | "Off duty" | "On leave" | "Inactive";
export type ShiftGroup = "Full day" | "Morning only" | "Relief & reserve";

export interface Driver {
  id: string; // DR-<transport profile pk>
  pk: number;
  /** hr.Staff pk - drivers are existing HR staff. */
  staffPk: number;
  name: string;
  shift: ShiftGroup;
  licenceNo: string;
  licenceValidTill: string;
  experience: number;
  status: StaffStatus;
  rating: number;
  vehicleReg: string;
  routeLabel: string;
  phone: string;
  online: boolean;
  /** Not tracked yet - null. */
  tripsThisMonth: number | null;
  badgeNo: string;
  emergencyContact: string;
  archived?: boolean;
}

export interface Attendant {
  id: string; // AT-<transport profile pk>
  pk: number;
  staffPk: number;
  name: string;
  shift: ShiftGroup;
  firstAidValidTill: string;
  certificateNo: string;
  experience: number;
  status: StaffStatus;
  busReg: string;
  routeLabel: string;
  phone: string;
  /** Not tracked yet - null. */
  trips: number | null;
  studentsOnBus: number;
  emergencyContact: string;
  archived?: boolean;
}

export type AllocationStatus = "Allocated" | "Pending" | "Waitlisted";

export interface Student {
  id: string; // ST<student pk>
  pk: number;
  /** StudentTransportAllocation pk; null for school students not on transport yet. */
  allocationId: number | null;
  admission: string;
  name: string;
  /** Class and section names from the Students module ("" when not set). */
  cls: string;
  section: string;
  roll: string;
  routeCode: string | null;
  stopId: string | null;
  busReg: string | null;
  fare: number;
  status: AllocationStatus;
  parentName: string;
  mobile: string;
  /** Boarded share of marked register lines in the last 30 days; null when none are marked. */
  attendance30d: number | null;
}

export type AlertType = "SOS" | "Overspeed" | "Breakdown" | "Late arrival" | "Route deviation" | "Document expiry";
export type AlertSeverity = "Critical" | "Warning" | "Info";
export type AlertState = "open" | "acknowledged" | "resolved";

export interface TransportAlert {
  id: string; // AL-<pk>
  pk: number;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  routeCode: string;
  ageMin: number;
  state: AlertState;
  owner?: string;
  /** Document-expiry alerts reference the record + document they are about. */
  ref?: { vehicleId?: string; driverId?: string; doc?: VehicleDoc | "Licence" };
}

export type ServiceStatus = "Completed" | "Overdue" | "In workshop" | "Due soon" | "Scheduled";

export interface ServiceRecord {
  id: string; // SV-<pk>
  pk: number;
  vehicleId: string;
  date: string;
  type: string;
  workDone: string;
  cost: number;
  odometer: number;
  vendor: string;
  status: ServiceStatus;
}

export interface FuelEntry {
  id: string; // FL-<pk>
  pk: number;
  vehicleId: string;
  date: string;
  litres: number;
  rate: number;
  amount: number;
  odometer: number;
  station: string;
  /** km/L since the previous fill (null for a vehicle's first entry). */
  kml: number | null;
  /** Vehicle's average km/L over earlier entries (null without history). */
  baseKml: number | null;
  anomaly: boolean;
  verified?: boolean;
}

export interface ReportDef {
  key: string;
  name: string;
  rhythm: string;
  icon: "Users" | "Car" | "FileBarChart" | "IdCard" | "ClipboardCheck" | "Fuel";
  category: string;
  dot: "ok" | "warn" | "danger";
  lastGenerated: string;
  description: string;
}

export interface GeneratedReport {
  report: string;
  period: string;
  scope: string;
  format: "PDF" | "Excel";
  generated: string;
}

export interface FareSlab { from: number; to: number; fare: number }

export interface TransportSettings {
  /** School location; lat/lng are null until the school sets them. */
  geofence: { lat: number | null; lng: number | null; radius: number };
  shifts: { morningPickup: string; schoolArrival: string; afternoonDrop: string };
  thresholds: { overspeed: number; lateMin: number; deviationM: number; idleMin: number; sosEscalation: string };
  notifications: { boardedDropped: boolean; approaching: boolean; delay: boolean; smsFallback: boolean; language: string };
  fees: { billingCycle: string; siblingConcession: number };
  fareSlabs: FareSlab[];
  reminders: { vehicleDocsDays: number; licenceDays: number; firstAidDays: number; blockExpired: boolean };
}

/** One student's line in a boarding register (Master Prompt §7.8). */
export interface AttendanceEntry {
  boarded: boolean; late: boolean; note?: string;
  /** false when nobody has marked this line yet (the register shows it as unmarked). */
  marked?: boolean;
  scannedAt?: string | null;
  source?: "manual" | "gps" | "rfid" | null;
}
export type AttendanceShift = "morning" | "afternoon";

/** GET /transport-dashboard/ - every figure counted from stored records. */
export interface DashboardSummary {
  date: string;
  shift: AttendanceShift;
  lastSynced: string | null;
  fleet: { total: number; byStatus: Record<string, number>; documentsExpired: number; documentsExpiring: number };
  students: { allocated: number; pending: number; waitlisted: number; boarded: number; marked: number; late: number };
  seats: { used: number; total: number; utilisationPct: number | null };
  alerts: { open: number; critical: number; delaysToday: number };
  maintenance: { overdue: number; dueSoon: number; due: number; inWorkshop: number; spendMtd: number };
  fuel: { spendMtd: number; litresMtd: number; openAnomalies: number };
  boardingsWeek: { date: string; day: string; value: number }[];
}

/** GET /transport-fuel/summary/ */
export interface FuelSummary {
  month: string;
  spend: number;
  litres: number;
  km: number;
  avgKml: number | null;
  entries: number;
  anomalies: number;
  unverified: number;
  perVehicle: { vehicleId: string; reg: string; spend: number; litres: number; km: number; avgKml: number | null; baseKml: number | null; anomalies: number }[];
  trend: { month: string; spend: number; litres: number }[];
}

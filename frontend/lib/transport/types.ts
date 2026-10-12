/** Transport module domain types (Master Prompt §6). Frontend-only mock data. */

export type Zone = "West" | "North" | "South";
export type RouteShift = "Morning + afternoon" | "Morning only" | "Afternoon only";

export interface RouteStop {
  /** Route-stop id S1…S70 */
  id: string;
  /** Canonical pickup point id PP-001…PP-070 */
  pickupId: string;
  name: string;
  routeCode: string;
  seq: number;
  landmark: string;
  students: number;
  fare: number;
  pickupTime: string; // "HH:MM"
  dropTime: string; // "HH:MM"
  x: number;
  y: number;
  lat: number;
  lng: number;
}

export interface TransportRoute {
  code: string; // R1…R9
  name: string;
  zone: Zone;
  busReg: string;
  driverName: string;
  attendantName: string;
  firstPickup: string; // "HH:MM"
  capacity: number;
  routeTimeMin: number;
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
  id: string; // VH-001
  reg: string;
  model: string;
  type: VehicleType;
  routeCode: string | null;
  driverId: string | null;
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
  id: string; // DR-101
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
  tripsThisMonth: number;
  badgeNo: string;
  emergencyContact: string;
  archived?: boolean;
}

export interface Attendant {
  id: string; // AT-201
  name: string;
  shift: ShiftGroup;
  firstAidValidTill: string;
  certificateNo: string;
  experience: number;
  status: StaffStatus;
  busReg: string;
  routeLabel: string;
  phone: string;
  trips: number;
  studentsOnBus: number;
  emergencyContact: string;
  archived?: boolean;
}

export type AllocationStatus = "Allocated" | "Pending" | "Waitlisted";

export interface Student {
  id: string; // ST1000
  admission: string;
  name: string;
  cls: number;
  section: "A" | "B" | "C";
  roll: number;
  routeCode: string | null;
  stopId: string | null;
  busReg: string | null;
  fare: number;
  status: AllocationStatus;
  parentName: string;
  mobile: string;
  attendance30d: number;
}

export type AlertType = "SOS" | "Overspeed" | "Breakdown" | "Late arrival" | "Route deviation" | "Document expiry";
export type AlertSeverity = "Critical" | "Warning" | "Info";
export type AlertState = "open" | "acknowledged" | "resolved";

export interface TransportAlert {
  id: string; // AL-5401
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
  id: string; // SV-0001
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
  id: string; // FL-0001
  vehicleId: string;
  date: string;
  litres: number;
  rate: number;
  amount: number;
  odometer: number;
  station: string;
  kml: number;
  baseKml: number;
  anomaly: boolean;
  verified?: boolean;
}

export interface ReportDef {
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
  geofence: { lat: number; lng: number; radius: number };
  shifts: { morningPickup: string; schoolArrival: string; afternoonDrop: string };
  thresholds: { overspeed: number; lateMin: number; deviationM: number; idleMin: number; sosEscalation: string };
  notifications: { boardedDropped: boolean; approaching: boolean; delay: boolean; smsFallback: boolean; language: string };
  fees: { billingCycle: string; siblingConcession: number };
  fareSlabs: FareSlab[];
  reminders: { vehicleDocsDays: number; licenceDays: number; firstAidDays: number; blockExpired: boolean };
}

/** One student's line in a boarding register (Master Prompt §7.8). */
export interface AttendanceEntry { boarded: boolean; late: boolean; note?: string }
export type AttendanceShift = "morning" | "afternoon";

export interface DashboardStatic {
  lastSynced: string;
  studentsOnboard: number;
  studentsAllocatedMorning: number;
  lateBuses: number;
  lateNote: string;
  openAlerts: number;
  seatUtilisationPct: number;
  seatsUsed: number;
  seatsTotal: number;
  maintenanceDue: number;
  maintenanceNote: string;
  boardingsWeek: { day: string; value: number }[];
  fuelSpendMtd: number;
}

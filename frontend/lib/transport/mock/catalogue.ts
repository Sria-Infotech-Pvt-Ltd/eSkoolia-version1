/** Dashboard figures, report catalogue/history and settings defaults (Master Prompt §6.9–§6.11). */
import type { DashboardStatic, GeneratedReport, ReportDef, TransportSettings } from "../types";

/** Static in the prototype; the dashboard derives what the store holds and keeps these for the rest. */
export const DASHBOARD_STATIC: DashboardStatic = {
  lastSynced: "08:42 AM",
  studentsOnboard: 412,
  studentsAllocatedMorning: 521,
  lateBuses: 2,
  lateNote: "Route R3 +14 min · Route R7 +9 min",
  openAlerts: 5,
  seatUtilisationPct: 81,
  seatsUsed: 521,
  seatsTotal: 644,
  maintenanceDue: 4,
  maintenanceNote: "2 this week · 1 overdue service",
  boardingsWeek: [
    { day: "Mon", value: 968 }, { day: "Tue", value: 982 }, { day: "Wed", value: 951 }, { day: "Thu", value: 990 },
    { day: "Fri", value: 1004 }, { day: "Sat", value: 412 }, { day: "Sun", value: 0 },
  ],
  fuelSpendMtd: 184260,
};

export const REPORTS: ReportDef[] = [
  { name: "Route-wise strength", rhythm: "Per term", icon: "Users", category: "Operations", dot: "ok", lastGenerated: "2026-10-05",
    description: "Students per route and stop, with seat utilisation and waitlist by shift." },
  { name: "Vehicle utilisation", rhythm: "Monthly", icon: "Car", category: "Fleet", dot: "ok", lastGenerated: "2026-10-01",
    description: "Seats used, km run and idle days for every vehicle in the fleet." },
  { name: "Transport fee collection", rhythm: "Monthly", icon: "FileBarChart", category: "Finance", dot: "warn", lastGenerated: "2026-09-30",
    description: "Fees billed vs collected by route, with defaulters and concessions." },
  { name: "Driver duty roster", rhythm: "Weekly", icon: "IdCard", category: "Staff", dot: "ok", lastGenerated: "2026-10-04",
    description: "Shift-wise duty hours, relief cover and leave for drivers and attendants." },
  { name: "Daily boarding register", rhythm: "Daily", icon: "ClipboardCheck", category: "Operations", dot: "danger", lastGenerated: "2026-10-06",
    description: "Boarded, no-show and late students per bus for any date and shift." },
  { name: "Fuel & maintenance cost", rhythm: "Monthly", icon: "Fuel", category: "Finance", dot: "ok", lastGenerated: "2026-10-01",
    description: "Fuel spend, km/L, service costs and cost per student per vehicle." },
];

export const RECENT_REPORTS: GeneratedReport[] = [
  { report: "Daily boarding register", period: "06 Oct 2026", scope: "All routes · Morning", format: "PDF", generated: "Today, 08:10 AM" },
  { report: "Route-wise strength", period: "Term 1", scope: "All routes", format: "Excel", generated: "Yesterday, 4:42 PM" },
  { report: "Driver duty roster", period: "29 Sep – 04 Oct", scope: "All shifts", format: "PDF", generated: "04 Oct, 6:00 PM" },
  { report: "Fuel & maintenance cost", period: "September 2026", scope: "All vehicles", format: "Excel", generated: "01 Oct, 9:15 AM" },
];

export const SETTINGS_DEFAULTS: TransportSettings = {
  geofence: { lat: 17.4935, lng: 78.3812, radius: 150 },
  shifts: { morningPickup: "06:30", schoolArrival: "08:50", afternoonDrop: "15:20" },
  thresholds: { overspeed: 50, lateMin: 8, deviationM: 500, idleMin: 10, sosEscalation: "Transport in-charge" },
  notifications: { boardedDropped: true, approaching: true, delay: true, smsFallback: false, language: "English" },
  fees: { billingCycle: "Monthly", siblingConcession: 10 },
  fareSlabs: [
    { from: 0, to: 3, fare: 1400 }, { from: 3, to: 6, fare: 1800 }, { from: 6, to: 10, fare: 2200 }, { from: 10, to: 15, fare: 2600 },
  ],
  reminders: { vehicleDocsDays: 30, licenceDays: 60, firstAidDays: 60, blockExpired: true },
};

/** Alerts (12) — AL-5401 … AL-5412 (Master Prompt §6.6). */
import type { AlertSeverity, AlertState, AlertType, TransportAlert } from "../types";

type Row = [AlertType, AlertSeverity, string, string, string, number, AlertState, TransportAlert["ref"]?];

const ROWS: Row[] = [
  ["SOS", "Critical", "SOS pressed on TS 10 KB 1449 — Route R8", "Attendant Nasreen S. · near Kokapet · 08:36 AM", "R8", 6, "open"],
  ["Overspeed", "Critical", "Overspeed: TS 09 EZ 1187 at 62 km/h", "Route R5 · Outer Ring Rd service lane · 08:31 AM", "R5", 11, "open"],
  ["Breakdown", "Critical", "Breakdown reported — TS 08 LN 6672", "Coolant leak at depot · substitute van assigned to R3 · 07:58 AM", "R3", 44, "open"],
  ["Late arrival", "Warning", "Bus 07 running 14 min late on Route R3", "Traffic at Kondapur junction · ETA school 08:58", "R3", 3, "open"],
  ["Late arrival", "Warning", "TS 08 JK 5530 running 9 min late on R7", "Road works at Seven Tombs Rd · 08:40 AM", "R7", 2, "open"],
  ["Route deviation", "Warning", "TS 07 UD 6624 left planned route by 1.2 km", "Diversion near Shaikpet flyover · 08:22 AM", "R6", 20, "open"],
  ["Document expiry", "Warning", "Insurance expires in 6 days — TS 07 UB 4421", "Renewal due 12 Oct 2026 · upload new policy", "R3", 180, "open",
    { vehicleId: "VH-001", doc: "Insurance" }],
  ["Document expiry", "Info", "Fitness certificate expired — TS 10 KA 7781", "Expired 28 Sep 2026 · inspection booked 09 Oct", "R4", 240, "open",
    { vehicleId: "VH-005", doc: "Fitness certificate" }],
  ["Document expiry", "Info", "Driver licence renewal due — Mahesh Goud", "Valid till 20 Nov 2026", "R5", 300, "open",
    { driverId: "DR-102", doc: "Licence" }],
  ["Late arrival", "Info", "3 students not boarded at Kondapur Stop", "Route R3 · parents not yet notified", "R3", 8, "open"],
  ["Overspeed", "Warning", "TS 07 UC 0915 touched 54 km/h", "Route R2 · Botanical Garden Rd · 07:12 AM", "R2", 90, "resolved"],
  ["Route deviation", "Info", "TS 09 FA 8806 skipped Gangaram stop", "No students waiting · confirmed by attendant", "R9", 120, "resolved"],
];

export function seedAlerts(): TransportAlert[] {
  return ROWS.map(([type, severity, title, detail, routeCode, ageMin, state, ref], i) => ({
    id: `AL-${5401 + i}`,
    type, severity, title, detail, routeCode, ageMin, state,
    owner: state === "resolved" ? "Transport desk" : undefined,
    ref,
  }));
}

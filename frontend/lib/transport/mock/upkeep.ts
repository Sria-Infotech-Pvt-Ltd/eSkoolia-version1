/** Maintenance records (SV-0001…) and fuel log (FL-0001…) — Master Prompt §6.7, §6.8. */
import { isoFromToday, pad } from "../format";
import type { FuelEntry, ServiceRecord, ServiceStatus, Vehicle } from "../types";

const SERVICE_TYPES = [
  "Periodic service (10k km)", "Brake pads & shoes", "Tyre rotation", "Battery replacement", "AC servicing",
  "Clutch overhaul", "Coolant flush", "Speed governor calibration", "GPS & CCTV check",
];
const WORK_DONE = [
  "Engine oil, filters", "Front axle", "All 6 tyres", "12V 150Ah", "Roof unit", "Pressure plate", "Full system",
  "Set to 50 km/h", "Camera 2 replaced",
];
const COSTS = [8450, 6200, 2400, 7800, 3600, 18500, 1900, 1500, 1200];
const VENDORS = ["[Authorised Dealer A]", "[Workshop B]", "[Tyre Centre C]", "[Auto Electricals D]", "In-house depot"];

const FIRST_RECORD_STATUS: Record<string, ServiceStatus> = {
  "TS 09 EZ 2214": "Overdue",
  "TS 08 LN 6672": "In workshop",
  "TS 07 UB 4421": "Due soon",
  "TS 07 UD 6624": "Due soon",
  "TS 08 GH 3302": "Scheduled",
  "TS 07 UE 3318": "Scheduled",
};

export function seedMaintenance(vehicles: Vehicle[]): ServiceRecord[] {
  const out: ServiceRecord[] = [];
  let counter = 0;
  vehicles.forEach((veh, v) => {
    const count = 2 + (v % 3);
    for (let k = 0; k < count; k++) {
      counter += 1;
      const idx = (v + k * 2) % 9;
      const firstStatus = k === 0 ? FIRST_RECORD_STATUS[veh.reg] : undefined;
      const status: ServiceStatus = firstStatus ?? "Completed";
      const future = status === "Due soon" || status === "Scheduled";
      out.push({
        id: `SV-${pad(counter, 4)}`,
        vehicleId: veh.id,
        date: future ? isoFromToday(3 + (v % 5)) : isoFromToday(-(k * 47 + ((v * 13) % 30))),
        type: SERVICE_TYPES[idx],
        workDone: WORK_DONE[idx],
        cost: COSTS[idx] + v * 40,
        odometer: Math.max(1200, 48000 + v * 3170 - k * 6200),
        vendor: VENDORS[(v + k) % VENDORS.length],
        status,
      });
    }
  });
  return out;
}

/** Current odometer used by the service-interval donut. */
export function currentOdometer(vehicleIdx: number): number {
  return 48000 + vehicleIdx * 3170 + ((vehicleIdx * 1700) % 4000);
}

const STATIONS = ["[Fuel Station A]", "[Fuel Station B]", "[Fuel Station C]"];
const NO_FUEL = new Set(["TS 09 EZ 2214", "TS 08 LN 6672"]);
const ANOMALIES: Record<string, number> = { "TS 10 KA 7781": 0, "TS 07 UE 3318": 2 };

export function baseKml(veh: Vehicle, v: number): number {
  if (veh.type.startsWith("Bus")) return 4.6 + (v % 4) * 0.25;
  if (veh.type.startsWith("Mini")) return 8.2 + (v % 3) * 0.4;
  return 12.5 + (v % 2) * 0.8;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function seedFuel(vehicles: Vehicle[]): FuelEntry[] {
  const out: FuelEntry[] = [];
  let counter = 0;
  for (let d = 0; d <= 5; d++) {
    vehicles.forEach((veh, v) => {
      // §6.8 parity rule, plus the two named anomaly days (TS 07 UE 3318 on d=2
      // would otherwise be skipped by parity and its anomaly would never appear).
      if (NO_FUEL.has(veh.reg) || ((v + d) % 2 !== 0 && ANOMALIES[veh.reg] !== d)) return;
      counter += 1;
      const litres = veh.type.startsWith("Bus")
        ? 60 + ((v * 7 + d * 5) % 30)
        : veh.type.startsWith("Mini")
          ? 32 + ((v * 3 + d) % 12)
          : 18 + ((v + d) % 8);
      const rate = round2(94.2 + ((d * 3) % 4) * 0.35);
      const base = baseKml(veh, v);
      const anomaly = ANOMALIES[veh.reg] === d;
      const kml = round2(anomaly ? base * 0.72 : base * (0.95 + ((v + d * 3) % 10) / 100));
      out.push({
        id: `FL-${pad(counter, 4)}`,
        vehicleId: veh.id,
        date: isoFromToday(-d * 3),
        litres, rate,
        amount: Math.round(litres * rate),
        odometer: 52000 + v * 3170 - d * 420,
        station: STATIONS[(v + d) % 3],
        kml,
        baseKml: round2(base),
        anomaly: kml < base * 0.8,
      });
    });
  }
  return out;
}

/** Fleet km/L trend (8 weeks). */
export const FLEET_KML_TREND = [
  { week: "W34", kml: 6.1 }, { week: "W35", kml: 6.0 }, { week: "W36", kml: 6.2 }, { week: "W37", kml: 6.3 },
  { week: "W38", kml: 6.1 }, { week: "W39", kml: 5.8 }, { week: "W40", kml: 5.9 }, { week: "W41", kml: 6.0 },
];

/** Vehicles (18) — VH-001 … VH-018 (Master Prompt §6.2). Registrations are fictional. */
import { pad } from "../format";
import type { Driver, Vehicle, VehicleStatus, VehicleType } from "../types";

export const VEHICLE_TYPES: VehicleType[] = ["Bus · 42-seater", "Mini-bus · 26-seater", "Van · 12-seater"];
export const VEHICLE_STATUSES: VehicleStatus[] = ["On route", "Active", "Idle", "Under maintenance", "Breakdown"];

export const CAPACITY_BY_TYPE: Record<VehicleType, number> = {
  "Bus · 42-seater": 42,
  "Mini-bus · 26-seater": 26,
  "Van · 12-seater": 12,
};

type Row = [string, string, VehicleType, string | null, string | null, string, string, VehicleStatus, number];

const BUS: VehicleType = "Bus · 42-seater";
const MINI: VehicleType = "Mini-bus · 26-seater";
const VAN: VehicleType = "Van · 12-seater";

const ROWS: Row[] = [
  ["TS 07 UB 4421", "Tata Starbus Ultra", BUS, "R3", "Suresh Naidu", "2027-03-14", "2026-10-12", "On route", 38],
  ["TS 09 EZ 1187", "Ashok Leyland Lynx", BUS, "R5", "Mahesh Goud", "2027-01-20", "2027-05-02", "On route", 40],
  ["TS 08 GH 3302", "Eicher Skyline Pro", BUS, "R1", "Venkat Rao", "2026-11-02", "2027-02-11", "On route", 36],
  ["TS 07 UC 0915", "Tata Starbus Ultra", BUS, "R2", "Imran Shaikh", "2027-06-30", "2027-06-30", "On route", 41],
  ["TS 10 KA 7781", "Ashok Leyland Lynx", BUS, "R4", "Prakash Reddy", "2026-09-28", "2027-01-15", "Active", 39],
  ["TS 09 EZ 2214", "Eicher Skyline Pro", BUS, null, null, "2027-02-10", "2027-04-18", "Under maintenance", 0],
  ["TS 08 JK 5530", "Tata Starbus Ultra", BUS, "R7", "Srinivas Yadav", "2027-04-05", "2026-10-29", "On route", 37],
  ["TS 07 UD 6624", "Ashok Leyland Lynx", BUS, "R6", "Anil Kumar B.", "2027-08-12", "2027-08-12", "On route", 35],
  ["TS 10 KB 1449", "BharatBenz 914 School", BUS, "R8", "Ramesh Chary", "2027-02-27", "2027-03-09", "On route", 42],
  ["TS 09 FA 8806", "BharatBenz 914 School", BUS, "R9", "Kiran Babu", "2027-05-19", "2027-05-19", "Idle", 0],
  ["TS 08 LM 2290", "Force Traveller School", MINI, "R3", "Naresh Varma", "2027-01-11", "2027-01-11", "On route", 22],
  ["TS 07 UE 3318", "Tata Winger School", MINI, "R1", "Salim Pasha", "2026-10-25", "2027-03-30", "On route", 24],
  ["TS 10 KC 9054", "Force Traveller School", MINI, "R5", "Gopal Krishna M.", "2027-07-07", "2027-07-07", "Active", 19],
  ["TS 09 FB 4127", "Tata Winger School", MINI, "R9", "Rajesh Patnaik", "2027-03-21", "2027-03-21", "Idle", 0],
  ["TS 08 LN 6672", "Force Traveller School", MINI, null, null, "2027-02-02", "2026-09-30", "Breakdown", 0],
  ["TS 07 UF 1203", "Maruti Eeco Cargo", VAN, "R2", "Yusuf Ali", "2027-05-05", "2027-05-05", "On route", 11],
  ["TS 10 KD 3385", "Mahindra Supro", VAN, "R4", "Bhaskar Rao", "2027-01-28", "2027-01-28", "On route", 10],
  ["TS 09 FC 7750", "Maruti Eeco Cargo", VAN, "R6", "Shankar Das", "2026-12-15", "2026-12-15", "Idle", 0],
];

export function seedVehicles(drivers: Driver[]): Vehicle[] {
  return ROWS.map(([reg, model, type, routeCode, driverName, fitness, insurance, status, occupied], idx) => ({
    id: `VH-${pad(idx + 1, 3)}`,
    reg, model, type, routeCode,
    driverId: driverName ? drivers.find((d) => d.name === driverName)?.id ?? null : null,
    fitness, insurance,
    permit: "2027-03-31",
    puc: idx === 4 ? "2026-10-20" : "2027-01-18",
    status, occupied,
    odometer: 42180 + idx * 3170,
    fuelMtd: 8120 + idx * 690,
  }));
}

export function capacityOf(v: Pick<Vehicle, "type">): number {
  return CAPACITY_BY_TYPE[v.type];
}

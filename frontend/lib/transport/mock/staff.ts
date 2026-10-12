/** Drivers (16) and attendants (14) — Master Prompt §6.3, §6.4. All people fictional. */
import { last3, maskPhone, pad } from "../format";
import type { Attendant, Driver, ShiftGroup, StaffStatus, TransportRoute } from "../types";

export const SHIFT_LABELS: Record<ShiftGroup, string> = {
  "Full day": "Full day · morning + afternoon",
  "Morning only": "Morning shift only",
  "Relief & reserve": "Relief & reserve",
};

type DriverRow = [string, ShiftGroup, string, number, StaffStatus, number, string, string];

const DRIVER_ROWS: DriverRow[] = [
  ["Suresh Naidu", "Full day", "2028-04-11", 14, "On route", 4.8, "TS 07 UB 4421", "R3 · Madhapur"],
  ["Mahesh Goud", "Full day", "2026-11-20", 9, "On route", 4.6, "TS 09 EZ 1187", "R5 · Miyapur"],
  ["Venkat Rao", "Full day", "2029-01-05", 18, "On route", 4.9, "TS 08 GH 3302", "R1 · Gachibowli"],
  ["Imran Shaikh", "Full day", "2027-08-30", 11, "On route", 4.7, "TS 07 UC 0915", "R2 · Kondapur"],
  ["Prakash Reddy", "Full day", "2026-10-28", 7, "On duty", 4.4, "TS 10 KA 7781", "R4 · Kukatpally"],
  ["Srinivas Yadav", "Full day", "2028-12-14", 12, "On route", 4.5, "TS 08 JK 5530", "R7 · Tolichowki"],
  ["Anil Kumar B.", "Morning only", "2027-03-19", 6, "On route", 4.6, "TS 07 UD 6624", "R6 · Manikonda"],
  ["Ramesh Chary", "Morning only", "2030-02-22", 21, "On route", 4.9, "TS 10 KB 1449", "R8 · Narsingi"],
  ["Kiran Babu", "Relief & reserve", "2027-06-09", 5, "Off duty", 4.3, "TS 09 FA 8806", "R9 · Chandanagar (spare)"],
  ["Naresh Varma", "Morning only", "2028-07-25", 8, "On route", 4.5, "TS 08 LM 2290", "R3 · Madhapur"],
  ["Salim Pasha", "Morning only", "2027-11-03", 10, "On route", 4.7, "TS 07 UE 3318", "R1 · Gachibowli"],
  ["Gopal Krishna M.", "Morning only", "2026-09-29", 15, "On leave", 4.6, "TS 10 KC 9054", "R5 · Miyapur"],
  ["Rajesh Patnaik", "Relief & reserve", "2029-05-17", 4, "Off duty", 4.2, "TS 09 FB 4127", "R9 · Chandanagar"],
  ["Yusuf Ali", "Full day", "2028-01-30", 9, "On route", 4.8, "TS 07 UF 1203", "R2 · Kondapur"],
  ["Bhaskar Rao", "Morning only", "2027-09-12", 13, "On route", 4.7, "TS 10 KD 3385", "R4 · Kukatpally"],
  ["Shankar Das", "Relief & reserve", "2028-10-08", 3, "On duty", 4.1, "TS 09 FC 7750", "R6 · Manikonda"],
];

export function seedDrivers(): Driver[] {
  return DRIVER_ROWS.map(([name, shift, licence, exp, status, rating, vehicleReg, routeLabel], i) => {
    const id = `DR-${101 + i}`;
    return {
      id, name, shift,
      licenceNo: `TS${pad(7 + (i % 4), 2)} ${2008 + (i % 12)} 00${41207 + i * 733}`,
      licenceValidTill: licence,
      experience: exp, status, rating, vehicleReg, routeLabel,
      phone: maskPhone(`9${8 + (i % 2)}`, last3(310 + i * 37)),
      online: status === "On route" || status === "On duty",
      tripsThisMonth: 30 + ((i * 7) % 19),
      badgeNo: `PSV-${101 + i}72`,
      emergencyContact: "+91 97••• ••208",
    };
  });
}

type AttendantRow = [string, ShiftGroup, string, number, StaffStatus, string, string];

const ATTENDANT_ROWS: AttendantRow[] = [
  ["Lakshmi Devi", "Full day", "2027-06-14", 8, "On route", "TS 07 UB 4421", "R3 · Madhapur"],
  ["Fatima Begum", "Full day", "2026-11-02", 5, "On route", "TS 09 EZ 1187", "R5 · Miyapur"],
  ["Saritha K.", "Full day", "2027-09-21", 11, "On route", "TS 08 GH 3302", "R1 · Gachibowli"],
  ["Padma Rani", "Full day", "2028-01-09", 6, "On route", "TS 07 UC 0915", "R2 · Kondapur"],
  ["Anjali Rao", "Full day", "2026-10-19", 3, "On duty", "TS 10 KA 7781", "R4 · Kukatpally"],
  ["Swapna Reddy", "Full day", "2027-04-30", 7, "On route", "TS 08 JK 5530", "R7 · Tolichowki"],
  ["Rukmini Bai", "Morning only", "2026-09-12", 12, "On route", "TS 07 UD 6624", "R6 · Manikonda"],
  ["Nasreen Sultana", "Morning only", "2027-12-03", 4, "On route", "TS 10 KB 1449", "R8 · Narsingi"],
  ["Kavitha M.", "Morning only", "2027-02-17", 9, "On route", "TS 08 LM 2290", "R3 · Madhapur"],
  ["Jyothi Lakshmi P.", "Morning only", "2028-03-26", 2, "On route", "TS 07 UE 3318", "R1 · Gachibowli"],
  ["Shabana Khan", "Morning only", "2027-07-08", 6, "On leave", "TS 10 KC 9054", "R5 · Miyapur"],
  ["Vani Sree", "Full day", "2027-05-15", 5, "On route", "TS 07 UF 1203", "R2 · Kondapur"],
  ["Sunitha G.", "Morning only", "2027-10-22", 10, "On route", "TS 10 KD 3385", "R4 · Kukatpally"],
  ["Mary Joseph", "Relief & reserve", "2026-12-01", 14, "Off duty", "Unassigned", "Relief pool"],
];

/**
 * §6.4 reconciliation: the Routes table is canonical for which attendant rides
 * which route bus. Where the attendant table disagrees (e.g. the R1 / R9 crews),
 * the attendant record follows the route assignment.
 */
export function seedAttendants(routes: TransportRoute[]): Attendant[] {
  return ATTENDANT_ROWS.map(([name, shift, firstAid, exp, status, bus, routeLbl], i) => {
    const trips = 28 + ((i * 5) % 17);
    const crewRoute = routes.find((r) => r.attendantName === name);
    return {
      id: `AT-${201 + i}`,
      name, shift,
      firstAidValidTill: firstAid,
      certificateNo: `FA-${2024 + (i % 2)}-0${3120 + i * 57}`,
      experience: exp, status,
      busReg: crewRoute ? crewRoute.busReg : bus,
      routeLabel: crewRoute ? `${crewRoute.code} · ${crewRoute.name}` : routeLbl,
      phone: maskPhone(`9${7 + (i % 3)}`, last3(512 + i * 41)),
      trips,
      studentsOnBus: 30 + (trips % 12),
      emergencyContact: "+91 96••• ••714",
    };
  });
}

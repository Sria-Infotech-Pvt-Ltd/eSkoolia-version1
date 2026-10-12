/** Routes, stops and crews — canonical 9 routes / 70 stops (Master Prompt §6.1). */
import { addMinutes, pad } from "../format";
import type { RouteStop, TransportRoute, Zone } from "../types";

const LANDMARKS = [
  "near bus shelter", "opp. petrol bunk", "metro pillar side", "temple junction", "near park gate",
  "main road U-turn", "apartment gate", "near pharmacy", "school zone sign",
];

interface RouteSeed {
  code: string; name: string; zone: Zone; bus: string; driver: string; attendant: string;
  first: string; stops: string[];
}

const ROUTE_SEEDS: RouteSeed[] = [
  { code: "R1", name: "Gachibowli", zone: "West", bus: "TS 08 GH 3302", driver: "Venkat Rao", attendant: "Saritha K.", first: "06:40",
    stops: ["DLF Gate 1", "Gachibowli Stadium", "Indira Nagar", "Telecom Nagar", "Khajaguda X Rd", "Nanakramguda", "Financial District", "Wipro Circle"] },
  { code: "R2", name: "Kondapur", zone: "West", bus: "TS 07 UC 0915", driver: "Imran Shaikh", attendant: "Padma Rani", first: "06:45",
    stops: ["Botanical Garden", "Kothaguda X Rd", "Kondapur RTO", "Hafeezpet Rly Stn", "Masjid Banda", "Raghavendra Colony", "Sri Ram Nagar"] },
  { code: "R3", name: "Madhapur", zone: "West", bus: "TS 07 UB 4421", driver: "Suresh Naidu", attendant: "Lakshmi Devi", first: "06:35",
    stops: ["Hitech City MMTS", "Cyber Towers", "Image Gardens", "Ayyappa Society", "Kavuri Hills", "Jubilee Enclave", "Kondapur Stop", "Shilparamam", "Durgam Cheruvu"] },
  { code: "R4", name: "Kukatpally", zone: "North", bus: "TS 10 KA 7781", driver: "Prakash Reddy", attendant: "Anjali Rao", first: "06:30",
    stops: ["KPHB Phase 1", "JNTU Gate", "Nizampet X Rd", "Pragathi Nagar", "Bachupally", "Vasanth Nagar", "Moosapet", "Balanagar"] },
  { code: "R5", name: "Miyapur", zone: "North", bus: "TS 09 EZ 1187", driver: "Mahesh Goud", attendant: "Fatima Begum", first: "06:30",
    stops: ["Miyapur Metro", "Allwyn Colony", "Madinaguda", "Deepthisri Nagar", "Hydernagar", "Chanda Nagar Rly", "Lingampally", "BHEL Township"] },
  { code: "R6", name: "Manikonda", zone: "South", bus: "TS 07 UD 6624", driver: "Anil Kumar B.", attendant: "Rukmini Bai", first: "06:45",
    stops: ["Manikonda Main Rd", "Puppalaguda", "Alkapur Township", "Panchavati Colony", "Shaikpet", "OU Colony", "Lanco Hills"] },
  { code: "R7", name: "Tolichowki", zone: "South", bus: "TS 08 JK 5530", driver: "Srinivas Yadav", attendant: "Swapna Reddy", first: "06:40",
    stops: ["Tolichowki Flyover", "Seven Tombs Rd", "Film Nagar", "Paramount Colony", "Nanal Nagar", "Mehdipatnam", "Rethibowli", "Langar Houz"] },
  { code: "R8", name: "Narsingi", zone: "South", bus: "TS 10 KB 1449", driver: "Ramesh Chary", attendant: "Nasreen Sultana", first: "06:35",
    stops: ["Narsingi X Rd", "Kokapet", "Gandipet Rd", "Puppalguda Lake", "Neknampur", "Khanapur", "Mokila", "Shankarpally Rd"] },
  { code: "R9", name: "Chandanagar", zone: "North", bus: "TS 09 FA 8806", driver: "Kiran Babu", attendant: "Kavitha M.", first: "06:30",
    stops: ["Chandanagar Main", "Gangaram", "Ameenpur", "Beeramguda", "RC Puram", "Patancheru", "Isnapur"] },
];

export const ROUTE_CAPACITY = 42;

/** SVG map geometry (viewBox 600×480, school at 300,240). */
export function stopPoint(routeIdx: number, stopIdx: number, n: number): { x: number; y: number } {
  const a = ((routeIdx * 40 - 80) * Math.PI) / 180;
  const r = 215 - stopIdx * (165 / (n - 1));
  const wob = Math.sin(stopIdx * 1.7 + routeIdx) * 14;
  return {
    x: 300 + Math.cos(a) * r - Math.sin(a) * wob,
    y: 240 + Math.sin(a) * r * 0.92 + Math.cos(a) * wob,
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function seedRoutes(): TransportRoute[] {
  let counter = 0;
  return ROUTE_SEEDS.map((seed, routeIdx) => {
    const n = seed.stops.length;
    const stops: RouteStop[] = seed.stops.map((name, stopIdx) => {
      counter += 1;
      const { x, y } = stopPoint(routeIdx, stopIdx, n);
      return {
        id: `S${counter}`,
        pickupId: `PP-${pad(counter, 3)}`,
        name,
        routeCode: seed.code,
        seq: stopIdx + 1,
        landmark: LANDMARKS[(routeIdx + stopIdx) % 9],
        students: 3 + ((routeIdx * 5 + stopIdx * 3) % 6),
        fare: 1400 + stopIdx * 150 + (routeIdx % 3) * 100,
        pickupTime: addMinutes(seed.first, stopIdx * 6),
        dropTime: addMinutes("15:20", (n - 1 - stopIdx) * 6),
        x, y,
        lat: round4(17.4935 - (y - 240) * 0.00042),
        lng: round4(78.3812 + (x - 300) * 0.00046),
      };
    });
    return {
      code: seed.code,
      name: seed.name,
      zone: seed.zone,
      busReg: seed.bus,
      driverName: seed.driver,
      attendantName: seed.attendant,
      firstPickup: seed.first,
      capacity: ROUTE_CAPACITY,
      routeTimeMin: n * 6 + 12,
      distanceKm: Math.round(n * 2.3 * 10) / 10,
      geoIdx: routeIdx,
      angleDeg: routeIdx * 40 - 80,
      shift: "Morning + afternoon",
      stops,
    };
  });
}

/** "R3 · Madhapur" */
export function routeLabel(routes: TransportRoute[], code: string | null): string {
  if (!code) return "Unassigned";
  const r = routes.find((x) => x.code === code);
  return r ? `${r.code} · ${r.name}` : code;
}

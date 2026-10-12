/**
 * Pure state operations for routes, stops, drivers and attendants (Phase 2).
 * Keeps cross-screen links consistent in the one shared store:
 *   route bus / crew  ↔ vehicle.routeCode / vehicle.driverId / staff assignment
 *   route stops       ≡ pickup points (same records)
 *   removed stops / archived routes → affected students become Pending.
 */
import { addMinutes, pad } from "./format";
import { routeLabel, stopPoint } from "./mock";
import type { TransportData } from "./mock";
import type { Attendant, Driver, RouteStop, StaffStatus, Student, TransportRoute } from "./types";

const ZERO_LAT = 17.4935;
const ZERO_LNG = 78.3812;

function round4(n: number): number { return Math.round(n * 10000) / 10000; }

/**
 * Default monthly fare for a new stop / pickup point: the saved fare slab that
 * covers a typical 3 km stop distance (§7.14 "fare slabs → new pickup-point
 * fares"). With the default slabs this is ₹1,800, the spec's form default.
 */
export function defaultStopFare(slabs: { from: number; to: number; fare: number }[]): number {
  return slabs.find((s) => s.from <= 3 && 3 < s.to)?.fare ?? slabs[0]?.fare ?? 1800;
}

export function latLngFromXY(x: number, y: number) {
  return { lat: round4(ZERO_LAT - (y - 240) * 0.00042), lng: round4(ZERO_LNG + (x - 300) * 0.00046) };
}

export function xyFromLatLng(lat: number, lng: number) {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return { x: clamp(300 + (lng - ZERO_LNG) / 0.00046, 12, 588), y: clamp(240 - (lat - ZERO_LAT) / 0.00042, 12, 468) };
}

/** Recalculate seq, pickup/drop times, route time and distance after any stop change. */
export function retime(route: TransportRoute): TransportRoute {
  const n = route.stops.length;
  return {
    ...route,
    routeTimeMin: n * 6 + 12,
    distanceKm: Math.round(n * 2.3 * 10) / 10,
    stops: route.stops.map((s, i) => ({
      ...s,
      routeCode: route.code,
      seq: i + 1,
      pickupTime: addMinutes(route.firstPickup, i * 6),
      dropTime: addMinutes("15:20", (n - 1 - i) * 6),
    })),
  };
}

export function isOnline(status: StaffStatus): boolean {
  return status === "On route" || status === "On duty";
}

function pendingStudent(s: Student): Student {
  return { ...s, status: "Pending", routeCode: null, stopId: null, busReg: null, fare: 0 };
}

function setRoutes(state: TransportData, routes: TransportRoute[]): TransportData {
  return { ...state, routes };
}

// ─── Stops ───────────────────────────────────────────────────────────────────

export interface StopInput {
  name: string; landmark: string; students: number; fare: number;
  /** When given (pickup-point form with edited coordinates) the marker follows them; else the §6 geometry rule. */
  lat?: number; lng?: number;
}

export function addStop(state: TransportData, routeCode: string, input: StopInput): TransportData {
  const counter = state.stopCounter + 1;
  const routes = state.routes.map((r) => {
    if (r.code !== routeCode) return r;
    const idx = r.stops.length;
    const pos = input.lat !== undefined && input.lng !== undefined
      ? xyFromLatLng(input.lat, input.lng)
      : stopPoint(r.geoIdx, idx, Math.max(2, idx + 1));
    const ll = input.lat !== undefined && input.lng !== undefined ? { lat: round4(input.lat), lng: round4(input.lng) } : latLngFromXY(pos.x, pos.y);
    const stop: RouteStop = {
      id: `S${counter}`, pickupId: `PP-${pad(counter, 3)}`, name: input.name, routeCode, seq: idx + 1,
      landmark: input.landmark, students: input.students, fare: input.fare, pickupTime: "", dropTime: "",
      x: pos.x, y: pos.y, lat: ll.lat, lng: ll.lng,
    };
    return retime({ ...r, stops: [...r.stops, stop] });
  });
  return { ...setRoutes(state, routes), stopCounter: counter };
}

export function updateStop(
  state: TransportData, stopId: string, patch: Partial<StopInput> & { routeCode?: string },
): TransportData {
  const from = state.routes.find((r) => r.stops.some((s) => s.id === stopId));
  if (!from) return state;
  const routes = state.routes.map((r) => {
    if (r !== from) return r;
    return {
      ...r,
      stops: r.stops.map((s) => {
        if (s.id !== stopId) return s;
        const next: RouteStop = {
          ...s,
          name: patch.name ?? s.name,
          landmark: patch.landmark ?? s.landmark,
          students: patch.students ?? s.students,
          fare: patch.fare ?? s.fare,
        };
        if (patch.lat !== undefined && patch.lng !== undefined && (patch.lat !== s.lat || patch.lng !== s.lng)) {
          const pos = xyFromLatLng(patch.lat, patch.lng);
          return { ...next, x: pos.x, y: pos.y, lat: round4(patch.lat), lng: round4(patch.lng) };
        }
        return next;
      }),
    };
  });
  let next = setRoutes(state, routes);
  if (patch.routeCode && patch.routeCode !== from.code) next = moveStops(next, [stopId], patch.routeCode);
  return next;
}

export function reorderStop(state: TransportData, routeCode: string, stopId: string, dir: -1 | 1): TransportData {
  return setRoutes(state, state.routes.map((r) => {
    if (r.code !== routeCode) return r;
    const i = r.stops.findIndex((s) => s.id === stopId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= r.stops.length) return r;
    const stops = [...r.stops];
    [stops[i], stops[j]] = [stops[j], stops[i]];
    return retime({ ...r, stops });
  }));
}

export function moveStops(state: TransportData, stopIds: string[], toRoute: string): TransportData {
  const ids = new Set(stopIds);
  const moving: RouteStop[] = [];
  state.routes.forEach((r) => r.stops.forEach((s) => { if (ids.has(s.id) && r.code !== toRoute) moving.push(s); }));
  if (moving.length === 0) return state;
  const movingIds = new Set(moving.map((s) => s.id));
  const target = state.routes.find((r) => r.code === toRoute);
  const routes = state.routes.map((r) => {
    if (r.code === toRoute) return retime({ ...r, stops: [...r.stops, ...moving] });
    if (r.stops.some((s) => movingIds.has(s.id))) return retime({ ...r, stops: r.stops.filter((s) => !movingIds.has(s.id)) });
    return r;
  });
  // Students boarding at moved stops now ride the destination route's bus.
  const students = target
    ? state.students.map((s) => (s.stopId && movingIds.has(s.stopId) ? { ...s, routeCode: target.code, busReg: target.busReg } : s))
    : state.students;
  return { ...state, routes, students };
}

export function removeStops(state: TransportData, stopIds: string[]): TransportData {
  const ids = new Set(stopIds);
  const routes = state.routes.map((r) => (r.stops.some((s) => ids.has(s.id)) ? retime({ ...r, stops: r.stops.filter((s) => !ids.has(s.id)) }) : r));
  const students = state.students.map((s) => (s.stopId && ids.has(s.stopId) ? pendingStudent(s) : s));
  return { ...state, routes, students };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export interface RoutePatch {
  name: string; zone: TransportRoute["zone"]; busReg: string; driverName: string; attendantName: string; firstPickup: string;
}

/** Route bus / crew edits flow to Vehicles (route + driver columns), Drivers and Attendants. */
function linkCrew(state: TransportData, route: TransportRoute, prevBus: string | null): TransportData {
  const label = `${route.code} · ${route.name}`;
  const driver = state.drivers.find((d) => d.name === route.driverName);
  const vehicles = state.vehicles.map((v) => {
    if (v.reg === route.busReg) return { ...v, routeCode: route.code, driverId: driver ? driver.id : v.driverId };
    if (prevBus && v.reg === prevBus && v.routeCode === route.code) return { ...v, routeCode: null };
    return v;
  });
  const drivers = state.drivers.map((d) => (d.name === route.driverName ? { ...d, vehicleReg: route.busReg, routeLabel: label } : d));
  const attendants = state.attendants.map((a) => (a.name === route.attendantName ? { ...a, busReg: route.busReg, routeLabel: label } : a));
  const students = state.students.map((s) => (s.routeCode === route.code ? { ...s, busReg: route.busReg } : s));
  return { ...state, vehicles, drivers, attendants, students };
}

export function updateRoute(state: TransportData, code: string, patch: RoutePatch): TransportData {
  const prev = state.routes.find((r) => r.code === code);
  if (!prev) return state;
  const updated = retime({ ...prev, ...patch });
  const next = setRoutes(state, state.routes.map((r) => (r.code === code ? updated : r)));
  return linkCrew(next, updated, prev.busReg !== updated.busReg ? prev.busReg : null);
}

export interface NewRouteInput {
  code: string; name: string; shift: TransportRoute["shift"]; firstPickup: string;
  stopNames: string[]; busReg: string; driverName: string; attendantName: string;
}

export function addRoute(state: TransportData, input: NewRouteInput): TransportData {
  const geoIdx = state.routes.length + state.archivedRoutes.length;
  const n = input.stopNames.length;
  let counter = state.stopCounter;
  const stops: RouteStop[] = input.stopNames.map((name, i) => {
    counter += 1;
    const pos = stopPoint(geoIdx, i, Math.max(2, n));
    const ll = latLngFromXY(pos.x, pos.y);
    return {
      id: `S${counter}`, pickupId: `PP-${pad(counter, 3)}`, name, routeCode: input.code, seq: i + 1,
      landmark: "new stop", students: 0, fare: 1500 + i * 150, pickupTime: "", dropTime: "",
      x: pos.x, y: pos.y, lat: ll.lat, lng: ll.lng,
    };
  });
  const route = retime({
    code: input.code, name: input.name, zone: "West", busReg: input.busReg, driverName: input.driverName,
    attendantName: input.attendantName, firstPickup: input.firstPickup, capacity: 42, routeTimeMin: 0, distanceKm: 0,
    geoIdx, angleDeg: geoIdx * 40 - 80, shift: input.shift, stops,
  });
  const next = { ...setRoutes(state, [...state.routes, route]), stopCounter: counter };
  return linkCrew(next, route, null);
}

export function archiveRoute(state: TransportData, code: string): TransportData {
  const route = state.routes.find((r) => r.code === code);
  if (!route) return state;
  return {
    ...state,
    routes: state.routes.filter((r) => r.code !== code),
    archivedRoutes: [...state.archivedRoutes, route],
    vehicles: state.vehicles.map((v) => (v.routeCode === code ? { ...v, routeCode: null } : v)),
    students: state.students.map((s) => (s.routeCode === code ? pendingStudent(s) : s)),
  };
}

// ─── Drivers ─────────────────────────────────────────────────────────────────

function vehicleRouteLabel(state: TransportData, reg: string): string {
  const v = state.vehicles.find((x) => x.reg === reg && !x.archived);
  return v?.routeCode ? routeLabel(state.routes, v.routeCode) : "—";
}

/** Point one vehicle at a driver (and release whatever vehicle that driver had). */
function linkDriverVehicle(state: TransportData, driverId: string, reg: string): TransportData {
  return {
    ...state,
    vehicles: state.vehicles.map((v) => {
      if (v.reg === reg) return { ...v, driverId };
      if (v.driverId === driverId) return { ...v, driverId: null };
      return v;
    }),
  };
}

export type DriverInput = Pick<Driver, "name" | "phone" | "licenceNo" | "licenceValidTill" | "shift" | "status" | "vehicleReg" | "experience">;

export function addDriver(state: TransportData, id: string, input: DriverInput): TransportData {
  const driver: Driver = {
    ...input, id, rating: 5.0, routeLabel: input.vehicleReg === "Unassigned" ? "—" : vehicleRouteLabel(state, input.vehicleReg),
    online: isOnline(input.status), tripsThisMonth: 0, badgeNo: `PSV-${id.replace(/\D/g, "")}72`, emergencyContact: "+91 97••• ••208",
  };
  const next = { ...state, drivers: [...state.drivers, driver] };
  return input.vehicleReg === "Unassigned" ? next : linkDriverVehicle(next, id, input.vehicleReg);
}

export function updateDriver(state: TransportData, id: string, patch: Partial<DriverInput>): TransportData {
  const prev = state.drivers.find((d) => d.id === id);
  if (!prev) return state;
  const vehicleChanged = patch.vehicleReg !== undefined && patch.vehicleReg !== prev.vehicleReg;
  const drivers = state.drivers.map((d) => {
    if (d.id !== id) return d;
    const merged = { ...d, ...patch };
    return {
      ...merged,
      online: isOnline(merged.status),
      routeLabel: vehicleChanged ? (merged.vehicleReg === "Unassigned" ? "—" : vehicleRouteLabel(state, merged.vehicleReg)) : merged.routeLabel,
    };
  });
  const next = { ...state, drivers };
  if (!vehicleChanged) return next;
  if (patch.vehicleReg === "Unassigned") return { ...next, vehicles: next.vehicles.map((v) => (v.driverId === id ? { ...v, driverId: null } : v)) };
  return linkDriverVehicle(next, id, patch.vehicleReg!);
}

export function deactivateDriver(state: TransportData, id: string): TransportData {
  return updateDriver(state, id, { status: "Inactive", vehicleReg: "Unassigned" });
}

export function archiveDrivers(state: TransportData, ids: string[]): TransportData {
  const set = new Set(ids);
  return {
    ...state,
    drivers: state.drivers.map((d) => (set.has(d.id) ? { ...d, archived: true, online: false } : d)),
    vehicles: state.vehicles.map((v) => (v.driverId && set.has(v.driverId) ? { ...v, driverId: null } : v)),
  };
}

export function assignDriversVehicle(state: TransportData, ids: string[], reg: string): TransportData {
  return ids.reduce((s, id) => updateDriver(s, id, { vehicleReg: reg }), state);
}

// ─── Attendants ──────────────────────────────────────────────────────────────

export type AttendantInput = Pick<Attendant, "name" | "phone" | "certificateNo" | "firstAidValidTill" | "shift" | "status" | "busReg" | "experience">;

export function addAttendant(state: TransportData, id: string, input: AttendantInput): TransportData {
  const attendant: Attendant = {
    ...input, id, routeLabel: input.busReg === "Unassigned" ? "—" : vehicleRouteLabel(state, input.busReg),
    trips: 0, studentsOnBus: 0, emergencyContact: "+91 96••• ••714",
  };
  return { ...state, attendants: [...state.attendants, attendant] };
}

export function updateAttendant(state: TransportData, id: string, patch: Partial<AttendantInput>): TransportData {
  return {
    ...state,
    attendants: state.attendants.map((a) => {
      if (a.id !== id) return a;
      const merged = { ...a, ...patch };
      const busChanged = patch.busReg !== undefined && patch.busReg !== a.busReg;
      return busChanged
        ? { ...merged, routeLabel: merged.busReg === "Unassigned" ? "—" : vehicleRouteLabel(state, merged.busReg) }
        : merged;
    }),
  };
}

export function archiveAttendants(state: TransportData, ids: string[]): TransportData {
  const set = new Set(ids);
  return { ...state, attendants: state.attendants.map((a) => (set.has(a.id) ? { ...a, archived: true } : a)) };
}

export function assignAttendantsBus(state: TransportData, ids: string[], reg: string): TransportData {
  return ids.reduce((s, id) => updateAttendant(s, id, { busReg: reg }), state);
}

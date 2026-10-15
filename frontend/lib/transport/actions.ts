/**
 * Store actions → Transport API calls. Every screen dispatches the same actions
 * as before; each one is now carried out by the backend, after which the store
 * reloads, so every screen shows what was actually saved.
 */
import {
  ALERT_TYPE_VALUE, ALLOCATION_STATUS, DOC_FIELD, ROUTE_SHIFT, STAFF_SHIFT, STAFF_STATUS, VEHICLE_STATUS, VEHICLE_TYPE,
  invert, logReport, pkOf, tlist, tsend, type TransportData,
} from "./api";
import { defaultStopFare } from "./fares";
import type {
  AlertSeverity, AlertType, AllocationStatus, Attendant, AttendanceEntry, AttendanceShift, Driver, GeneratedReport,
  ServiceRecord, ServiceStatus, TransportAlert, TransportRoute, TransportSettings, Vehicle, VehicleDoc,
} from "./types";

// ─── Inputs (shapes the screens build) ───────────────────────────────────────

export type NewVehicleInput = Pick<Vehicle, "reg" | "model" | "type" | "routeCode" | "driverId" | "fitness" | "insurance" | "status">
  & Partial<Pick<Vehicle, "permit" | "puc">>;

export interface StopInput {
  name: string; landmark: string; fare: number;
  /** Required by the backend for a new stop; the screens' stop forms collect it. */
  lat?: number; lng?: number;
  pickupTime?: string; dropTime?: string;
}

export interface RoutePatch {
  name: string; zone: TransportRoute["zone"]; busReg: string; driverName: string; attendantName: string; firstPickup: string;
}

export interface NewRouteInput {
  code: string; name: string; shift: TransportRoute["shift"]; firstPickup: string;
  stops: { name: string; lat: number; lng: number }[];
  busReg: string; driverName: string; attendantName: string;
}

export type DriverInput = Pick<Driver, "licenceNo" | "licenceValidTill" | "shift" | "status" | "vehicleReg" | "experience">;
export type AttendantInput = Pick<Attendant, "certificateNo" | "firstAidValidTill" | "shift" | "status" | "busReg" | "experience">;

export type ServiceInput = Pick<ServiceRecord, "vehicleId" | "date" | "type" | "workDone" | "cost" | "odometer" | "vendor" | "status">;
export interface FuelInput { vehicleId: string; date: string; litres: number; rate: number; odometer: number; station: string }

export interface RaiseAlertInput {
  title: string; type: AlertType; severity: AlertSeverity; routeCode: string; detail: string;
  state: TransportAlert["state"]; owner?: string;
  /** The bus the alert is about (Live Tracking); otherwise the route's bus is used. */
  vehicleReg?: string;
}

export type TransportAction =
  | { type: "vehicle/add"; vehicle: NewVehicleInput }
  | { type: "vehicle/update"; id: string; patch: Partial<Vehicle> }
  | { type: "vehicle/archive"; ids: string[] }
  | { type: "vehicle/assignRoute"; ids: string[]; routeCode: string }
  | { type: "vehicle/breakdown"; id: string }
  | { type: "vehicle/renewDoc"; id: string; doc: VehicleDoc; validTill: string; owner: string }
  | { type: "route/add"; input: NewRouteInput }
  | { type: "route/update"; code: string; patch: RoutePatch }
  | { type: "route/archive"; code: string }
  | { type: "stop/add"; routeCode: string; input: StopInput }
  | { type: "stop/update"; id: string; patch: Partial<StopInput> & { routeCode?: string } }
  | { type: "stop/reorder"; routeCode: string; id: string; dir: -1 | 1 }
  | { type: "stop/move"; ids: string[]; routeCode: string }
  | { type: "stop/remove"; ids: string[] }
  | { type: "driver/add"; staffPk: number; input: DriverInput }
  | { type: "driver/update"; id: string; patch: Partial<DriverInput> }
  | { type: "driver/deactivate"; id: string }
  | { type: "driver/archive"; ids: string[] }
  | { type: "driver/assignVehicle"; ids: string[]; reg: string }
  | { type: "attendant/add"; staffPk: number; input: AttendantInput }
  | { type: "attendant/update"; id: string; patch: Partial<AttendantInput> }
  | { type: "attendant/archive"; ids: string[] }
  | { type: "attendant/assignBus"; ids: string[]; reg: string }
  | { type: "student/allocate"; ids: string[]; routeCode: string; stopId: string }
  | { type: "student/update"; id: string; routeCode: string; stopId: string; status: AllocationStatus }
  | { type: "student/remove"; ids: string[] }
  | { type: "attendance/set"; shift: AttendanceShift; date: string; entries: Record<string, AttendanceEntry>; change: string }
  | { type: "alert/ack"; ids: string[]; owner: string }
  | { type: "alert/resolve"; ids: string[]; owner: string }
  | { type: "alert/raise"; input: RaiseAlertInput }
  | { type: "service/add"; input: ServiceInput }
  | { type: "service/update"; id: string; patch: Partial<ServiceInput> }
  | { type: "service/complete"; ids: string[] }
  | { type: "service/delete"; ids: string[] }
  | { type: "fuel/add"; input: FuelInput }
  | { type: "fuel/update"; id: string; input: FuelInput }
  | { type: "fuel/verify"; ids: string[] }
  | { type: "fuel/delete"; ids: string[] }
  | { type: "report/add"; row: GeneratedReport; scheduled: boolean }
  | { type: "settings/save"; patch: Partial<TransportSettings> };

// ─── Lookups ─────────────────────────────────────────────────────────────────

const TYPE_VALUE = invert(VEHICLE_TYPE);
const STATUS_VALUE = invert(VEHICLE_STATUS);
const ROUTE_SHIFT_VALUE = invert(ROUTE_SHIFT);
const STAFF_SHIFT_VALUE = invert(STAFF_SHIFT);
const STAFF_STATUS_VALUE = invert(STAFF_STATUS);
const ALLOCATION_VALUE = invert(ALLOCATION_STATUS);
const SERVICE_STATUS_VALUE: Record<ServiceStatus, string> = {
  Completed: "completed", "In workshop": "in_workshop", Overdue: "scheduled", "Due soon": "scheduled", Scheduled: "scheduled",
};

function routeByCode(state: TransportData, code: string | null | undefined): TransportRoute | undefined {
  if (!code) return undefined;
  return state.routes.find((r) => r.code === code) ?? state.archivedRoutes.find((r) => r.code === code);
}

function requireRoute(state: TransportData, code: string): TransportRoute {
  const route = routeByCode(state, code);
  if (!route) throw new Error(`Route ${code} was not found. Refresh and try again.`);
  return route;
}

function vehiclePkByReg(state: TransportData, reg: string | null | undefined): number | null {
  if (!reg || reg === "Unassigned") return null;
  const vehicle = state.vehicles.find((v) => v.reg === reg && !v.archived);
  if (!vehicle) throw new Error(`Vehicle ${reg} was not found.`);
  return vehicle.pk;
}

function driverStaffPk(state: TransportData, driverId: string | null | undefined): number | null {
  if (!driverId) return null;
  return state.drivers.find((d) => d.id === driverId)?.staffPk ?? null;
}

const dateOrNull = (iso: string | undefined) => (iso ? iso : null);

// ─── Shared steps ────────────────────────────────────────────────────────────

/** Point vehicles at a route (AssignVehicle rows); other active assignments of those vehicles are switched off. */
async function assignVehiclesToRoute(state: TransportData, vehiclePks: number[], routePk: number | null) {
  const assignments = await tlist("/assign-vehicles/");
  for (const vehiclePk of vehiclePks) {
    const mine = assignments.filter((a) => a.vehicle === vehiclePk);
    for (const a of mine) {
      if (a.active_status && a.route !== routePk) await tsend(`/assign-vehicles/${a.id}/`, "PATCH", { active_status: false });
    }
    if (routePk === null) continue;
    const existing = mine.find((a) => a.route === routePk);
    if (existing) {
      if (!existing.active_status) await tsend(`/assign-vehicles/${existing.id}/`, "PATCH", { active_status: true });
    } else {
      await tsend("/assign-vehicles/", "POST", { vehicle: vehiclePk, route: routePk, active_status: true });
    }
  }
}

/** Route crew: bus → assignment, driver → Vehicle.driver, attendant → profile's assigned vehicle. */
async function applyCrew(state: TransportData, routePk: number, crew: { busReg: string; driverName: string; attendantName: string }) {
  const vehiclePk = vehiclePkByReg(state, crew.busReg);
  if (vehiclePk === null) return;
  await assignVehiclesToRoute(state, [vehiclePk], routePk);
  const driver = state.drivers.find((d) => d.name === crew.driverName);
  if (driver) await tsend(`/transport-staff/${driver.pk}/`, "PATCH", { vehicle: vehiclePk });
  const attendant = state.attendants.find((a) => a.name === crew.attendantName);
  if (attendant) await tsend(`/transport-staff/${attendant.pk}/`, "PATCH", { vehicle: vehiclePk });
}

function allocationIdsWhere(state: TransportData, match: (stopId: string | null, routeCode: string | null) => boolean): number[] {
  return state.students
    .filter((s) => s.allocationId !== null && s.status === "Allocated" && match(s.stopId, s.routeCode))
    .map((s) => s.allocationId as number);
}

async function release(allocationIds: number[]) {
  if (allocationIds.length) await tsend("/transport-allocations/release/", "POST", { ids: allocationIds });
}

/** Students at moved stops follow the stop to its new route (re-allocated there). */
async function moveStopStudents(state: TransportData, stopIds: string[], route: TransportRoute) {
  const moving = new Set(stopIds);
  const byStop = new Map<string, number[]>();
  state.students.filter((s) => s.status === "Allocated" && s.stopId && moving.has(s.stopId)).forEach((s) => {
    byStop.set(s.stopId!, [...(byStop.get(s.stopId!) ?? []), s.pk]);
  });
  for (const [stopId, students] of byStop) {
    await tsend("/transport-allocations/bulk-allocate/", "POST", { students, route: route.pk, stop: pkOf(stopId) });
  }
}

function stopBody(input: Partial<StopInput>) {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.stop_name = input.name;
  if (input.landmark !== undefined) body.landmark = input.landmark;
  if (input.fare !== undefined) body.monthly_fare = input.fare;
  if (input.lat !== undefined) body.latitude = Math.round(input.lat * 1e6) / 1e6;
  if (input.lng !== undefined) body.longitude = Math.round(input.lng * 1e6) / 1e6;
  if (input.pickupTime !== undefined) body.scheduled_time = input.pickupTime || null;
  if (input.dropTime !== undefined) body.drop_time = input.dropTime || null;
  return body;
}

function staffBody(input: Partial<DriverInput & AttendantInput>, state: TransportData) {
  const body: Record<string, unknown> = {};
  if (input.shift !== undefined) body.shift = STAFF_SHIFT_VALUE[input.shift];
  if (input.status !== undefined) body.duty_status = STAFF_STATUS_VALUE[input.status];
  if (input.experience !== undefined) body.experience_years = input.experience;
  if (input.licenceNo !== undefined) body.licence_number = input.licenceNo;
  if (input.licenceValidTill !== undefined) body.licence_valid_till = dateOrNull(input.licenceValidTill);
  if (input.certificateNo !== undefined) body.first_aid_certificate_no = input.certificateNo;
  if (input.firstAidValidTill !== undefined) body.first_aid_valid_till = dateOrNull(input.firstAidValidTill);
  if (input.vehicleReg !== undefined) body.vehicle = vehiclePkByReg(state, input.vehicleReg);
  if (input.busReg !== undefined) body.vehicle = vehiclePkByReg(state, input.busReg);
  return body;
}

function vehicleBody(state: TransportData, patch: Partial<Vehicle>) {
  const body: Record<string, unknown> = {};
  if (patch.reg !== undefined) body.vehicle_no = patch.reg;
  if (patch.model !== undefined) body.vehicle_model = patch.model;
  if (patch.type !== undefined) body.vehicle_type = TYPE_VALUE[patch.type];
  if (patch.status !== undefined) body.operational_status = STATUS_VALUE[patch.status];
  if (patch.fitness !== undefined) body.fitness_valid_till = dateOrNull(patch.fitness);
  if (patch.insurance !== undefined) body.insurance_valid_till = dateOrNull(patch.insurance);
  if (patch.permit !== undefined) body.permit_valid_till = dateOrNull(patch.permit);
  if (patch.puc !== undefined) body.pollution_valid_till = dateOrNull(patch.puc);
  if (patch.odometer !== undefined) body.odometer_km = patch.odometer;
  if (patch.driverId !== undefined) body.driver = driverStaffPk(state, patch.driverId);
  return body;
}

function serviceBody(input: Partial<ServiceInput>) {
  const body: Record<string, unknown> = {};
  if (input.vehicleId !== undefined) body.vehicle = pkOf(input.vehicleId);
  if (input.date !== undefined) body.service_date = input.date;
  if (input.type !== undefined) body.service_type = input.type;
  if (input.workDone !== undefined) body.work_done = input.workDone;
  if (input.cost !== undefined) body.cost = input.cost;
  if (input.odometer !== undefined) body.odometer_km = input.odometer || null;
  if (input.vendor !== undefined) body.vendor = input.vendor;
  if (input.status !== undefined) body.status = SERVICE_STATUS_VALUE[input.status];
  return body;
}

function fuelBody(input: FuelInput) {
  return {
    vehicle: pkOf(input.vehicleId), date: input.date, litres: input.litres, rate: input.rate,
    odometer_km: input.odometer, station: input.station,
  };
}

const pks = (ids: string[]) => ids.map(pkOf);

// ─── Dispatcher ──────────────────────────────────────────────────────────────

export async function performAction(action: TransportAction, state: TransportData): Promise<void> {
  switch (action.type) {
    case "vehicle/add": {
      const created = await tsend<{ id: number }>("/vehicles/", "POST", {
        ...vehicleBody(state, action.vehicle), active_status: true,
      });
      const route = routeByCode(state, action.vehicle.routeCode);
      if (route) await assignVehiclesToRoute(state, [created.id], route.pk);
      return;
    }
    case "vehicle/update": {
      const pk = pkOf(action.id);
      const body = vehicleBody(state, action.patch);
      if (Object.keys(body).length) await tsend(`/vehicles/${pk}/`, "PATCH", body);
      if (action.patch.routeCode !== undefined) {
        await assignVehiclesToRoute(state, [pk], routeByCode(state, action.patch.routeCode)?.pk ?? null);
      }
      return;
    }
    case "vehicle/archive":
      for (const pk of pks(action.ids)) await tsend(`/vehicles/${pk}/archive/`, "POST");
      return;
    case "vehicle/assignRoute":
      await assignVehiclesToRoute(state, pks(action.ids), requireRoute(state, action.routeCode).pk);
      return;
    case "vehicle/breakdown":
      await tsend(`/vehicles/${pkOf(action.id)}/mark-breakdown/`, "POST");
      return;
    case "vehicle/renewDoc":
      await tsend(`/vehicles/${pkOf(action.id)}/renew-document/`, "POST", { document: DOC_FIELD[action.doc], valid_till: action.validTill });
      return;

    case "route/add": {
      const { input } = action;
      const route = await tsend<{ id: number }>("/transport-routes/", "POST", {
        title: input.name, code: input.code, shift: ROUTE_SHIFT_VALUE[input.shift],
        first_pickup_time: input.firstPickup || null, fare: defaultStopFare(state.settings.fareSlabs) ?? 0, active_status: true,
      });
      for (const [i, stop] of input.stops.entries()) {
        await tsend("/bus-stops/", "POST", { route: route.id, stop_order: i + 1, ...stopBody({ name: stop.name, landmark: "", lat: stop.lat, lng: stop.lng }) });
      }
      await applyCrew(state, route.id, input);
      return;
    }
    case "route/update": {
      const route = requireRoute(state, action.code);
      const { patch } = action;
      await tsend(`/transport-routes/${route.pk}/`, "PATCH", { title: patch.name, zone: patch.zone, first_pickup_time: patch.firstPickup || null });
      if (patch.busReg !== route.busReg || patch.driverName !== route.driverName || patch.attendantName !== route.attendantName) {
        // The bus chosen in the form replaces the route's previous bus (other buses on the route are left alone).
        const previousBus = route.busReg ? state.vehicles.find((v) => v.reg === route.busReg) : undefined;
        if (previousBus && patch.busReg && patch.busReg !== route.busReg) {
          const stale = (await tlist("/assign-vehicles/")).filter((a) => a.vehicle === previousBus.pk && a.route === route.pk && a.active_status);
          for (const a of stale) await tsend(`/assign-vehicles/${a.id}/`, "PATCH", { active_status: false });
        }
        // Likewise the chosen attendant replaces the previous one on that bus.
        const previousAttendant = route.attendantName ? state.attendants.find((a) => a.name === route.attendantName && a.busReg === route.busReg) : undefined;
        if (previousAttendant && patch.attendantName !== route.attendantName) await tsend(`/transport-staff/${previousAttendant.pk}/`, "PATCH", { vehicle: null });
        await applyCrew(state, route.pk, patch);
      }
      return;
    }
    case "route/archive": {
      const route = requireRoute(state, action.code);
      await release(allocationIdsWhere(state, (_stop, code) => code === route.code));
      const busPks = state.vehicles.filter((v) => v.routeCode === route.code).map((v) => v.pk);
      await assignVehiclesToRoute(state, busPks, null);
      await tsend(`/transport-routes/${route.pk}/`, "PATCH", { active_status: false });
      return;
    }

    case "stop/add": {
      const route = requireRoute(state, action.routeCode);
      if (action.input.lat === undefined || action.input.lng === undefined) throw new Error("Set the stop's latitude and longitude.");
      await tsend("/bus-stops/", "POST", { route: route.pk, ...stopBody(action.input) });
      return;
    }
    case "stop/update": {
      const { routeCode, ...rest } = action.patch;
      const body = stopBody(rest);
      const target = routeCode ? requireRoute(state, routeCode) : undefined;
      const current = state.routes.find((r) => r.stops.some((s) => s.id === action.id));
      if (target && target.code !== current?.code) body.route = target.pk;
      if (Object.keys(body).length) await tsend(`/bus-stops/${pkOf(action.id)}/`, "PATCH", body);
      if (target && target.code !== current?.code) await moveStopStudents(state, [action.id], target);
      return;
    }
    case "stop/reorder": {
      const route = requireRoute(state, action.routeCode);
      const order = route.stops.map((s) => s.id);
      const i = order.indexOf(action.id);
      const j = i + action.dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      await tsend("/bus-stops/reorder/", "PUT", { stops: order.map((id, k) => ({ id: pkOf(id), stop_order: k + 1 })) });
      return;
    }
    case "stop/move": {
      const target = requireRoute(state, action.routeCode);
      const moving = action.ids.filter((id) => !target.stops.some((s) => s.id === id));
      let order = target.stops.length;
      for (const id of moving) {
        order += 1;
        await tsend(`/bus-stops/${pkOf(id)}/`, "PATCH", { route: target.pk, stop_order: order });
      }
      await moveStopStudents(state, moving, target);
      return;
    }
    case "stop/remove": {
      const removing = new Set(action.ids);
      await release(allocationIdsWhere(state, (stopId) => !!stopId && removing.has(stopId)));
      for (const pk of pks(action.ids)) await tsend(`/bus-stops/${pk}/`, "DELETE");
      return;
    }

    case "driver/add":
      await tsend("/transport-staff/", "POST", { staff: action.staffPk, role: "driver", ...staffBody(action.input, state) });
      return;
    case "attendant/add":
      await tsend("/transport-staff/", "POST", { staff: action.staffPk, role: "attendant", ...staffBody(action.input, state) });
      return;
    case "driver/update":
    case "attendant/update":
      await tsend(`/transport-staff/${pkOf(action.id)}/`, "PATCH", staffBody(action.patch, state));
      return;
    case "driver/deactivate":
      await tsend(`/transport-staff/${pkOf(action.id)}/`, "PATCH", { duty_status: "inactive", vehicle: null });
      return;
    case "driver/archive":
    case "attendant/archive":
      // Removes the transport profile only; the HR staff record is untouched.
      for (const pk of pks(action.ids)) await tsend(`/transport-staff/${pk}/`, "DELETE");
      return;
    case "driver/assignVehicle":
    case "attendant/assignBus": {
      const vehicle = vehiclePkByReg(state, action.reg);
      for (const pk of pks(action.ids)) await tsend(`/transport-staff/${pk}/`, "PATCH", { vehicle });
      return;
    }

    case "student/allocate": {
      const route = requireRoute(state, action.routeCode);
      await tsend("/transport-allocations/bulk-allocate/", "POST", { students: pks(action.ids), route: route.pk, stop: pkOf(action.stopId) });
      return;
    }
    case "student/update": {
      if (action.status === "Allocated") {
        const route = requireRoute(state, action.routeCode);
        await tsend("/transport-allocations/bulk-allocate/", "POST", { students: [pkOf(action.id)], route: route.pk, stop: pkOf(action.stopId) });
        return;
      }
      const student = [...state.students, ...state.studentPool].find((s) => s.id === action.id);
      const body = { status: ALLOCATION_VALUE[action.status], route: null, stop: null, vehicle: null };
      if (student?.allocationId) await tsend(`/transport-allocations/${student.allocationId}/`, "PATCH", body);
      else await tsend("/transport-allocations/", "POST", { ...body, student: pkOf(action.id) });
      return;
    }
    case "student/remove": {
      const wanted = new Set(action.ids);
      await release(state.students.filter((s) => wanted.has(s.id) && s.allocationId !== null).map((s) => s.allocationId as number));
      return;
    }

    case "attendance/set":
      await tsend("/transport-attendance/mark/", "POST", {
        date: action.date, shift: action.shift,
        entries: Object.entries(action.entries).map(([id, e]) => ({ student: pkOf(id), boarded: e.boarded, late: e.late, note: e.note ?? "" })),
      });
      return;

    case "alert/ack":
      await tsend("/transport-alerts/bulk-acknowledge/", "POST", { ids: pks(action.ids) });
      return;
    case "alert/resolve":
      await tsend("/transport-alerts/bulk-resolve/", "POST", { ids: pks(action.ids) });
      return;
    case "alert/raise": {
      const { input } = action;
      const route = routeByCode(state, input.routeCode);
      const vehicle = (input.vehicleReg ? state.vehicles.find((v) => !v.archived && v.reg === input.vehicleReg) : undefined)
        ?? state.vehicles.find((v) => !v.archived && v.reg === route?.busReg)
        ?? state.vehicles.find((v) => !v.archived && v.routeCode === input.routeCode);
      if (!vehicle) throw new Error("Alerts need a vehicle: assign a bus to this route first.");
      const created = await tsend<{ id: number }>("/transport-alerts/", "POST", {
        vehicle: vehicle.pk, route: route?.pk ?? null, alert_type: ALERT_TYPE_VALUE[input.type],
        severity: input.severity.toLowerCase(), message: input.detail ? `${input.title} — ${input.detail}` : input.title,
      });
      if (input.state === "acknowledged") await tsend(`/transport-alerts/${created.id}/acknowledge/`, "POST");
      if (input.state === "resolved") await tsend(`/transport-alerts/${created.id}/resolve/`, "POST");
      return;
    }

    case "service/add":
      await tsend("/transport-maintenance/", "POST", serviceBody(action.input));
      return;
    case "service/update":
      await tsend(`/transport-maintenance/${pkOf(action.id)}/`, "PATCH", serviceBody(action.patch));
      return;
    case "service/complete":
      await tsend("/transport-maintenance/complete/", "POST", { ids: pks(action.ids) });
      return;
    case "service/delete":
      await tsend("/transport-maintenance/bulk-delete/", "POST", { ids: pks(action.ids) });
      return;

    case "fuel/add":
      await tsend("/transport-fuel/", "POST", fuelBody(action.input));
      return;
    case "fuel/update":
      await tsend(`/transport-fuel/${pkOf(action.id)}/`, "PATCH", fuelBody(action.input));
      return;
    case "fuel/verify":
      await tsend("/transport-fuel/verify/", "POST", { ids: pks(action.ids) });
      return;
    case "fuel/delete":
      await tsend("/transport-fuel/bulk-delete/", "POST", { ids: pks(action.ids) });
      return;

    case "report/add": {
      // Scheduling has no backend yet - only generated downloads are logged.
      if (action.scheduled) return;
      const report = state.reports.find((r) => r.name === action.row.report);
      if (report) {
        await logReport(report.key, {
          period: action.row.period, scope: action.row.scope, file_format: action.row.format === "Excel" ? "excel" : "pdf",
        });
      }
      return;
    }
    case "settings/save":
      await tsend("/transport-settings/save/", "PATCH", action.patch);
      return;
  }
}

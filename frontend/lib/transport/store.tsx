"use client";
/**
 * Shared Transport store (Master Prompt §0 rule 9) — React context + reducer,
 * since the repo does not use Zustand. Mounted once in
 * app/(dashboard)/transport/layout.tsx so an action on one tab is reflected on
 * every other tab. Data resets on full page reload by design.
 */
import { createContext, useContext, useMemo, useReducer } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { capacityOf, seedTransportData, type TransportData } from "./mock";
import { pad } from "./format";
import * as ops from "./ops";
import * as ops3 from "./ops3";
import * as ops4 from "./ops4";
import type { AllocationStatus, AttendanceEntry, AttendanceShift, GeneratedReport, TransportSettings, Vehicle, VehicleDoc } from "./types";

export type TransportAction =
  | { type: "vehicle/add"; vehicle: Omit<Vehicle, "id" | "occupied" | "odometer" | "fuelMtd" | "permit" | "puc"> }
  | { type: "vehicle/update"; id: string; patch: Partial<Vehicle> }
  | { type: "vehicle/archive"; ids: string[] }
  | { type: "vehicle/assignRoute"; ids: string[]; routeCode: string }
  | { type: "vehicle/breakdown"; id: string }
  | { type: "vehicle/renewDoc"; id: string; doc: VehicleDoc; validTill: string; owner: string }
  // Phase 2 — routes & stops (pickup points are the same records as route stops)
  | { type: "route/add"; input: ops.NewRouteInput }
  | { type: "route/update"; code: string; patch: ops.RoutePatch }
  | { type: "route/archive"; code: string }
  | { type: "stop/add"; routeCode: string; input: ops.StopInput }
  | { type: "stop/update"; id: string; patch: Partial<ops.StopInput> & { routeCode?: string } }
  | { type: "stop/reorder"; routeCode: string; id: string; dir: -1 | 1 }
  | { type: "stop/move"; ids: string[]; routeCode: string }
  | { type: "stop/remove"; ids: string[] }
  // Phase 2 — drivers & attendants
  | { type: "driver/add"; id: string; input: ops.DriverInput }
  | { type: "driver/update"; id: string; patch: Partial<ops.DriverInput> }
  | { type: "driver/deactivate"; id: string }
  | { type: "driver/archive"; ids: string[] }
  | { type: "driver/assignVehicle"; ids: string[]; reg: string }
  | { type: "attendant/add"; id: string; input: ops.AttendantInput }
  | { type: "attendant/update"; id: string; patch: Partial<ops.AttendantInput> }
  | { type: "attendant/archive"; ids: string[] }
  | { type: "attendant/assignBus"; ids: string[]; reg: string }
  // Phase 3 — allocation, boarding registers, alerts
  | { type: "student/allocate"; ids: string[]; routeCode: string; stopId: string }
  | { type: "student/update"; id: string; routeCode: string; stopId: string; status: AllocationStatus }
  | { type: "student/remove"; ids: string[] }
  | { type: "attendance/set"; shift: AttendanceShift; dateIdx: number; entries: Record<string, AttendanceEntry>; change: string }
  | { type: "alert/ack"; ids: string[]; owner: string }
  | { type: "alert/resolve"; ids: string[]; owner: string }
  | { type: "alert/raise"; input: ops3.RaiseAlertInput }
  // Phase 4 — maintenance, fuel, reports, settings
  | { type: "service/add"; input: ops4.ServiceInput }
  | { type: "service/update"; id: string; patch: Partial<ops4.ServiceInput> }
  | { type: "service/complete"; ids: string[] }
  | { type: "service/delete"; ids: string[] }
  | { type: "fuel/add"; input: ops4.FuelInput }
  | { type: "fuel/update"; id: string; input: ops4.FuelInput }
  | { type: "fuel/verify"; ids: string[] }
  | { type: "fuel/delete"; ids: string[] }
  | { type: "report/add"; row: GeneratedReport; scheduled: boolean }
  | { type: "settings/save"; patch: Partial<TransportSettings> };

const DOC_FIELD: Record<VehicleDoc, "fitness" | "insurance" | "permit" | "puc"> = {
  "Fitness certificate": "fitness",
  Insurance: "insurance",
  "Road permit": "permit",
  "Pollution (PUC)": "puc",
};

export function docField(doc: VehicleDoc) {
  return DOC_FIELD[doc];
}

/** Next sequential id: VH-019, DR-117, … */
export function nextId(ids: string[], prefix: string, width: number): string {
  const max = ids.reduce((m, id) => {
    const n = Number(id.replace(/\D/g, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${pad(max + 1, width)}`;
}

function clampOccupied(v: Vehicle): Vehicle {
  return { ...v, occupied: Math.min(v.occupied, capacityOf(v)) };
}

function reducer(state: TransportData, action: TransportAction): TransportData {
  switch (action.type) {
    case "vehicle/add": {
      const vehicle: Vehicle = {
        ...action.vehicle,
        id: nextId(state.vehicles.map((v) => v.id), "VH-", 3),
        occupied: 0,
        odometer: 0,
        fuelMtd: 0,
        permit: "2027-03-31",
        puc: "2027-01-18",
      };
      return { ...state, vehicles: [...state.vehicles, vehicle] };
    }
    case "vehicle/update":
      return {
        ...state,
        vehicles: state.vehicles.map((v) => (v.id === action.id ? clampOccupied({ ...v, ...action.patch }) : v)),
      };
    case "vehicle/archive": {
      const ids = new Set(action.ids);
      return { ...state, vehicles: state.vehicles.map((v) => (ids.has(v.id) ? { ...v, archived: true } : v)) };
    }
    case "vehicle/assignRoute": {
      const ids = new Set(action.ids);
      return { ...state, vehicles: state.vehicles.map((v) => (ids.has(v.id) ? { ...v, routeCode: action.routeCode } : v)) };
    }
    case "vehicle/breakdown":
      return {
        ...state,
        vehicles: state.vehicles.map((v) => (v.id === action.id ? { ...v, status: "Breakdown", occupied: 0 } : v)),
      };
    case "vehicle/renewDoc": {
      const field = DOC_FIELD[action.doc];
      return {
        ...state,
        vehicles: state.vehicles.map((v) => (v.id === action.id ? { ...v, [field]: action.validTill } : v)),
        // Renewing a document clears any matching document-expiry alert.
        alerts: state.alerts.map((a) =>
          a.state !== "resolved" && a.type === "Document expiry" && a.ref?.vehicleId === action.id && a.ref?.doc === action.doc
            ? { ...a, state: "resolved", owner: action.owner }
            : a,
        ),
      };
    }
    case "route/add": return ops.addRoute(state, action.input);
    case "route/update": return ops.updateRoute(state, action.code, action.patch);
    case "route/archive": return ops.archiveRoute(state, action.code);
    case "stop/add": return ops.addStop(state, action.routeCode, action.input);
    case "stop/update": return ops.updateStop(state, action.id, action.patch);
    case "stop/reorder": return ops.reorderStop(state, action.routeCode, action.id, action.dir);
    case "stop/move": return ops.moveStops(state, action.ids, action.routeCode);
    case "stop/remove": return ops.removeStops(state, action.ids);
    case "driver/add": return ops.addDriver(state, action.id, action.input);
    case "driver/update": return ops.updateDriver(state, action.id, action.patch);
    case "driver/deactivate": return ops.deactivateDriver(state, action.id);
    case "driver/archive": return ops.archiveDrivers(state, action.ids);
    case "driver/assignVehicle": return ops.assignDriversVehicle(state, action.ids, action.reg);
    case "attendant/add": return ops.addAttendant(state, action.id, action.input);
    case "attendant/update": return ops.updateAttendant(state, action.id, action.patch);
    case "attendant/archive": return ops.archiveAttendants(state, action.ids);
    case "attendant/assignBus": return ops.assignAttendantsBus(state, action.ids, action.reg);
    case "student/allocate": return ops3.allocateStudents(state, action.ids, action.routeCode, action.stopId);
    case "student/update": return ops3.updateAllocation(state, action.id, action.routeCode, action.stopId, action.status);
    case "student/remove": return ops3.removeFromTransport(state, action.ids);
    case "attendance/set": return ops3.setAttendance(state, action.shift, action.dateIdx, action.entries, action.change);
    case "alert/ack": return ops3.acknowledgeAlerts(state, action.ids, action.owner);
    case "alert/resolve": return ops3.resolveAlerts(state, action.ids, action.owner);
    case "alert/raise": return ops3.raiseAlert(state, action.input);
    case "service/add": return ops4.addService(state, action.input);
    case "service/update": return ops4.updateService(state, action.id, action.patch);
    case "service/complete": return ops4.completeServices(state, action.ids);
    case "service/delete": return ops4.deleteServices(state, action.ids);
    case "fuel/add": return ops4.addFuel(state, action.input);
    case "fuel/update": return ops4.updateFuel(state, action.id, action.input);
    case "fuel/verify": return ops4.verifyFuel(state, action.ids);
    case "fuel/delete": return ops4.deleteFuel(state, action.ids);
    case "report/add": return ops4.addRecentReport(state, action.row, action.scheduled);
    case "settings/save": return ops4.saveSettings(state, action.patch);
    default:
      return state;
  }
}

interface Ctx {
  state: TransportData;
  dispatch: React.Dispatch<TransportAction>;
}

const TransportContext = createContext<Ctx | null>(null);

export function TransportProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, seedTransportData);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>;
}

export function useTransport(): Ctx {
  const ctx = useContext(TransportContext);
  if (!ctx) throw new Error("useTransport must be used inside <TransportProvider>");
  return ctx;
}

/** Display name of the signed-in user (owner on acknowledge / resolve). */
export function useOwnerName(): string {
  const { me } = usePermissions();
  return `${me?.first_name ?? ""} ${me?.last_name ?? ""}`.trim() || me?.username || "Transport desk";
}

/** Vehicles that are not archived. */
export function useVehicles(): Vehicle[] {
  const { state } = useTransport();
  return useMemo(() => state.vehicles.filter((v) => !v.archived), [state.vehicles]);
}

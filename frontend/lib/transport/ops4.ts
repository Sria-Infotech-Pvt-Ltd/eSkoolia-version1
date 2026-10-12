/**
 * Phase 4 state operations: maintenance records, fuel log, generated reports
 * and settings (Master Prompt §7.11–§7.14).
 */
import { TODAY, toISO } from "./format";
import { nextIdFrom } from "./ids";
import { baseKml } from "./mock/upkeep";
import type { TransportData } from "./mock";
import type { FuelEntry, GeneratedReport, ServiceRecord, TransportSettings } from "./types";

// ─── Maintenance ─────────────────────────────────────────────────────────────

export type ServiceInput = Omit<ServiceRecord, "id">;

export function nextServiceId(state: TransportData): string {
  return nextIdFrom(state.maintenance.map((r) => r.id), "SV-", 4);
}

export function addService(state: TransportData, input: ServiceInput): TransportData {
  return { ...state, maintenance: [{ ...input, id: nextServiceId(state) }, ...state.maintenance] };
}

export function updateService(state: TransportData, id: string, patch: Partial<ServiceInput>): TransportData {
  return { ...state, maintenance: state.maintenance.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function completeServices(state: TransportData, ids: string[]): TransportData {
  const set = new Set(ids);
  const today = toISO(TODAY);
  return {
    ...state,
    maintenance: state.maintenance.map((r) => (set.has(r.id) && r.status !== "Completed" ? { ...r, status: "Completed", date: today } : r)),
  };
}

export function deleteServices(state: TransportData, ids: string[]): TransportData {
  const set = new Set(ids);
  return { ...state, maintenance: state.maintenance.filter((r) => !set.has(r.id)) };
}

// ─── Fuel ────────────────────────────────────────────────────────────────────

export interface FuelInput { vehicleId: string; date: string; litres: number; rate: number; odometer: number; station: string }

export function nextFuelId(state: TransportData): string {
  return nextIdFrom(state.fuel.map((f) => f.id), "FL-", 4);
}

/** A new entry gets km/L = base × 0.97 (§7.12). */
export function addFuel(state: TransportData, input: FuelInput): TransportData {
  const idx = state.vehicles.findIndex((v) => v.id === input.vehicleId);
  const veh = state.vehicles[idx];
  if (!veh) return state;
  const base = Math.round(baseKml(veh, idx) * 100) / 100;
  const entry: FuelEntry = {
    ...input, id: nextFuelId(state), amount: Math.round(input.litres * input.rate),
    baseKml: base, kml: Math.round(base * 0.97 * 100) / 100, anomaly: false,
  };
  return { ...state, fuel: [entry, ...state.fuel] };
}

export function updateFuel(state: TransportData, id: string, input: FuelInput): TransportData {
  return {
    ...state,
    fuel: state.fuel.map((f) => {
      if (f.id !== id) return f;
      const idx = state.vehicles.findIndex((v) => v.id === input.vehicleId);
      const veh = state.vehicles[idx];
      const base = veh && input.vehicleId !== f.vehicleId ? Math.round(baseKml(veh, idx) * 100) / 100 : f.baseKml;
      return { ...f, ...input, amount: Math.round(input.litres * input.rate), baseKml: base, anomaly: f.kml < base * 0.8 };
    }),
  };
}

export function verifyFuel(state: TransportData, ids: string[]): TransportData {
  const set = new Set(ids);
  return { ...state, fuel: state.fuel.map((f) => (set.has(f.id) ? { ...f, verified: true } : f)) };
}

export function deleteFuel(state: TransportData, ids: string[]): TransportData {
  const set = new Set(ids);
  return { ...state, fuel: state.fuel.filter((f) => !set.has(f.id)) };
}

// ─── Reports & settings ──────────────────────────────────────────────────────

export function addRecentReport(state: TransportData, row: GeneratedReport, scheduled: boolean): TransportData {
  return {
    ...state,
    recentReports: [row, ...state.recentReports],
    reports: scheduled ? state.reports : state.reports.map((r) => (r.name === row.report ? { ...r, lastGenerated: toISO(TODAY) } : r)),
  };
}

export function saveSettings(state: TransportData, patch: Partial<TransportSettings>): TransportData {
  return { ...state, settings: { ...state.settings, ...structuredClone(patch) } };
}

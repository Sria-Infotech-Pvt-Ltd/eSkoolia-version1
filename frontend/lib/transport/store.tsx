"use client";
/**
 * Shared Transport store — React context mounted once in
 * app/(dashboard)/transport/layout.tsx, so every tab reads the same data.
 *
 * Data comes from the Transport APIs (./api). `dispatch(action)` sends the
 * action to the backend (./actions) and then reloads, so what the screens show
 * is always what was saved. Actions run one at a time, in order.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { emptyTransportData, loadRegister as fetchRegister, loadTransportData, registerKey, type TransportData } from "./api";
import { performAction, type TransportAction } from "./actions";
import type { AttendanceShift, Vehicle, VehicleDoc } from "./types";

export type { TransportAction } from "./actions";
export type { TransportData } from "./api";

const DOC_FIELD: Record<VehicleDoc, "fitness" | "insurance" | "permit" | "puc"> = {
  "Fitness certificate": "fitness",
  Insurance: "insurance",
  "Road permit": "permit",
  "Pollution (PUC)": "puc",
};

export function docField(doc: VehicleDoc) {
  return DOC_FIELD[doc];
}

export type LoadStatus = "loading" | "ready" | "error";

interface Ctx {
  state: TransportData;
  /** Saves through the API, then reloads. Resolves false (and sets `error`) when the save failed. */
  dispatch: (action: TransportAction) => Promise<boolean>;
  status: LoadStatus;
  /** True from the moment an action is dispatched until it (and any queued after it) has finished. */
  saving: boolean;
  /** Progress label for the running action ("Adding…", "Saving…", "Deleting…" …); "" when idle. */
  busyText: string;
  /** Message of the most recent failed load / save (for toasts); "" when none. */
  errorText: () => string;
  /** Last load / save error, shown by the Transport layout. */
  error: string | null;
  clearError: () => void;
  reload: () => Promise<void>;
  /** Fetches one boarding register into state.attendance (key "shift|date"). */
  loadRegister: (date: string, shift: AttendanceShift) => Promise<void>;
}

const TransportContext = createContext<Ctx | null>(null);

/** Progress label shown on the button / dialog that started an action. */
const BUSY_TEXT: Partial<Record<TransportAction["type"], string>> = {
  "vehicle/add": "Adding…", "route/add": "Adding…", "stop/add": "Adding…", "driver/add": "Adding…", "attendant/add": "Adding…",
  "service/add": "Adding…", "fuel/add": "Adding…", "alert/raise": "Raising…",
  "vehicle/archive": "Archiving…", "route/archive": "Archiving…", "driver/archive": "Archiving…", "attendant/archive": "Archiving…",
  "stop/remove": "Deleting…", "service/delete": "Deleting…", "fuel/delete": "Deleting…", "student/remove": "Removing…",
  "vehicle/assignRoute": "Assigning…", "driver/assignVehicle": "Assigning…", "attendant/assignBus": "Assigning…", "student/allocate": "Allocating…",
  "stop/move": "Moving…", "stop/reorder": "Reordering…", "alert/ack": "Acknowledging…", "alert/resolve": "Resolving…",
  "service/complete": "Completing…", "fuel/verify": "Verifying…", "driver/deactivate": "Deactivating…", "report/add": "Exporting…",
};

function busyTextOf(type: TransportAction["type"]): string {
  return BUSY_TEXT[type] ?? (type.endsWith("/update") || type === "vehicle/breakdown" ? "Updating…" : "Saving…");
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message && error.message !== "401") return error.message;
  return "Something went wrong. Please try again.";
}

export function TransportProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TransportData>(emptyTransportData);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [saving, setSaving] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<string | null>(null);
  errorRef.current = error;
  // Actions dispatched and not yet finished (they run one at a time, in order).
  const inFlight = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const reload = useCallback(async () => {
    try {
      const data = await loadTransportData();
      setState((prev) => ({ ...data, attendance: prev.attendance }));
      setStatus("ready");
    } catch (e) {
      setError(messageOf(e));
      setStatus((s) => (s === "ready" ? s : "error"));
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const loadRegister = useCallback(async (date: string, shift: AttendanceShift) => {
    try {
      const entries = await fetchRegister(date, shift);
      setState((prev) => ({ ...prev, attendance: { ...prev.attendance, [registerKey(shift, date)]: entries } }));
    } catch (e) {
      setError(messageOf(e));
    }
  }, []);

  const dispatch = useCallback((action: TransportAction) => {
    // Busy from the click itself, so the button disables before the request starts (no double submits).
    inFlight.current += 1;
    setSaving(true);
    setBusyText(busyTextOf(action.type));
    const run = queue.current.then(async () => {
      setBusyText(busyTextOf(action.type));
      try {
        await performAction(action, stateRef.current);
        if (action.type === "attendance/set") await loadRegister(action.date, action.shift);
        return true;
      } catch (e) {
        const message = messageOf(e);
        errorRef.current = message;
        setError(message);
        return false;
      } finally {
        await reload();
        inFlight.current -= 1;
        if (inFlight.current === 0) { setSaving(false); setBusyText(""); }
      }
    });
    queue.current = run.catch(() => undefined);
    return run;
  }, [reload, loadRegister]);

  const errorText = useCallback(() => errorRef.current ?? "", []);
  const value = useMemo<Ctx>(() => ({
    state, dispatch, status, saving, busyText, error, errorText, clearError: () => setError(null), reload, loadRegister,
  }), [state, dispatch, status, saving, busyText, error, errorText, reload, loadRegister]);
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

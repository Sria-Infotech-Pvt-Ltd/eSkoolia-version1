"use client";
/** Vehicle helpers shared by the Vehicles list, drawer and modals (Master Prompt §7.2). */
import { daysLeft, fmtDate } from "@/lib/transport/format";
import { useTransport } from "@/lib/transport/store";
import { Badge, type Tone } from "@/components/transport/ui";
import type { Vehicle, VehicleDoc } from "@/lib/transport/types";

/** Saved Settings → "Vehicle document reminder (days)" (default 30). */
export function useVehicleDocWindow(): number {
  return useTransport().state.settings.reminders.vehicleDocsDays;
}

/** Compliance badge value: green date, amber "Due in Nd" (within the reminder window), red "Expired". */
export function complianceState(iso: string, window = 30): { tone: Tone; text: string } {
  const dl = daysLeft(iso);
  if (dl < 0) return { tone: "red", text: "Expired" };
  if (dl <= window) return { tone: "amber", text: `Due in ${dl}d` };
  return { tone: "green", text: fmtDate(iso) };
}

export function ComplianceBadge({ label, iso }: { label: string; iso: string }) {
  const s = complianceState(iso, useVehicleDocWindow());
  return <Badge tone={s.tone}>{label} · {s.text}</Badge>;
}

/** Drawer variant: date plus a status badge. */
export function ComplianceValue({ iso }: { iso: string }) {
  const window = useVehicleDocWindow();
  const dl = daysLeft(iso);
  const badge = dl < 0 ? <Badge tone="red">Expired</Badge> : dl <= window ? <Badge tone="amber">Due in {dl}d</Badge> : <Badge tone="green">Valid</Badge>;
  return <>{fmtDate(iso)} {badge}</>;
}

/** Earlier of fitness and insurance → "expiring" (0–30 days) / "expired" (<0) / "ok". */
export function complianceBucket(v: Vehicle, window = 30): "ok" | "expiring" | "expired" {
  const dl = Math.min(daysLeft(v.fitness), daysLeft(v.insurance));
  if (dl < 0) return "expired";
  if (dl <= window) return "expiring";
  return "ok";
}

export const DOCS: VehicleDoc[] = ["Fitness certificate", "Insurance", "Road permit", "Pollution (PUC)"];

/** Default document for the upload modal (§7.2). */
export function defaultDoc(v: Vehicle, window = 30): VehicleDoc {
  if (daysLeft(v.insurance) <= window) return "Insurance";
  if (daysLeft(v.fitness) <= window) return "Fitness certificate";
  return "Insurance";
}

export function isActive(v: Vehicle): boolean {
  return v.status === "On route" || v.status === "Active";
}

export function isInService(v: Vehicle): boolean {
  return v.status === "Under maintenance" || v.status === "Breakdown";
}

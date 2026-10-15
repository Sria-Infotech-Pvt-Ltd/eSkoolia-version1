"use client";
/** Vehicle drawer (Master Prompt §7.2 → ProfileDrawer pattern §4.16). */
import { Bus, Car } from "lucide-react";
import { capacityOf, routeLabel } from "@/lib/transport/catalog";
import { clockOf, fmtDate, inr, num } from "@/lib/transport/format";
import type { Driver, TransportRoute, Vehicle } from "@/lib/transport/types";
import {
  Button, Drawer, DrawerActions, DrawerHeader, DrawerHighlight, DrawerSection, InfoRow, StatusBadge,
} from "@/components/transport/ui";
import { ComplianceValue } from "./shared";

export function VehicleDrawer({
  vehicle, routes, drivers, onClose, onEdit, onUpload, onBreakdown,
}: {
  vehicle: Vehicle | null; routes: TransportRoute[]; drivers: Driver[]; onClose: () => void;
  onEdit: () => void; onUpload: () => void; onBreakdown: () => void;
}) {
  if (!vehicle) return null;
  const cap = capacityOf(vehicle);
  const driver = drivers.find((d) => d.id === vehicle.driverId);
  return (
    <Drawer open onClose={onClose} label={`Vehicle ${vehicle.reg}`}>
      <DrawerHeader icon={vehicle.type.startsWith("Van") ? Car : Bus} title={vehicle.reg} titleMono
        sub={`${vehicle.model} · ${vehicle.type}`} idLabel={vehicle.id} badges={<StatusBadge status={vehicle.status} />} />
      <DrawerHighlight items={[
        { label: "Seats occupied", value: `${vehicle.occupied} / ${cap}` },
        { label: "Fuel spend MTD", value: inr(vehicle.fuelMtd) },
      ]} />
      <DrawerSection title="Details">
        <InfoRow label="Capacity">{cap} seats</InfoRow>
        <InfoRow label="Route">{routeLabel(routes, vehicle.routeCode)}</InfoRow>
        <InfoRow label="Driver">{driver?.name ?? "Unassigned"}</InfoRow>
        <InfoRow label="Odometer"><span className="tp-mono">{vehicle.odometer ? `${num(vehicle.odometer)} km` : "Not recorded"}</span></InfoRow>
        <InfoRow label="GPS device">{vehicle.lastPing ? `Last ping ${new Date(vehicle.lastPing).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} · ${clockOf(vehicle.lastPing)}` : "No GPS data received"}</InfoRow>
      </DrawerSection>
      <DrawerSection title="Compliance documents">
        <InfoRow label="Fitness certificate"><ComplianceValue iso={vehicle.fitness} /></InfoRow>
        <InfoRow label="Insurance"><ComplianceValue iso={vehicle.insurance} /></InfoRow>
        <InfoRow label="Road permit">{fmtDate(vehicle.permit)}</InfoRow>
        <InfoRow label="Pollution (PUC)">{fmtDate(vehicle.puc)}</InfoRow>
      </DrawerSection>
      <DrawerActions>
        <Button type="button" variant="soft" size="sm" onClick={onEdit}>Edit vehicle</Button>
        <Button type="button" variant="soft" size="sm" onClick={onUpload}>Renew document</Button>
        <Button type="button" variant="red" size="sm" onClick={onBreakdown}>Mark breakdown</Button>
      </DrawerActions>
    </Drawer>
  );
}

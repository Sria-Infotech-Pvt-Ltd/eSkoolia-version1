"use client";

import { Suspense } from "react";
import { MaintenancePage } from "@/components/transport/maintenance/MaintenancePage";
import { FuelPage } from "@/components/transport/fuel/FuelPage";
import { TransportSections } from "@/components/transport/ui";

/** Maintenance & service, then Fuel Management (the former /transport/fuel). */
export default function TransportMaintenanceRoute() {
  return (
    <Suspense fallback={null}>
      <TransportSections sections={[
        { key: "maintenance", content: <MaintenancePage /> },
        { key: "fuel", content: <FuelPage /> },
      ]} />
    </Suspense>
  );
}

"use client";

import { Suspense } from "react";
import { MaintenancePage } from "@/components/transport/maintenance/MaintenancePage";

export default function TransportMaintenanceRoute() {
  return (
    <Suspense fallback={null}>
      <MaintenancePage />
    </Suspense>
  );
}

"use client";

import { Suspense } from "react";
import { VehiclesPage } from "@/components/transport/vehicles/VehiclesPage";

// The earlier API-backed screen (components/transport/VehiclePanel.tsx) is kept
// in the repo unchanged; this route now renders the Transport module spec page.
export default function TransportVehiclesPage() {
  return (
    <Suspense fallback={null}>
      <VehiclesPage />
    </Suspense>
  );
}

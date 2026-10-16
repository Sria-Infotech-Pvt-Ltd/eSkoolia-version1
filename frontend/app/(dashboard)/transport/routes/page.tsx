"use client";

import { Suspense } from "react";
import { RoutesPage } from "@/components/transport/routes/RoutesPage";
import { PickupPointsPage } from "@/components/transport/pickup/PickupPointsPage";
import { TransportSections } from "@/components/transport/ui";

/** Routes, then Pickup Points (the former /transport/pickup-points). */
export default function TransportRoutesPage() {
  return (
    <Suspense fallback={null}>
      <TransportSections sections={[
        { key: "routes", content: <RoutesPage /> },
        { key: "pickup-points", content: <PickupPointsPage /> },
      ]} />
    </Suspense>
  );
}

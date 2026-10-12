"use client";

import { Suspense } from "react";
import { PickupPointsPage } from "@/components/transport/pickup/PickupPointsPage";

export default function TransportPickupPointsPage() {
  return (
    <Suspense fallback={null}>
      <PickupPointsPage />
    </Suspense>
  );
}

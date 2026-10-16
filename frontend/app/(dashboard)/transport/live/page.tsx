"use client";

import { Suspense } from "react";
import { LiveTrackingPage } from "@/components/transport/live/LiveTrackingPage";

export default function TransportLiveTrackingRoute() {
  return (
    <Suspense fallback={null}>
      <LiveTrackingPage />
    </Suspense>
  );
}

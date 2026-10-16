"use client";

import { Suspense } from "react";
import { AlertsPage } from "@/components/transport/alerts/AlertsPage";

export default function TransportAlertsRoute() {
  return (
    <Suspense fallback={null}>
      <AlertsPage />
    </Suspense>
  );
}

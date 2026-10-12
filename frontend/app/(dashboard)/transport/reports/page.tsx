"use client";

import { Suspense } from "react";
import { ReportsPage } from "@/components/transport/reports/ReportsPage";

export default function TransportReportsRoute() {
  return (
    <Suspense fallback={null}>
      <ReportsPage />
    </Suspense>
  );
}

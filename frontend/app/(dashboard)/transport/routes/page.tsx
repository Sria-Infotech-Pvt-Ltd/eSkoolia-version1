"use client";

import { Suspense } from "react";
import { RoutesPage } from "@/components/transport/routes/RoutesPage";

export default function TransportRoutesPage() {
  return (
    <Suspense fallback={null}>
      <RoutesPage />
    </Suspense>
  );
}

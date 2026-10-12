"use client";

import { Suspense } from "react";
import { AllocationPage } from "@/components/transport/allocation/AllocationPage";

export default function TransportAllocationRoute() {
  return (
    <Suspense fallback={null}>
      <AllocationPage />
    </Suspense>
  );
}

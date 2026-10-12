"use client";

import { Suspense } from "react";
import { StaffDirectory } from "@/components/transport/staff/StaffDirectory";

export default function TransportDriversPage() {
  return (
    <Suspense fallback={null}>
      <StaffDirectory kind="driver" />
    </Suspense>
  );
}

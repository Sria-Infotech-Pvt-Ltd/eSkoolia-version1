"use client";

import { Suspense } from "react";
import { StaffDirectory } from "@/components/transport/staff/StaffDirectory";

export default function TransportAttendantsPage() {
  return (
    <Suspense fallback={null}>
      <StaffDirectory kind="attendant" />
    </Suspense>
  );
}

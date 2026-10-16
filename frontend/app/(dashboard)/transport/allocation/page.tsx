"use client";

import { Suspense } from "react";
import { AllocationPage } from "@/components/transport/allocation/AllocationPage";
import { AttendancePage } from "@/components/transport/attendance/AttendancePage";
import { TransportSections } from "@/components/transport/ui";

/** Student Allocation, then Transport Attendance (the former /transport/attendance). */
export default function TransportAllocationRoute() {
  return (
    <Suspense fallback={null}>
      <TransportSections sections={[
        { key: "allocation", content: <AllocationPage /> },
        { key: "attendance", content: <AttendancePage /> },
      ]} />
    </Suspense>
  );
}

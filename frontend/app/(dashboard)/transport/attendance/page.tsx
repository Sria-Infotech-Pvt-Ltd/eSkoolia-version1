"use client";

import { Suspense } from "react";
import { AttendancePage } from "@/components/transport/attendance/AttendancePage";

export default function TransportAttendanceRoute() {
  return (
    <Suspense fallback={null}>
      <AttendancePage />
    </Suspense>
  );
}

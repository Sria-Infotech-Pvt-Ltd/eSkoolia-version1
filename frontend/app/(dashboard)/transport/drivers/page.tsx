"use client";

import { Suspense } from "react";
import { StaffDirectory } from "@/components/transport/staff/StaffDirectory";
import { TransportSections } from "@/components/transport/ui";

/** Staff: Drivers section, then Attendants (the former /transport/attendants). */
export default function TransportDriversPage() {
  return (
    <Suspense fallback={null}>
      <TransportSections compact sections={[
        { key: "drivers", content: <StaffDirectory kind="driver" /> },
        { key: "attendants", content: <StaffDirectory kind="attendant" /> },
      ]} />
    </Suspense>
  );
}

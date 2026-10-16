"use client";

import { TransportRoutePanel } from "@/components/transport/TransportRoutePanel";

// The earlier API-backed route & stop builder, kept reachable unchanged now that
// /transport/routes renders the Route planner (Transport Phase 2).
export default function TransportStopBuilderPage() {
  return <TransportRoutePanel />;
}

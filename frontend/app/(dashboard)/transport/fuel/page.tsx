"use client";

import { Suspense } from "react";
import { FuelPage } from "@/components/transport/fuel/FuelPage";

export default function TransportFuelRoute() {
  return (
    <Suspense fallback={null}>
      <FuelPage />
    </Suspense>
  );
}

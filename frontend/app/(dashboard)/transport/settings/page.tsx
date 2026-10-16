"use client";

import { Suspense } from "react";
import { SettingsPage } from "@/components/transport/settings/SettingsPage";

export default function TransportSettingsRoute() {
  return (
    <Suspense fallback={null}>
      <SettingsPage />
    </Suspense>
  );
}

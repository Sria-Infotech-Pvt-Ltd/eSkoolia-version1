"use client";
/**
 * Transport module layout. The app shell (top bar, ⌘K palette, notifications,
 * notes, avatar/logout, Transport sub-nav from lib/routes.ts) comes from
 * app/(dashboard)/layout.tsx; this layer only mounts the shared Transport store,
 * the Esc-aware overlay stack and the toast, scoped under .tp.
 */
import "@/components/transport/ui/transport.css";
import { TransportProvider } from "@/lib/transport/store";
import { OverlayProvider, TpToastProvider } from "@/components/transport/ui";

export default function TransportLayout({ children }: { children: React.ReactNode }) {
  return (
    <TransportProvider>
      <OverlayProvider>
        <TpToastProvider>
          <div className="tp" style={{ minHeight: "100%" }}>{children}</div>
        </TpToastProvider>
      </OverlayProvider>
    </TransportProvider>
  );
}

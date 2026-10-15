"use client";
/**
 * Combined Transport page: existing screens stacked as sections under one page
 * frame (Drivers + Attendants, Routes + Pickup Points, Allocation + Attendance,
 * Maintenance + Fuel). Each section keeps its own component, state and actions.
 *
 * `?section=<key>` targets a section: deep links (`?id=` / `?new=1`) go only to
 * that section, and the page scrolls to it once transport data has loaded. The
 * absorbed routes redirect here with it (lib/transport/sections.ts).
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransport } from "@/lib/transport/store";
import { TransportSectionContext } from "./sectionContext";
import { TransportPage } from "./page";
import { T } from "./tokens";

export interface TransportSectionDef {
  key: string;
  content: React.ReactNode;
}

export function TransportSections({ sections, compact }: { sections: TransportSectionDef[]; compact?: boolean }) {
  return (
    <TransportPage compact={compact}>
      {sections.map((s, i) => (
        <TransportSectionContext.Provider key={s.key} value={{ key: s.key, primary: i === 0 }}>
          <Section sectionKey={s.key} first={i === 0}>{s.content}</Section>
        </TransportSectionContext.Provider>
      ))}
    </TransportPage>
  );
}

function Section({ sectionKey, first, children }: { sectionKey: string; first: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { status } = useTransport();
  // Remembered, because useDeepLink may clear the URL before the data has loaded.
  const scrollPending = useRef(false);

  useEffect(() => {
    if (params.get("section") !== sectionKey) return;
    scrollPending.current = true;
    // Drop a bare ?section= (useDeepLink clears the URL itself when ?id= / ?new= is present).
    if (!params.get("id") && params.get("new") !== "1") router.replace(pathname, { scroll: false });
  }, [params, sectionKey, pathname, router]);

  // Scroll once the data is in, so the sections above have their final height.
  useEffect(() => {
    if (!scrollPending.current || status === "loading") return;
    scrollPending.current = false;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block: "start" }));
  }, [status, params]);

  return (
    <section ref={ref} id={sectionKey} style={first ? undefined : {
      marginTop: 20, paddingTop: 16, borderTop: `1px dashed ${T.cardBd}`, scrollMarginTop: 8,
    }}>
      {children}
    </section>
  );
}

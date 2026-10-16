"use client";
/**
 * Record deep links (Master Prompt §8): `?id=<record>` opens its drawer, `?new=1` opens the create flow.
 * On a combined page only one section answers: the one named by `?section=`, else the first section.
 * Handled once the transport data has loaded, so a link opened in a new tab finds its record.
 */
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransport } from "@/lib/transport/store";
import { useTransportSection } from "./sectionContext";

export function useDeepLink(onLink: (link: { id: string | null; isNew: boolean }) => void) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const section = useTransportSection();
  const sectionKey = section?.key ?? null;
  const primary = section?.primary ?? true;
  // On a fresh page load the store is still empty: wait for the first load, or the record isn't found.
  const loading = useTransport().status === "loading";
  const handler = useRef(onLink);
  handler.current = onLink;

  useEffect(() => {
    const id = params.get("id");
    const isNew = params.get("new") === "1";
    if (!id && !isNew) return;
    if (loading) return;
    if (sectionKey) {
      const target = params.get("section");
      if (primary ? target !== null && target !== sectionKey : target !== sectionKey) return;
    }
    handler.current({ id, isNew });
    router.replace(pathname, { scroll: false });
  }, [params, pathname, router, sectionKey, primary, loading]);
}

"use client";

import { useEffect, useState } from "react";
import { listReports } from "@/hooks/useLibraryApi";

const REFRESH_MS = 60_000;

/**
 * Number of lost or damaged reports still pending, for the badge on the Library nav item.
 * Does nothing (returns 0) unless `enabled`, so non-library pages make no request. Background
 * fetch: silent401, and a failure just leaves the badge hidden.
 */
export function useLostDamagedPending(enabled: boolean): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      listReports({ resolution: "pending", page_size: 10 }, { silent401: true })
        .then((page) => !cancelled && setCount(page.count))
        .catch(() => !cancelled && setCount(0));
    };
    load();
    const handle = setInterval(load, REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(handle);
      window.removeEventListener("focus", load);
    };
  }, [enabled]);

  return count;
}

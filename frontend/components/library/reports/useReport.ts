"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { refusalMessage } from "../issue-desk/deskHelpers";

export interface ReportState<T> {
  data: T | null;
  loading: boolean;
  error: string;
  /** HTTP status of the failure, so a panel can say "no current academic year" for 400 and 404. */
  status: number | undefined;
  reload: () => void;
}

/** Loads one report. A newer request wins over an older answer; `key` is what the request depends on. */
export function useReport<T>(enabled: boolean, load: () => Promise<T>, key: string, failure: string): ReportState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<number | undefined>();
  const [tick, setTick] = useState(0);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!enabled) return;
    const ticket = ++latest.current;
    setLoading(true);
    setError("");
    setStatus(undefined);
    loadRef
      .current()
      .then((result) => ticket === latest.current && setData(result))
      .catch((err) => {
        if (ticket !== latest.current) return;
        setData(null);
        setStatus((err as { status?: number }).status);
        setError(refusalMessage(err, failure));
      })
      .finally(() => ticket === latest.current && setLoading(false));
  }, [enabled, key, tick, failure]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, loading, error, status, reload };
}

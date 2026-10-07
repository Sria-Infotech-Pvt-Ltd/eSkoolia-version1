"use client";

import { useEffect, useRef, useState } from "react";

export interface Suggestions<T> {
  items: T[];
  loading: boolean;
  error: string;
}

/**
 * Debounced suggestions for a search box. Each new query aborts the request still in flight and any
 * answer that arrives late is dropped, so slow responses never overwrite newer ones.
 * `fetcher` should pass the signal on to the request and use silent401 (a lookup must not log anyone out).
 */
export function useSuggest<T>(
  query: string,
  fetcher: (q: string, signal: AbortSignal) => Promise<T[]>,
  delayMs = 200,
  minLength = 2,
): Suggestions<T> & { refresh: () => void } {
  const [state, setState] = useState<Suggestions<T>>({ items: [], loading: false, error: "" });
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    const text = query.trim();
    if (text.length < minLength) {
      setState({ items: [], loading: false, error: "" });
      return;
    }
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    const handle = setTimeout(() => {
      fetcherRef
        .current(text, controller.signal)
        .then((items) => {
          if (!controller.signal.aborted) setState({ items, loading: false, error: "" });
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted || (err as { name?: string })?.name === "AbortError") return;
          setState({ items: [], loading: false, error: "Search is unavailable. You can keep typing the code." });
        });
    }, delayMs);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
  }, [query, delayMs, minLength, tick]);

  return { ...state, refresh: () => setTick((n) => n + 1) };
}

/** One shot, no debounce: used when a scanner presses Enter. */
export async function resolveNow<T>(fetcher: (q: string, signal: AbortSignal) => Promise<T[]>, query: string): Promise<T[]> {
  return fetcher(query.trim(), new AbortController().signal);
}

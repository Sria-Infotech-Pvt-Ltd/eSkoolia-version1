"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePersistentPagination } from "@/hooks/usePersistentPagination";
import type { LibraryPage } from "@/types/library";
import { refusalMessage } from "../issue-desk/deskHelpers";

/** One paged, filterable list on the acquisitions page. A stale answer never overwrites a newer one. */
export function useSectionList<T>(
  storageKey: string,
  enabled: boolean,
  fetcher: (page: number, pageSize: number) => Promise<LibraryPage<T>>,
  filterKey: string,
  failure: string,
) {
  const { page, pageSize, setPage, setPageSize } = usePersistentPagination(storageKey, 1, 10);
  const [rows, setRows] = useState<T[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const data = await fetchRef.current(page, pageSize);
      if (ticket !== latest.current) return;
      setRows(data.results);
      setCount(data.count);
    } catch (err) {
      if (ticket !== latest.current) return;
      if ((err as { status?: number }).status === 404 && page > 1) {
        setPage(1);
        return;
      }
      setError(refusalMessage(err, failure));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, filterKey, failure]);

  useEffect(() => {
    if (enabled) void load();
  }, [enabled, load]);

  return { rows, count, loading, error, load, page, pageSize, setPage, setPageSize };
}

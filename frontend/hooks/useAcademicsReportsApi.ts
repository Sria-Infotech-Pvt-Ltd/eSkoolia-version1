/**
 * Academics > Reports API hooks — same apiRequestWithRefresh pattern as useHrApi.ts.
 */
import { useCallback, useEffect, useState } from "react";
import { apiRequestWithRefresh, apiRequestWithRefreshResponse } from "@/lib/api-auth";
import type {
  AcademicsReportsSummary,
  HomeworkEvaluationRow,
  ReportDownload,
  SyllabusProgressRow,
  
} from "@/types/academics";

function useFetch<T>(url: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIt = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequestWithRefresh<{ data: T }>(url, { method: "GET", silent401: true });
      setData(result.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [url, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void fetchIt(); }, [fetchIt]);
  return { data, loading, error, refetch: fetchIt };
}

export function useAcademicsReportsSummary(academicYearId?: number | null) {
  const qs = academicYearId ? `?academic_year_id=${academicYearId}` : "";
  const { data, loading, error, refetch } = useFetch<AcademicsReportsSummary>(`/api/v1/reports/academics/summary/${qs}`, [academicYearId]);
  return { summary: data, loading, error, refetch };
}

export function useSyllabusProgress(academicYearId?: number | null) {
  const qs = academicYearId ? `?academic_year_id=${academicYearId}` : "";
  const { data, loading, error, refetch } = useFetch<SyllabusProgressRow[]>(`/api/v1/reports/academics/syllabus-progress/${qs}`, [academicYearId]);
  return { rows: data ?? [], loading, error, refetch };
}

export function useHomeworkEvaluation(academicYearId?: number | null) {
  const qs = academicYearId ? `?academic_year_id=${academicYearId}` : "";
  const { data, loading, error, refetch } = useFetch<HomeworkEvaluationRow[]>(`/api/v1/reports/academics/homework-evaluation/${qs}`, [academicYearId]);
  return { rows: data ?? [], loading, error, refetch };
}

export function useReportDownloadCatalog() {
  const { data, loading, error, refetch } = useFetch<ReportDownload[]>("/api/v1/reports/academics/downloads/");
  return { catalog: data ?? [], loading, error, refetch };
}

/** Downloads one canned report as a file — auth requires fetching via our wrapper, not a plain <a href>. */
export async function downloadReport(key: string, format: "pdf" | "excel" = "pdf", academicYearId?: number | null): Promise<void> {
  const params = new URLSearchParams({ export: format });
  if (academicYearId) params.set("academic_year_id", String(academicYearId));
  const res = await apiRequestWithRefreshResponse(`/api/v1/reports/academics/downloads/${key}/?${params.toString()}`, { method: "GET" });
  if (!res.ok) throw new Error("Failed to generate report");
  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${key}.${format === "excel" ? "xlsx" : "pdf"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

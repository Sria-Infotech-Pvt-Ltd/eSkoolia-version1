/**
 * Library API client for the admin console. Wraps apiRequestWithRefresh from
 * lib/api-auth.ts and turns the standard error body into a LibraryApiError so
 * forms can show `field_errors` and branch on `error.code`.
 *
 * Portal (teacher / parent) library calls do not belong here; they live in the
 * portal API clients.
 */
import { apiRequestWithRefresh, type RequestOptions } from "@/lib/api-auth";
import type {
  LibraryEnvelope,
  LibraryErrorBody,
  LibrarySettings,
  LibrarySettingsInput,
} from "@/types/library";

export interface LibraryApiErrorInit {
  status?: number;
  code?: string;
  fieldErrors?: Record<string, string[]>;
  /** Extra keys the server put on `error`, e.g. `amount_due` on library_member_suspended. */
  payload?: Record<string, unknown>;
}

export class LibraryApiError extends Error {
  status?: number;
  code?: string;
  fieldErrors?: Record<string, string[]>;
  payload?: Record<string, unknown>;

  constructor(message: string, init: LibraryApiErrorInit = {}) {
    super(message);
    this.name = "LibraryApiError";
    this.status = init.status;
    this.code = init.code;
    this.fieldErrors = init.fieldErrors;
    this.payload = init.payload;
  }
}

function toFieldErrors(raw: unknown): Record<string, string[]> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(raw as Record<string, unknown>)) {
    out[field] = Array.isArray(value) ? value.map(String) : [String(value)];
  }
  return Object.keys(out).length ? out : undefined;
}

// apiRequestWithRefresh throws an Error carrying the parsed response body in
// `details` and the HTTP code in `status`. Rebuild it as a LibraryApiError.
function toLibraryApiError(err: unknown): unknown {
  const thrown = err as { message?: string; status?: number; details?: unknown };
  if (!thrown || typeof thrown !== "object" || thrown.details === undefined) return err;

  const body = (thrown.details ?? {}) as Partial<LibraryErrorBody>;
  const { code, message, ...payload } = body.error ?? {};
  return new LibraryApiError(
    (typeof message === "string" && message) || thrown.message || "Request failed",
    {
      status: thrown.status,
      code: typeof code === "string" ? code : undefined,
      fieldErrors: toFieldErrors(body.field_errors),
      payload: Object.keys(payload).length ? payload : undefined,
    },
  );
}

async function libraryRequest<T>(path: string, options?: RequestOptions): Promise<T> {
  try {
    return await apiRequestWithRefresh<T>(path, options);
  } catch (err) {
    throw toLibraryApiError(err);
  }
}

const BASE = "/api/v1/library";

// ─── Settings ────────────────────────────────────────────────────────────────

export async function getLibrarySettings(options?: { silent401?: boolean }): Promise<LibrarySettings> {
  const res = await libraryRequest<LibraryEnvelope<LibrarySettings>>(`${BASE}/settings/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

export async function updateLibrarySettings(body: LibrarySettingsInput): Promise<LibrarySettings> {
  const res = await libraryRequest<LibraryEnvelope<LibrarySettings>>(`${BASE}/settings/`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return res.data;
}

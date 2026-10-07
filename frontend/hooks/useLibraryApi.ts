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
  AddCopiesInput,
  AddCopiesResult,
  Book,
  BookCategory,
  BookCategoryInput,
  BookCopy,
  BookDetail,
  BookLabels,
  BookInput,
  BookListParams,
  BookLookupRow,
  BulkImportInputRow,
  BulkImportPreview,
  BulkImportResult,
  CopyListParams,
  ChargeListParams,
  LibraryCharge,
  LibraryEnvelope,
  LibraryErrorBody,
  LibraryPage,
  Member,
  MemberCandidate,
  MemberDetail,
  MemberDuesDetail,
  MemberInput,
  MemberListParams,
  MemberType,
  LibrarySettings,
  LibrarySettingsInput,
  SchoolClassOption,
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

// ─── Shared helpers ──────────────────────────────────────────────────────────

function query(params?: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

function json(method: "POST" | "PATCH" | "PUT", body: unknown): RequestOptions {
  return { method, body: JSON.stringify(body) };
}

type ReadOptions = { silent401?: boolean };

// ─── Categories ──────────────────────────────────────────────────────────────

export function listBookCategories(
  params?: { page?: number; page_size?: number; search?: string; is_active?: boolean; ordering?: string },
  options?: ReadOptions,
): Promise<LibraryPage<BookCategory>> {
  return libraryRequest(`${BASE}/categories/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function createBookCategory(body: BookCategoryInput): Promise<BookCategory> {
  const res = await libraryRequest<LibraryEnvelope<BookCategory>>(`${BASE}/categories/`, json("POST", body));
  return res.data;
}

export async function updateBookCategory(id: number, body: BookCategoryInput): Promise<BookCategory> {
  const res = await libraryRequest<LibraryEnvelope<BookCategory>>(`${BASE}/categories/${id}/`, json("PATCH", body));
  return res.data;
}

/** Refused with code `library_has_history` while the category has titles. */
export async function deleteBookCategory(id: number): Promise<void> {
  await libraryRequest<void>(`${BASE}/categories/${id}/`, { method: "DELETE" });
}

// ─── Books (titles) ──────────────────────────────────────────────────────────

export function listBooks(params?: BookListParams, options?: ReadOptions): Promise<LibraryPage<Book>> {
  return libraryRequest(`${BASE}/books/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function getBook(id: number, options?: ReadOptions): Promise<BookDetail> {
  const res = await libraryRequest<LibraryEnvelope<BookDetail>>(`${BASE}/books/${id}/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

/** One accession: creates the title and `copies_count` copies. Returns the title with its copy codes. */
export async function createBook(body: BookInput): Promise<BookDetail> {
  const res = await libraryRequest<LibraryEnvelope<BookDetail>>(`${BASE}/books/`, json("POST", body));
  return res.data;
}

/** Any wizard field except the accession code. Never changes the number of copies; use addCopies or withdrawCopy. */
export async function updateBook(
  id: number,
  body: Partial<Omit<BookInput, "copies_count" | "condition">>,
): Promise<BookDetail> {
  const res = await libraryRequest<LibraryEnvelope<BookDetail>>(`${BASE}/books/${id}/`, json("PATCH", body));
  return res.data;
}

/** Refused with code `library_has_history` when the title has copies or loans. */
export async function deleteBook(id: number): Promise<void> {
  await libraryRequest<void>(`${BASE}/books/${id}/`, { method: "DELETE" });
}

export function addCopies(id: number, body: AddCopiesInput): Promise<AddCopiesResult> {
  return libraryRequest(`${BASE}/books/${id}/add-copies/`, json("POST", body));
}

/** Issue-desk search over title, author, accession code and copy code. At most 10 rows. */
export async function lookupBooks(q: string, limit = 10, options?: ReadOptions): Promise<BookLookupRow[]> {
  const res = await libraryRequest<LibraryPage<BookLookupRow>>(`${BASE}/books/lookup/${query({ q, limit })}`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.results;
}

// ─── Copies ──────────────────────────────────────────────────────────────────

export function listBookCopies(
  bookId: number,
  params?: { page?: number; page_size?: number },
  options?: ReadOptions,
): Promise<LibraryPage<BookCopy>> {
  return libraryRequest(`${BASE}/books/${bookId}/copies/${query(params)}`, {
    method: "GET",
    silent401: options?.silent401,
  });
}

export function listCopies(params?: CopyListParams, options?: ReadOptions): Promise<LibraryPage<BookCopy>> {
  return libraryRequest(`${BASE}/copies/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

/** Scanner lookup by exact copy code (case-insensitive). The code contains a slash and is sent as is. */
export async function getCopyByCode(code: string, options?: ReadOptions): Promise<BookCopy> {
  const res = await libraryRequest<LibraryEnvelope<BookCopy>>(`${BASE}/copies/by-code/${encodeURI(code)}/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

/** Only the condition can be edited. */
export async function updateCopy(id: number, body: Pick<BookCopy, "condition">): Promise<BookCopy> {
  const res = await libraryRequest<LibraryEnvelope<BookCopy>>(`${BASE}/copies/${id}/`, json("PATCH", body));
  return res.data;
}

/** Allowed only while the copy is available; otherwise code `library_invalid_state_transition`. */
export async function withdrawCopy(id: number, reason: string): Promise<BookCopy> {
  const res = await libraryRequest<LibraryEnvelope<BookCopy>>(
    `${BASE}/copies/${id}/withdraw/`,
    json("POST", { reason }),
  );
  return res.data;
}

// ─── Bulk import and labels ──────────────────────────────────────────────────

/** Validates rows on the server and saves nothing. Maximum 500 rows. */
export async function previewBulkImport(rows: BulkImportInputRow[]): Promise<BulkImportPreview> {
  const res = await libraryRequest<LibraryEnvelope<BulkImportPreview>>(
    `${BASE}/books/bulk-import/preview/`,
    json("POST", { rows }),
  );
  return res.data;
}

/**
 * Creates the valid rows in one transaction. Reuse the same `clientBatchId` when retrying:
 * the server applies a batch id once and answers a repeat with the first result.
 */
export async function commitBulkImport(rows: BulkImportInputRow[], clientBatchId: string): Promise<BulkImportResult> {
  const res = await libraryRequest<LibraryEnvelope<BulkImportResult>>(
    `${BASE}/books/bulk-import/commit/`,
    json("POST", { rows, client_batch_id: clientBatchId }),
  );
  return res.data;
}

/** Copy codes and the title line for printing. `copyId` returns a single label. */
export async function getBookLabels(id: number, options?: { copyId?: number; includeWithdrawn?: boolean }): Promise<BookLabels> {
  const res = await libraryRequest<LibraryEnvelope<BookLabels>>(
    `${BASE}/books/${id}/labels/${query({ copy: options?.copyId, all: options?.includeWithdrawn ? "true" : undefined })}`,
    { method: "GET" },
  );
  return res.data;
}

// ─── Members ─────────────────────────────────────────────────────────────────

export function listMembers(params?: MemberListParams, options?: ReadOptions): Promise<LibraryPage<Member>> {
  return libraryRequest(`${BASE}/members/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function getMember(id: number, options?: ReadOptions): Promise<MemberDetail> {
  const res = await libraryRequest<LibraryEnvelope<MemberDetail>>(`${BASE}/members/${id}/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

/** Registers a member and creates the registration charge (paid now, pending, or waived at 0). */
export async function createMember(body: MemberInput): Promise<MemberDetail> {
  const res = await libraryRequest<LibraryEnvelope<MemberDetail>>(`${BASE}/members/`, json("POST", body));
  return res.data;
}

export async function updateMember(
  id: number,
  body: { is_active?: boolean; card_no?: string; member_type?: MemberType },
): Promise<MemberDetail> {
  const res = await libraryRequest<LibraryEnvelope<MemberDetail>>(`${BASE}/members/${id}/`, json("PATCH", body));
  return res.data;
}

/** Refused with code `library_has_history` when the member has loans or charges. */
export async function deleteMember(id: number): Promise<void> {
  await libraryRequest<void>(`${BASE}/members/${id}/`, { method: "DELETE" });
}

export async function getMemberDues(id: number, options?: ReadOptions): Promise<MemberDuesDetail> {
  const res = await libraryRequest<LibraryEnvelope<MemberDuesDetail>>(`${BASE}/members/${id}/dues/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

/** Students or staff who are not members yet. `type` is student, teacher or staff. At most 20 rows. */
export async function listMemberCandidates(
  type: MemberType,
  q = "",
  options?: ReadOptions,
): Promise<MemberCandidate[]> {
  const res = await libraryRequest<LibraryPage<MemberCandidate>>(`${BASE}/members/candidates/${query({ type, q })}`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.results;
}

// ─── Charges ─────────────────────────────────────────────────────────────────

export function listCharges(params?: ChargeListParams, options?: ReadOptions): Promise<LibraryPage<LibraryCharge>> {
  return libraryRequest(`${BASE}/charges/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

/** Pending to paid. A second call is refused with `library_invalid_state_transition`. */
export async function collectCharge(id: number): Promise<LibraryCharge> {
  const res = await libraryRequest<LibraryEnvelope<LibraryCharge>>(`${BASE}/charges/${id}/collect/`, { method: "POST" });
  return res.data;
}

/** Pending to waived. The reason is required and kept on the charge. */
export async function waiveCharge(id: number, reason: string): Promise<LibraryCharge> {
  const res = await libraryRequest<LibraryEnvelope<LibraryCharge>>(`${BASE}/charges/${id}/waive/`, json("POST", { reason }));
  return res.data;
}

// ─── Classes (for the junior-class picker on the settings page) ──────────────

/** The existing classes API used by other modules. Returns every class of the school (up to 200). */
export async function listSchoolClasses(options?: ReadOptions): Promise<SchoolClassOption[]> {
  const data = await apiRequestWithRefresh<SchoolClassOption[] | { results?: SchoolClassOption[] }>(
    "/api/v1/core/classes/?page_size=200",
    { method: "GET", silent401: options?.silent401 },
  );
  const rows = Array.isArray(data) ? data : (data.results ?? []);
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

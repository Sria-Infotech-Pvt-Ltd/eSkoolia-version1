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
  AuditStatus,
  CheckInInput,
  CheckInResult,
  FinishedAudit,
  Footfall,
  MarkLostResult,
  Occupancy,
  PeriodSlot,
  PeriodSlotInput,
  PrepBriefing,
  StockAudit,
  StockAuditItem,
  StockAuditItemParams,
  WeekGrid,
  AcquisitionsSummary,
  BookRequest,
  BookRequestListParams,
  BookRequestReviewInput,
  Donation,
  DonationInput,
  DonationListParams,
  DonationReceipt,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderListParams,
  PurchaseOrderPatch,
  AddCopiesInput,
  AddCopiesResult,
  BulkIssueInput,
  BulkIssueResult,
  ConsoleSummary,
  RemindResult,
  DeskLog,
  DeskLogEntry,
  EligibleMember,
  EligibleMemberParams,
  Hold,
  HoldListParams,
  IssueInput,
  IssueResult,
  Loan,
  LoanDetail,
  LoanListParams,
  LostDamagedRow,
  RenewResult,
  ReportBill,
  ReportInput,
  ReportListParams,
  ReturnInput,
  ReturnResult,
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

type ReadOptions = { silent401?: boolean; signal?: AbortSignal };

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
    signal: options?.signal,
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
export async function collectCharge(id: number, receiptNo?: string): Promise<LibraryCharge> {
  const res = await libraryRequest<LibraryEnvelope<LibraryCharge>>(`${BASE}/charges/${id}/collect/`, {
    method: "POST",
    body: JSON.stringify(receiptNo ? { receipt_no: receiptNo } : {}),
  });
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

// ─── Loans (issue desk) ──────────────────────────────────────────────────────
// There is no create, edit or delete for loans: every change is one of the actions below.

export function listLoans(params?: LoanListParams, options?: ReadOptions): Promise<LibraryPage<Loan>> {
  return libraryRequest(`${BASE}/issues/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function getLoan(id: number, options?: ReadOptions): Promise<LoanDetail> {
  const res = await libraryRequest<LibraryEnvelope<LoanDetail>>(`${BASE}/issues/${id}/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

export function listDueToday(
  params?: Pick<LoanListParams, "page" | "page_size" | "search">,
  options?: ReadOptions,
): Promise<LibraryPage<Loan>> {
  return libraryRequest(`${BASE}/issues/due-today/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export function listOverdue(
  params?: Pick<LoanListParams, "page" | "page_size" | "search">,
  options?: ReadOptions,
): Promise<LibraryPage<Loan>> {
  return libraryRequest(`${BASE}/issues/overdue/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

/** Everything the librarian console shows, in one request. Poll it with silent401. */
export async function getConsoleSummary(options?: ReadOptions): Promise<ConsoleSummary> {
  const res = await libraryRequest<LibraryEnvelope<ConsoleSummary>>(`${BASE}/console/summary/`, {
    method: "GET",
    silent401: options?.silent401,
    signal: options?.signal,
  });
  return res.data;
}

/**
 * Queue overdue reminders: for named loans, or `all_overdue`. At most once per loan per day. A single
 * loan reminded twice is refused with `library_reminder_already_sent`; a batch lists it in `skipped`.
 */
export async function remindLoans(body: { issue_ids?: number[]; all_overdue?: boolean }): Promise<RemindResult> {
  const res = await libraryRequest<LibraryEnvelope<RemindResult>>(`${BASE}/issues/remind/`, json("POST", body));
  return res.data;
}

/** Today's issue, return and renewal events, newest first (at most 100), with a count per type. */
export async function getDeskLog(options?: ReadOptions): Promise<DeskLog> {
  const res = await libraryRequest<LibraryPage<DeskLogEntry> & { counts: DeskLog["counts"] }>(`${BASE}/issues/desk-log/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return { count: res.count, counts: res.counts, results: res.results };
}

/** Return and renew tabs: open loans by copy code (exact match first), title, borrower or card. At most 10 rows. */
export async function lookupOpenLoans(q: string, options?: ReadOptions): Promise<Loan[]> {
  const res = await libraryRequest<LibraryPage<Loan>>(`${BASE}/issues/open/lookup/${query({ q })}`, {
    method: "GET",
    silent401: options?.silent401,
    signal: options?.signal,
  });
  return res.results;
}

/**
 * Issues one copy. Errors carry a code worth showing: library_member_suspended (payload.amount_due),
 * library_limit_reached, library_copy_unavailable, library_reference_only, library_not_eligible_audience.
 */
export async function issueBook(body: IssueInput): Promise<IssueResult> {
  const res = await libraryRequest<LibraryEnvelope<IssueResult>>(`${BASE}/issues/issue/`, json("POST", body));
  return res.data;
}

export async function bulkIssue(body: BulkIssueInput): Promise<BulkIssueResult> {
  const res = await libraryRequest<LibraryEnvelope<BulkIssueResult>>(`${BASE}/issues/bulk-issue/`, json("POST", body));
  return res.data;
}

/** A second call is refused with `library_already_returned`; its payload has the loan's current status. */
export async function returnLoan(id: number, body: ReturnInput = {}): Promise<ReturnResult> {
  const res = await libraryRequest<LibraryEnvelope<ReturnResult>>(`${BASE}/issues/${id}/return/`, json("POST", body));
  return res.data;
}

/** Only the user who returned it, inside the undo window, while the copy is still on the shelf. */
export async function undoReturn(id: number): Promise<Loan> {
  const res = await libraryRequest<LibraryEnvelope<{ loan: Loan }>>(`${BASE}/issues/${id}/undo-return/`, { method: "POST" });
  return res.data.loan;
}

/** Refused when overdue (`library_loan_overdue`), at the cap (`library_renewal_cap`) or on hold (`library_hold_exists`). */
export async function renewLoan(id: number): Promise<RenewResult> {
  const res = await libraryRequest<LibraryEnvelope<RenewResult>>(`${BASE}/issues/${id}/renew/`, { method: "POST" });
  return res.data;
}

/** The issue-desk roster of a class (or member type): each member with `eligible` and a reason code. */
export function listEligibleMembers(params: EligibleMemberParams, options?: ReadOptions): Promise<LibraryPage<EligibleMember>> {
  return libraryRequest(`${BASE}/members/eligible/${query(params)}`, {
    method: "GET",
    silent401: options?.silent401,
    signal: options?.signal,
  });
}

// ─── Holds ───────────────────────────────────────────────────────────────────

export function listHolds(params?: HoldListParams, options?: ReadOptions): Promise<LibraryPage<Hold>> {
  return libraryRequest(`${BASE}/holds/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function placeHold(body: { book: number; member: number }): Promise<Hold> {
  const res = await libraryRequest<LibraryEnvelope<Hold>>(`${BASE}/holds/`, json("POST", body));
  return res.data;
}

export async function cancelHold(id: number): Promise<Hold> {
  const res = await libraryRequest<LibraryEnvelope<Hold>>(`${BASE}/holds/${id}/cancel/`, { method: "POST" });
  return res.data;
}

// ─── Lost and damaged ────────────────────────────────────────────────────────

export function listReports(params?: ReportListParams, options?: ReadOptions): Promise<LibraryPage<LostDamagedRow>> {
  return libraryRequest(`${BASE}/lost-damaged/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

/** Repeating it for a copy that already has an open report returns that report. */
export async function createReport(body: ReportInput): Promise<LostDamagedRow> {
  const res = await libraryRequest<LibraryEnvelope<LostDamagedRow>>(`${BASE}/lost-damaged/`, json("POST", body));
  return res.data;
}

/** Notes only. */
export async function updateReportNotes(id: number, notes: string): Promise<LostDamagedRow> {
  const res = await libraryRequest<LibraryEnvelope<LostDamagedRow>>(`${BASE}/lost-damaged/${id}/`, json("PATCH", { notes }));
  return res.data;
}

export async function markReportFeePaid(id: number, receiptNo?: string): Promise<LostDamagedRow> {
  const res = await libraryRequest<LibraryEnvelope<LostDamagedRow>>(
    `${BASE}/lost-damaged/${id}/mark-fee-paid/`,
    json("POST", receiptNo ? { receipt_no: receiptNo } : {}),
  );
  return res.data;
}

/** Allowed once the replacement fee is paid or waived (the screen calls it "Write off"). */
export async function resolveReport(id: number): Promise<LostDamagedRow> {
  const res = await libraryRequest<LibraryEnvelope<LostDamagedRow>>(`${BASE}/lost-damaged/${id}/resolve/`, { method: "POST" });
  return res.data;
}

export async function getReportBill(id: number, options?: ReadOptions): Promise<ReportBill> {
  const res = await libraryRequest<LibraryEnvelope<ReportBill>>(`${BASE}/lost-damaged/${id}/bill/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

// ─── Acquisitions ────────────────────────────────────────────────────────────

export function listPurchaseOrders(params?: PurchaseOrderListParams, options?: ReadOptions): Promise<LibraryPage<PurchaseOrder>> {
  return libraryRequest(`${BASE}/purchase-orders/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function createPurchaseOrder(body: PurchaseOrderInput): Promise<PurchaseOrder> {
  const res = await libraryRequest<LibraryEnvelope<PurchaseOrder>>(`${BASE}/purchase-orders/`, json("POST", body));
  return res.data;
}

/** Status only moves forward (ordered to received or cancelled) and payment only pending to paid. */
export async function updatePurchaseOrder(id: number, body: PurchaseOrderPatch): Promise<PurchaseOrder> {
  const res = await libraryRequest<LibraryEnvelope<PurchaseOrder>>(`${BASE}/purchase-orders/${id}/`, json("PATCH", body));
  return res.data;
}

export async function deletePurchaseOrder(id: number): Promise<void> {
  await libraryRequest(`${BASE}/purchase-orders/${id}/`, { method: "DELETE" });
}

export function listDonations(params?: DonationListParams, options?: ReadOptions): Promise<LibraryPage<Donation>> {
  return libraryRequest(`${BASE}/donations/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function createDonation(body: DonationInput): Promise<Donation> {
  const res = await libraryRequest<LibraryEnvelope<Donation>>(`${BASE}/donations/`, json("POST", body));
  return res.data;
}

export async function updateDonation(id: number, body: Partial<DonationInput> & { acknowledgement_sent?: boolean }): Promise<Donation> {
  const res = await libraryRequest<LibraryEnvelope<Donation>>(`${BASE}/donations/${id}/`, json("PATCH", body));
  return res.data;
}

export async function getDonationReceipt(id: number, options?: ReadOptions): Promise<DonationReceipt> {
  const res = await libraryRequest<LibraryEnvelope<DonationReceipt>>(`${BASE}/donations/${id}/receipt/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

/** Defaults to the current academic year. 404 when the school has none (or the id is not its own). */
export async function getAcquisitionsSummary(academicYear?: number, options?: ReadOptions): Promise<AcquisitionsSummary> {
  const res = await libraryRequest<LibraryEnvelope<AcquisitionsSummary>>(
    `${BASE}/acquisitions/summary/${query({ academic_year: academicYear })}`,
    { method: "GET", silent401: options?.silent401 },
  );
  return res.data;
}

export async function setBudget(academicYear: number, amount: string): Promise<{ academic_year: number; amount: string }> {
  const res = await libraryRequest<LibraryEnvelope<{ academic_year: number; amount: string }>>(
    `${BASE}/budgets/`,
    json("PUT", { academic_year: academicYear, amount }),
  );
  return res.data;
}

export function listBookRequests(params?: BookRequestListParams, options?: ReadOptions): Promise<LibraryPage<BookRequest>> {
  return libraryRequest(`${BASE}/book-requests/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function reviewBookRequest(id: number, body: BookRequestReviewInput): Promise<BookRequest> {
  const res = await libraryRequest<LibraryEnvelope<BookRequest>>(`${BASE}/book-requests/${id}/review/`, json("POST", body));
  return res.data;
}

// ─── Periods, visits and stock check ─────────────────────────────────────────

export function listPeriodSlots(params?: { page?: number; page_size?: number }, options?: ReadOptions): Promise<LibraryPage<PeriodSlot>> {
  return libraryRequest(`${BASE}/period-slots/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function createPeriodSlot(body: PeriodSlotInput): Promise<PeriodSlot> {
  const res = await libraryRequest<LibraryEnvelope<PeriodSlot>>(`${BASE}/period-slots/`, json("POST", body));
  return res.data;
}

export async function updatePeriodSlot(id: number, body: Partial<PeriodSlotInput>): Promise<PeriodSlot> {
  const res = await libraryRequest<LibraryEnvelope<PeriodSlot>>(`${BASE}/period-slots/${id}/`, json("PATCH", body));
  return res.data;
}

/** 409 library_has_history when the period has check-ins: switch it off instead. */
export async function deletePeriodSlot(id: number): Promise<void> {
  await libraryRequest(`${BASE}/period-slots/${id}/`, { method: "DELETE" });
}

export async function getWeekGrid(options?: ReadOptions): Promise<WeekGrid> {
  const res = await libraryRequest<LibraryEnvelope<WeekGrid>>(`${BASE}/period-slots/week/`, { method: "GET", silent401: options?.silent401 });
  return res.data;
}

/** The next upcoming slot's briefing, or an empty object when no slot is set up. */
export async function getPrepBriefing(options?: ReadOptions): Promise<PrepBriefing | Record<string, never>> {
  const res = await libraryRequest<LibraryEnvelope<PrepBriefing | Record<string, never>>>(`${BASE}/period-slots/prep-briefing/`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

export async function getOccupancy(periodSlot?: number, options?: ReadOptions): Promise<Occupancy> {
  const res = await libraryRequest<LibraryEnvelope<Occupancy>>(`${BASE}/visits/occupancy/${query({ period_slot: periodSlot })}`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

export async function getFootfall(range?: { from?: string; to?: string }, options?: ReadOptions): Promise<Footfall> {
  const res = await libraryRequest<LibraryEnvelope<Footfall>>(`${BASE}/visits/footfall/${query(range)}`, {
    method: "GET",
    silent401: options?.silent401,
  });
  return res.data;
}

/** Repeating it for the same slot, member and day returns the first visit with `created: false`. */
export async function checkIn(body: CheckInInput): Promise<CheckInResult> {
  const res = await libraryRequest<LibraryEnvelope<CheckInResult>>(`${BASE}/visits/check-in/`, json("POST", body));
  return res.data;
}

/** Sections of one class from the existing core API. */
export async function listClassSections(classId: number, options?: ReadOptions): Promise<{ id: number; name: string }[]> {
  const data = await apiRequestWithRefresh<
    { id: number; name: string; school_class?: number }[] | { results?: { id: number; name: string; school_class?: number }[] }
  >(`/api/v1/core/sections/?school_class=${classId}&page_size=100`, { method: "GET", silent401: options?.silent401 });
  const rows = Array.isArray(data) ? data : (data.results ?? []);
  return rows.filter((row) => row.school_class === undefined || row.school_class === classId).map((row) => ({ id: row.id, name: row.name }));
}

export function listStockAudits(params?: { page?: number; page_size?: number; status?: AuditStatus }, options?: ReadOptions): Promise<LibraryPage<StockAudit>> {
  return libraryRequest(`${BASE}/stock-audits/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function getStockAudit(id: number, options?: ReadOptions): Promise<StockAudit> {
  const res = await libraryRequest<LibraryEnvelope<StockAudit>>(`${BASE}/stock-audits/${id}/`, { method: "GET", silent401: options?.silent401 });
  return res.data;
}

/** Blank rack means every rack. 409 library_audit_in_progress when that scope already has an open check. */
export async function startStockAudit(rack: string): Promise<StockAudit> {
  const res = await libraryRequest<LibraryEnvelope<StockAudit>>(`${BASE}/stock-audits/`, json("POST", { rack }));
  return res.data;
}

export function listStockAuditItems(id: number, params?: StockAuditItemParams, options?: ReadOptions): Promise<LibraryPage<StockAuditItem>> {
  return libraryRequest(`${BASE}/stock-audits/${id}/items/${query(params)}`, { method: "GET", silent401: options?.silent401 });
}

export async function markAuditItem(auditId: number, itemId: number, found: boolean): Promise<{ item: StockAuditItem; progress: { found: number; total: number } }> {
  const res = await libraryRequest<LibraryEnvelope<{ item: StockAuditItem; progress: { found: number; total: number } }>>(
    `${BASE}/stock-audits/${auditId}/items/${itemId}/`,
    json("PATCH", { found }),
  );
  return res.data;
}

export async function bulkMarkAuditItems(auditId: number, itemIds: number[], found: boolean): Promise<{ changed: number; progress: { found: number; total: number } }> {
  const res = await libraryRequest<LibraryEnvelope<{ changed: number; progress: { found: number; total: number } }>>(
    `${BASE}/stock-audits/${auditId}/items/bulk-mark/`,
    json("POST", { item_ids: itemIds, found }),
  );
  return res.data;
}

export async function finishStockAudit(id: number): Promise<FinishedAudit> {
  const res = await libraryRequest<LibraryEnvelope<FinishedAudit>>(`${BASE}/stock-audits/${id}/finish/`, { method: "POST" });
  return res.data;
}

export async function cancelStockAudit(id: number): Promise<StockAudit> {
  const res = await libraryRequest<LibraryEnvelope<StockAudit>>(`${BASE}/stock-audits/${id}/cancel/`, { method: "POST" });
  return res.data;
}

/** Only for a missing copy of a finished check that is still on the shelf. Repeating it returns the same report. */
export async function markAuditItemLost(auditId: number, itemId: number, notes?: string): Promise<MarkLostResult> {
  const res = await libraryRequest<LibraryEnvelope<MarkLostResult>>(
    `${BASE}/stock-audits/${auditId}/items/${itemId}/mark-lost/`,
    json("POST", { notes: notes ?? "" }),
  );
  return res.data;
}

/** Racks that have copies on the shelf, for the stock-check picker. `no_rack` counts shelf copies with no rack set. */
export async function listStockRacks(options?: ReadOptions): Promise<{ racks: { rack: string; copies: number }[]; no_rack: number }> {
  const res = await libraryRequest<LibraryEnvelope<{ racks: { rack: string; copies: number }[]; no_rack: number }>>(
    `${BASE}/stock-audits/racks/`,
    { method: "GET", silent401: options?.silent401 },
  );
  return res.data;
}

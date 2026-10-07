/**
 * Library module types. One interface per API object under /api/v1/library/.
 * Money crosses the API as a string with two decimals; never do arithmetic on it
 * client-side for anything the server also computes.
 */

/** Success envelope for a single object (blueprint 2.3). */
export interface LibraryEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/** Success envelope for a list. `results` and `data` carry the same rows. */
export interface LibraryPage<T> {
  success: boolean;
  message: string;
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
  data: T[];
}

/** Shape of an error body: `error.code` is a stable machine code, e.g. `library_limit_reached`. */
export interface LibraryErrorBody {
  success: false;
  error?: { code?: string; message?: string; [extra: string]: unknown };
  field_errors?: Record<string, unknown>;
}

/** Audit columns present on every library object. */
export interface LibraryAudit {
  created_by: number | null;
  updated_by: number | null;
  created_by_name: string | null;
  updated_by_name: string | null;
}

/** GET and PUT /api/v1/library/settings/ (one row per school, created on first read). */
export interface LibrarySettings extends LibraryAudit {
  id: number;
  school: number;
  fine_per_day: string;
  fine_grace_days: number;
  /** null means no cap. */
  fine_cap: string | null;
  cap_fine_at_replacement_cost: boolean;
  limit_student: number;
  limit_teacher: number;
  limit_staff: number;
  student_min_due_days: number;
  flat_loan_days: number;
  max_renewals: number;
  replacement_processing_fee: string;
  replacement_default_cost: string;
  registration_fee_junior: string;
  registration_fee_senior: string;
  /** Class ids that pay the junior registration fee. */
  junior_class_ids: number[];
  notify_sms_email_enabled: boolean;
  low_stock_ratio: string;
  unscanned_flag_minutes: number;
  undo_return_minutes: number;
  /** Counters: read-only, the server increments them. */
  readonly po_sequence: number;
  readonly donation_receipt_sequence: number;
  created_at: string;
  updated_at: string;
}

/** What PUT accepts: any subset of the editable fields. */
export type LibrarySettingsInput = Partial<
  Omit<
    LibrarySettings,
    | "id"
    | "school"
    | "po_sequence"
    | "donation_receipt_sequence"
    | "created_at"
    | "updated_at"
    | keyof LibraryAudit
  >
>;

// ─── Catalogue ───────────────────────────────────────────────────────────────

export type AgeBand = "early_years" | "primary" | "middle" | "senior" | "staff_adult";
export type BookFormat = "fiction" | "non_fiction" | "textbook" | "reference" | "periodical";
export type BookSource = "purchased" | "donated";
export type CopyStatus = "available" | "issued" | "lost" | "damaged" | "withdrawn";
export type CopyCondition = "new" | "good" | "fair" | "worn" | "damaged";
/** Derived by the server: all issued at 0 available, low at or under the school's low-stock ratio. */
export type AvailabilityStatus = "available" | "low" | "issued";

/** /categories/ row. `code` is the accession prefix; `color_key` is a design-token key, never a hex value. */
export interface BookCategory extends LibraryAudit {
  id: number;
  school: number;
  name: string;
  code: string;
  color_key: string;
  description: string;
  is_active: boolean;
  title_count: number;
  created_at: string;
  updated_at: string;
}

/** Omit `code` to have the server derive a unique one. `code` can change only while the category has no titles. */
export type BookCategoryInput = Partial<Pick<BookCategory, "name" | "code" | "color_key" | "description" | "is_active">>;

export interface BookCategoryBrief {
  id: number;
  name: string;
  code: string;
  color_key: string;
}

export interface CopyBrief {
  id: number;
  code: string;
  status: CopyStatus;
  condition: CopyCondition;
}

/** /books/ row. Counts are derived from copies; `copies_total` excludes withdrawn copies. */
export interface Book {
  id: number;
  accession_code: string;
  call_number: string;
  title: string;
  edition: string;
  part_label: string;
  author: string;
  category: BookCategoryBrief | null;
  isbn: string;
  publisher: string;
  publication_year: number | null;
  language: string;
  age_band: AgeBand;
  for_students: boolean;
  for_teachers: boolean;
  for_staff: boolean;
  format: BookFormat;
  is_reference_only: boolean;
  source: BookSource;
  cost_per_copy: string;
  rack: string;
  copies_total: number;
  copies_available: number;
  copies_issued: number;
  copies_lost: number;
  copies_damaged: number;
  copies_withdrawn: number;
  holds_waiting: number;
  availability_status: AvailabilityStatus;
  /** Deprecated aliases of copies_total and copies_available, kept for the legacy Books page. */
  quantity: number;
  available_quantity: number;
  created_at: string;
}

/** /books/{id}/ also carries copies and the fields not shown in list rows. */
export interface BookDetail extends Book, LibraryAudit {
  school: number;
  vendor_name: string;
  donor_name: string;
  remarks: string;
  copies: CopyBrief[];
  updated_at: string;
}

/** Row from /books/lookup/ (issue-desk search). `matched_copy` is set when `q` was an exact copy code. */
export interface BookLookupRow extends Book {
  matched_copy: CopyBrief | null;
}

/** Accession wizard payload. `copies_count` is required on create and ignored on update. */
export interface BookInput {
  title: string;
  author?: string;
  isbn?: string;
  publisher?: string;
  publication_year?: number | null;
  language?: string;
  category: number;
  age_band?: AgeBand;
  for_students?: boolean;
  for_teachers?: boolean;
  for_staff?: boolean;
  format?: BookFormat;
  is_reference_only?: boolean;
  cost_per_copy?: string;
  edition?: string;
  part_label?: string;
  source?: BookSource;
  vendor_name?: string;
  donor_name?: string;
  rack?: string;
  remarks?: string;
  call_number?: string;
  copies_count?: number;
  /** Condition of the copies created by the accession. Default "new". */
  condition?: CopyCondition;
}

export interface BookListParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  category?: number;
  age_band?: AgeBand;
  format?: BookFormat;
  rack?: string;
  for_students?: boolean;
  for_teachers?: boolean;
  for_staff?: boolean;
  is_reference_only?: boolean;
  condition?: CopyCondition;
  availability?: AvailabilityStatus;
}

/** /copies/ row. Only `condition` is editable; status moves through actions. */
export interface BookCopy extends LibraryAudit {
  id: number;
  school: number;
  book: number;
  book_title: string;
  book_accession_code: string;
  code: string;
  status: CopyStatus;
  condition: CopyCondition;
  last_verified_on: string | null;
  withdrawn_reason: string;
  created_at: string;
  updated_at: string;
}

export interface CopyListParams {
  page?: number;
  page_size?: number;
  search?: string;
  book?: number;
  status?: CopyStatus;
  condition?: CopyCondition;
}

export interface AddCopiesInput {
  count: number;
  condition?: CopyCondition;
}

/** Response of add-copies: the updated title plus the new copy codes. */
export interface AddCopiesResult extends LibraryEnvelope<BookDetail> {
  added: string[];
}

// ─── Bulk import and labels ──────────────────────────────────────────────────

/** One line the librarian typed or pasted. Everything is optional text; the server validates. */
export interface BulkImportInputRow {
  title?: string;
  author?: string;
  category?: string;
  copies?: string | number | null;
  cost?: string | number | null;
}

/** A row after server validation. `error` is null when `valid`. */
export interface BulkImportRow {
  row: number;
  title: string;
  author: string;
  category: string;
  category_id: number | null;
  copies: number;
  cost: string;
  valid: boolean;
  error: string | null;
}

export interface BulkImportPreview {
  rows: BulkImportRow[];
  valid_count: number;
  invalid_count: number;
}

export interface BulkImportResult {
  created: { id: number; accession_code: string; copies: number }[];
  skipped: { row: number; error: string }[];
  titles: Book[];
  /** True when this client_batch_id was already applied: nothing new was created. */
  replayed: boolean;
}

/** GET /books/{id}/labels/ */
export interface BookLabels {
  book_id: number;
  title_line: string;
  accession_code: string;
  call_number: string;
  rack: string;
  copies: CopyBrief[];
}

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

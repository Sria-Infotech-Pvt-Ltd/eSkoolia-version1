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
  created_at: string;
}

/** /books/{id}/ also carries copies and the fields not shown in list rows. */
export interface BookDetail extends Book, LibraryAudit {
  school: number;
  purchase_order: number | null;
  donation: number | null;
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
  purchase_order?: number | null;
  donation?: number | null;
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

// ─── Members and charges ─────────────────────────────────────────────────────

export type MemberType = "student" | "teacher" | "staff";
export type RegistrationStatus = "paid" | "unpaid" | "waived";
export type Standing = "active" | "suspended";

/** /members/ row. Money is a string with two decimals. */
export interface Member {
  id: number;
  display_name: string;
  member_type: MemberType;
  student: number | null;
  staff: number | null;
  school_class: string;
  section: string;
  card_no: string;
  active_loans: number;
  borrowing_limit: number;
  registration_fee_amount: string;
  registration_status: RegistrationStatus;
  total_dues: string;
  standing: Standing;
  is_active: boolean;
  created_at: string;
}

export interface OpenLoan {
  id: number;
  book: number;
  title: string;
  issue_date: string;
  due_date: string;
  days_overdue: number;
  accrued_fine: string;
}

export interface MemberDues {
  overdue_fines: string;
  replacement_fees: string;
  registration_due: string;
  total: string;
  suspended: boolean;
  accrued_open_loan_fines: string;
}

/** /members/{id}/dues/ also lists the charges still pending, so a fee can be collected from the drawer. */
export interface MemberDuesDetail extends MemberDues {
  pending_charges: { id: number; charge_type: ChargeType; amount: string }[];
}

export interface MemberDetail extends Member {
  open_loans: OpenLoan[];
  dues: MemberDues;
  updated_at: string;
}

export interface MemberListParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  member_type?: MemberType;
  is_active?: boolean;
  school_class?: number;
  section?: number;
  standing?: Standing;
  registration?: RegistrationStatus;
}

/** POST /members/. Give `student` or `staff`, not both. Omit the fee to use the school default. */
export interface MemberInput {
  student?: number;
  staff?: number;
  member_type?: MemberType;
  card_no?: string;
  registration_fee_amount?: string;
  collect_fee_now?: boolean;
}

export interface MemberCandidate {
  id: number;
  member_type: MemberType;
  name: string;
  identifier: string;
  school_class: string;
  section: string;
  suggested_fee: string;
}

export type ChargeType = "registration" | "overdue_fine" | "replacement";
export type ChargeStatus = "pending" | "paid" | "waived" | "written_off";

export interface LibraryCharge {
  id: number;
  member: number;
  member_name: string;
  card_no: string;
  charge_type: ChargeType;
  amount: string;
  status: ChargeStatus;
  issue: number | null;
  assessed_on: string;
  resolved_at: string | null;
  resolved_by: number | null;
  resolved_by_name: string | null;
  resolution_note: string;
  receipt_no: string;
  created_at: string;
}

export interface ChargeListParams {
  page?: number;
  page_size?: number;
  search?: string;
  member?: number;
  charge_type?: ChargeType;
  status?: ChargeStatus;
}

/** A class as returned by /api/v1/core/classes/. */
export interface SchoolClassOption {
  id: number;
  name: string;
}

// ─── Circulation ─────────────────────────────────────────────────────────────

/** Derived by the server from the dates and status (never stored): R10. */
export type LoanState = "open" | "due_today" | "overdue" | "returned" | "lost";
export type LoanStatus = "issued" | "returned" | "lost";

/** /issues/ row. Money is a string with two decimals. */
export interface Loan {
  id: number;
  book: number;
  book_title: string;
  copy: number | null;
  copy_code: string;
  member: number;
  member_name: string;
  member_card_no: string;
  member_type: MemberType;
  school_class: string;
  section: string;
  issue_date: string;
  due_date: string;
  return_date: string | null;
  returned_at: string | null;
  days_overdue: number;
  /** Fine accruing on an open overdue loan, computed on read. "0.00" once closed. */
  accrued_fine: string;
  /** Fine assessed at return. */
  fine_amount: string;
  renew_count: number;
  renewed: boolean;
  status: LoanStatus;
  state: LoanState;
}

export interface LoanDetail extends Loan {
  issued_by: number | null;
  issued_by_name: string | null;
  last_renewed_on: string | null;
  charges: { id: number; charge_type: ChargeType; amount: string; status: ChargeStatus; receipt_no: string }[];
  created_at: string;
}

export interface LoanListParams {
  page?: number;
  page_size?: number;
  search?: string;
  ordering?: string;
  state?: LoanState;
  member?: number;
  book?: number;
  copy?: number;
  school_class?: number;
  issued_from?: string;
  issued_to?: string;
}

/** Why the due date is what it is: snapped to the class library period, or the flat period. */
export interface DueNote {
  due_date: string;
  snapped: boolean;
  note: string;
}

/** Give either `copy` or `book` (the first available copy is used). */
export interface IssueInput {
  member: number;
  copy?: number;
  book?: number;
}

export interface IssueResult {
  loan: Loan;
  due: DueNote;
}

export interface BulkIssueInput {
  book: number;
  school_class: number;
  section?: number | null;
  member_ids?: number[];
}

export type BulkSkipReason =
  | "suspended"
  | "limit_reached"
  | "already_holding"
  | "not_eligible_audience"
  | "reference_only"
  | "no_copy_left"
  | "inactive";

export interface BulkIssueResult {
  issued: Loan[];
  skipped: { member: number; reason: BulkSkipReason }[];
}

export type ReportType = "lost" | "damaged";

/**
 * What the librarian decides at the return desk. The server computes the fine and the date: never send them.
 * `fine_action` is required when a fine is due; `waive_reason` is required to waive and needs the waive permission.
 */
export interface ReturnInput {
  fine_action?: "collect" | "waive";
  waive_reason?: string;
  condition?: CopyCondition;
  report?: { type: ReportType; notes?: string };
}

export interface ReturnResult {
  loan: Loan;
  /** The overdue-fine charge (paid or waived), or null when nothing was due. */
  charge: LibraryCharge | null;
  report: LostDamagedRow | null;
  replacement_charge: LibraryCharge | null;
  /** How many members wait for this title. Notifications are sent elsewhere. */
  hold_queue_count: number;
  /** When the undo offer ends (ISO). Null when a lost or damaged report was filed, which cannot be undone. */
  undo_expires_at: string | null;
}

export type DeskEventType = "issue" | "return" | "renewal" | "lost" | "damaged";

/** One line of GET /issues/desk-log/ (Today at the Desk). */
export interface DeskLogEntry {
  id: number;
  event_type: DeskEventType;
  summary: string;
  created_at: string;
  actor_name: string;
  issue: number | null;
}

export interface DeskLog {
  count: number;
  counts: Record<DeskEventType, number>;
  results: DeskLogEntry[];
}

export interface RenewResult {
  loan: Loan;
  due: DueNote;
}

export type HoldStatus = "waiting" | "fulfilled" | "cancelled";

export interface Hold {
  id: number;
  book: number;
  book_title: string;
  member: number;
  member_name: string;
  card_no: string;
  status: HoldStatus;
  fulfilled_issue: number | null;
  created_at: string;
}

export interface HoldListParams {
  page?: number;
  page_size?: number;
  search?: string;
  book?: number;
  member?: number;
  status?: HoldStatus;
}

/** Fee status is read from the replacement charge: charged is pending, none means nobody was billed. */
export type FeeStatus = "charged" | "paid" | "waived" | "written_off" | "none";
export type ReportResolution = "pending" | "resolved";

export interface LostDamagedRow {
  id: number;
  book: number;
  book_title: string;
  copy: number;
  copy_code: string;
  member: number | null;
  member_name: string;
  card_no: string;
  issue: number | null;
  report_type: ReportType;
  reported_on: string;
  reported_by: number | null;
  reported_by_name: string | null;
  source: "desk_return" | "manual" | "stock_audit";
  notes: string;
  replacement_cost: string;
  resolution: ReportResolution;
  resolved_at: string | null;
  fee_status: FeeStatus;
  charge_id: number | null;
  created_at: string;
}

export interface ReportInput {
  copy: number;
  report_type: ReportType;
  member?: number | null;
  issue?: number | null;
  notes?: string;
}

export interface ReportListParams {
  page?: number;
  page_size?: number;
  search?: string;
  report_type?: ReportType;
  resolution?: ReportResolution;
  member?: number;
}

export interface ReportBill {
  report_id: number;
  report_type: ReportType;
  reported_on: string;
  title: string;
  accession_code: string;
  copy_code: string;
  member_name: string;
  card_no: string;
  replacement_cost: string;
  charge_status: ChargeStatus | "none";
  receipt_no: string;
  notes: string;
}

// ─── Console and reminders ───────────────────────────────────────────────────

export interface ConsoleTiles {
  titles: number;
  /** Money as a string with two decimals. Counts every copy that is not lost or withdrawn. */
  collection_value: string;
  /** Copies on the books: everything except withdrawn. */
  copies_total: number;
  copies_available: number;
  /** copies_available divided by copies_total, 0 to 1. */
  available_share: number;
  active_loans: number;
  overdue: number;
  pending_reports: number;
}

export interface ConsoleMixRow {
  category_id: number | null;
  name: string;
  code: string;
  color_key: string;
  copies: number;
  /** Share of the collection, 0 to 1. */
  share: number;
}

/** Any activity-log line. `event_type` covers every library event, not only the five desk events. */
export interface ActivityEntry {
  id: number;
  event_type: string;
  summary: string;
  created_at: string;
  actor_name: string;
  issue: number | null;
}

/** GET /console/summary/. `period` is an empty object when no library period is running. */
export interface ConsoleSummary {
  generated_at: string;
  tiles: ConsoleTiles;
  due_today: number;
  overdue: number;
  holds_waiting: number;
  /** Overdue and due-today loans, oldest due date first (at most 8). */
  attention: Loan[];
  /** Waiting holds, oldest first (at most 8). */
  holds: Hold[];
  mix: ConsoleMixRow[];
  activity: ActivityEntry[];
  period: LivePeriodCard | Record<string, never>;
}

export type RemindSkipReason = "not_found" | "not_overdue" | "already_sent";

export interface RemindResult {
  queued: number;
  queued_ids: number[];
  skipped: { issue: number; reason: RemindSkipReason }[];
  /** Overdue loans an all_overdue run left out because of the batch cap. Run it again. */
  remaining: number;
}

export type EligibilityReason = "ok" | BulkSkipReason;

/** /members/eligible/ row: the issue-desk roster. */
export interface EligibleMember {
  id: number;
  display_name: string;
  member_type: MemberType;
  school_class: string;
  section: string;
  card_no: string;
  active_loans: number;
  borrowing_limit: number;
  standing: Standing;
  eligible: boolean;
  reason: EligibilityReason;
}

export interface EligibleMemberParams {
  school_class?: number;
  member_type?: MemberType;
  book?: number;
  page?: number;
  page_size?: number;
}

// ─── Acquisitions ────────────────────────────────────────────────────────────

export type PoStatus = "ordered" | "received" | "cancelled";
export type PaymentStatus = "pending" | "paid";

export interface PurchaseOrder {
  id: number;
  po_number: string;
  order_date: string;
  vendor_name: string;
  invoice_number: string;
  books_count: number;
  total_cost: string;
  status: PoStatus;
  payment_status: PaymentStatus;
  academic_year: number | null;
  academic_year_name: string;
  notes: string;
  /** Titles accessioned against this order. */
  linked_books: number;
}

export interface PurchaseOrderInput {
  order_date: string;
  vendor_name: string;
  invoice_number?: string;
  books_count: number;
  total_cost: string;
  notes?: string;
}

export interface PurchaseOrderPatch extends Partial<PurchaseOrderInput> {
  status?: PoStatus;
  payment_status?: PaymentStatus;
}

export interface PurchaseOrderListParams {
  page?: number;
  page_size?: number;
  status?: PoStatus;
  payment_status?: PaymentStatus;
  search?: string;
}

export type DonorType = "parent" | "alumni" | "staff" | "publisher" | "ngo_trust";

export interface Donation {
  id: number;
  donor_name: string;
  donor_type: DonorType;
  /** Present only when the caller holds library.donations.view. */
  contact?: string;
  donation_date: string;
  books_count: number;
  estimated_value: string;
  receipt_no: string;
  acknowledgement_sent: boolean;
  acknowledgement_sent_at: string | null;
  notes: string;
  linked_books: number;
}

export interface DonationReceipt extends Donation {
  school_name: string;
}

export interface DonationInput {
  donor_name: string;
  donor_type: DonorType;
  contact?: string;
  donation_date: string;
  books_count: number;
  estimated_value: string;
  notes?: string;
}

export interface DonationListParams {
  page?: number;
  page_size?: number;
  donor_type?: DonorType;
  search?: string;
}

export interface AcquisitionsSummary {
  academic_year: number;
  academic_year_name: string;
  has_budget: boolean;
  budget: string;
  committed: string;
  paid: string;
  remaining: string;
}

export type BookRequestStatus = "pending" | "approved" | "rejected" | "ordered" | "fulfilled";

export interface BookRequest {
  id: number;
  title: string;
  notes: string;
  status: BookRequestStatus;
  requested_by: number;
  requested_by_name: string;
  class_name: string;
  section_name: string;
  reviewed_by_name: string;
  reviewed_at: string | null;
  review_note: string;
  linked_book: number | null;
  linked_book_title: string;
  created_at: string;
}

export interface BookRequestListParams {
  page?: number;
  page_size?: number;
  status?: BookRequestStatus;
  search?: string;
}

export interface BookRequestReviewInput {
  status: Exclude<BookRequestStatus, "pending">;
  note?: string;
  linked_book?: number | null;
}

// ─── Periods, visits and stock check ─────────────────────────────────────────

export type SlotDay = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat";

export interface PeriodSlot {
  id: number;
  school_class: number;
  class_name: string;
  section: number | null;
  section_name: string;
  day: SlotDay;
  period: number;
  period_name: string;
  start_time: string;
  end_time: string;
  room_label: string;
  supervisor: number | null;
  supervisor_name: string;
  is_active: boolean;
}

export interface PeriodSlotInput {
  school_class: number;
  section: number | null;
  day: SlotDay;
  period: number;
  room_label?: string;
  is_active?: boolean;
}

/** The 409 body for a clashing slot: `error.conflict` is "room", "class" or "twin", `error.slot` names the other slot. */
export interface SlotSummary {
  id: number;
  class_name: string;
  section_name: string;
  day: SlotDay;
  period_name: string;
  start_time: string;
  end_time: string;
  room_label: string;
}

export interface GridPeriod {
  id: number;
  name: string;
  start_time: string;
  end_time: string;
}

export interface GridSlot extends SlotSummary {
  period: number;
  school_class: number;
  section: number | null;
  supervisor_name: string;
  is_active: boolean;
  live: boolean;
}

export interface WeekGrid {
  days: SlotDay[];
  /** Mon to Sat, or null on a Sunday. */
  today: SlotDay | null;
  now: string;
  periods: GridPeriod[];
  slots: GridSlot[];
  live_slot_ids: number[];
}

export interface OccupancyRow extends SlotSummary {
  slot_id: number;
  checked_in: number;
  scheduled: number;
}

export interface Occupancy {
  date: string;
  checked_in: number;
  scheduled: number;
  slots: OccupancyRow[];
}

/** Console live-period card. An empty object when no period is running. */
export type LivePeriodCard = Occupancy & { label: string };

export interface FootfallRow {
  school_class: number;
  class_name: string;
  visits: number;
  members: number;
}

export interface Footfall {
  from: string;
  to: string;
  total: number;
  results: FootfallRow[];
}

export interface BriefingList<T> {
  count: number;
  rows: T[];
}

export interface PrepBriefing {
  slot: SlotSummary;
  date: string;
  /** Minutes until it starts when it is today, else null. */
  starts_in_minutes: number | null;
  due_back: BriefingList<{ issue_id: number; book_title: string; member_name: string; due_date: string; days_overdue: number }>;
  blocked: BriefingList<{ member_id: number; member_name: string; card_no: string }>;
  holds_ready: BriefingList<{ hold_id: number; book_title: string; member_name: string }>;
}

export type CheckInMethod = "card_tap" | "manual" | "camera";

export interface CheckInInput {
  card_no?: string;
  member?: number;
  period_slot?: number | null;
  method?: CheckInMethod;
}

export interface CheckInResult {
  created: boolean;
  visit: { id: number; member: number; member_name: string; card_no: string; period_slot: number; checked_in_at: string; method: CheckInMethod };
  slot: OccupancyRow;
  checked_in: number;
  scheduled: number;
}

export type AuditStatus = "in_progress" | "completed" | "cancelled";

export interface StockAudit {
  id: number;
  scope_rack: string;
  status: AuditStatus;
  started_at: string;
  finished_at: string | null;
  total_in_scope: number;
  accounted_count: number;
  missing_count: number;
  value_at_risk: string;
  progress: { found: number; total: number };
}

export interface StockAuditItem {
  id: number;
  copy: number;
  copy_code: string;
  copy_status: CopyStatus;
  book: number;
  book_title: string;
  rack: string;
  cost_per_copy: string;
  found: boolean;
  verified_at: string | null;
}

export interface StockAuditItemParams {
  page?: number;
  page_size?: number;
  found?: boolean;
  book?: number;
}

export interface FinishedAudit extends StockAudit {
  missing: StockAuditItem[];
}

export interface MarkLostResult {
  created: boolean;
  report: LostDamagedRow;
  item: StockAuditItem;
}

// ─── Transactions, export and reports ────────────────────────────────────────

/** Every value the activity feed can carry. */
export type ActivityEventType =
  | "accession" | "issue" | "return" | "renewal" | "lost" | "damaged" | "fine" | "donation" | "purchase"
  | "member" | "hold" | "request" | "reminder" | "audit" | "settings" | "export";

export interface ActivityLogRow {
  id: number;
  event_type: ActivityEventType;
  summary: string;
  created_at: string;
  actor: number | null;
  actor_name: string;
  member: number | null;
  book: number | null;
  issue: number | null;
}

export interface ActivityLogParams {
  page?: number;
  page_size?: number;
  /** One type or several joined with commas. */
  event_type?: string;
  from?: string;
  to?: string;
  actor?: number;
  member?: number;
  book?: number;
  search?: string;
}

export interface ReportRange {
  from: string;
  to: string;
  academic_year: number | null;
  academic_year_name: string;
}

export interface ReportRangeParams {
  academic_year?: number;
  from?: string;
  to?: string;
}

export interface CategoryCirculationRow {
  category: number | null;
  category_name: string;
  color_key: string;
  issues: number;
  share: number;
}

export interface CirculationByCategory extends ReportRange {
  total: number;
  results: CategoryCirculationRow[];
}

export interface MonthlyTrendRow {
  /** "2026-07" */
  month: string;
  issues: number;
  returns: number;
}

export interface MonthlyTrend extends ReportRange {
  total_issues: number;
  total_returns: number;
  results: MonthlyTrendRow[];
}

/** Money is an exact string such as "1500.50". */
export interface FeeColumns {
  count: number;
  charged: string;
  collected: string;
  waived: string;
  written_off: string;
  outstanding: string;
}

export interface FeeTypeRow extends FeeColumns {
  charge_type: "registration" | "overdue_fine" | "replacement";
}

export interface FinesAndFees extends ReportRange {
  results: FeeTypeRow[];
  totals: FeeColumns;
}

export interface BudgetVsSpend {
  academic_year: number;
  academic_year_name: string;
  from: string;
  to: string;
  has_budget: boolean;
  budget: string;
  committed: string;
  paid: string;
  remaining: string;
  by_status: { status: PoStatus; orders: number; total: string }[];
}

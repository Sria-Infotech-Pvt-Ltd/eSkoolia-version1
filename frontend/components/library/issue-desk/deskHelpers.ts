import { LibraryApiError } from "@/hooks/useLibraryApi";
import type { DueNote, EligibilityReason, Loan, ReturnInput, ReportType } from "@/types/library";

/** "2026-03-24" as "24 Mar 2026". Anything unparseable is returned as it came. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "14:05" from an ISO timestamp, in the browser's time zone. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** The confirmation line under a new loan: the computed due date and why it is that date. */
export function dueNoteText(due: DueNote): string {
  const base = `Due ${formatDate(due.due_date)}.`;
  return due.note ? `${base} ${due.note}` : base;
}

export interface BlockContext {
  amountDue?: string | null;
  limit?: number | null;
  activeLoans?: number | null;
}

/** Why a member cannot be issued a book, from the roster's reason code. "ok" has no text. */
export function blockReasonText(reason: EligibilityReason, context: BlockContext = {}): string {
  switch (reason) {
    case "ok":
      return "";
    case "suspended":
      return context.amountDue
        ? `Suspended: ${context.amountDue} owed in fines or replacement fees.`
        : "Suspended: fines or replacement fees are unpaid.";
    case "limit_reached":
      return context.limit != null
        ? `At the borrowing limit (${context.activeLoans ?? context.limit} of ${context.limit} books out).`
        : "At the borrowing limit.";
    case "already_holding":
      return "Already has this title out.";
    case "not_eligible_audience":
      return "This title is not open to this type of member.";
    case "reference_only":
      return "Reference only: cannot be borrowed.";
    case "no_copy_left":
      return "No copy was left to issue.";
    case "inactive":
      return "This membership is inactive.";
    default:
      return "Not eligible.";
  }
}

type PayloadBuilder = (payload: Record<string, unknown>, fallback: string) => string;

const REFUSALS: Record<string, PayloadBuilder> = {
  library_member_suspended: (p) => blockReasonText("suspended", { amountDue: p.amount_due as string | undefined }),
  library_limit_reached: (p) =>
    blockReasonText("limit_reached", { limit: p.limit as number | undefined, activeLoans: p.active_loans as number | undefined }),
  library_copy_unavailable: () => "That copy was just issued elsewhere or is not on the shelf. Pick another copy.",
  library_reference_only: () => blockReasonText("reference_only"),
  library_not_eligible_audience: () => blockReasonText("not_eligible_audience"),
  library_renewal_cap: (p) => (p.max_renewals != null ? `Renewal limit reached (${p.max_renewals} renewals).` : "Renewal limit reached."),
  library_hold_exists: () => "Someone is waiting for this title, so it cannot be renewed.",
  library_loan_overdue: () => "This loan is overdue and cannot be renewed. Return it, settle the fine, then issue it again.",
  library_already_returned: (p) =>
    p.return_date
      ? `This loan was already closed (${String(p.status ?? "returned")} on ${formatDate(String(p.return_date))}).`
      : "This loan was already closed.",
  library_undo_expired: () => "The undo window has passed, or the copy was issued again.",
  library_invalid_state_transition: (_payload, fallback) => fallback,
};

/** The exact reason the server refused an action, in words for the librarian. Falls back to the server message. */
export function refusalMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof LibraryApiError) {
    if (error.status === 503) return "The library is temporarily unavailable. Please try again in a few seconds.";
    const build = error.code ? REFUSALS[error.code] : undefined;
    if (build) return build(error.payload ?? {}, error.message || fallback);
    return error.message || fallback;
  }
  const message = (error as { message?: string } | null)?.message;
  return message && message !== "401" ? message : fallback;
}

/** Seconds left to undo, never below 0. */
export function undoSecondsLeft(expiresAt: string | null | undefined, now: number = Date.now()): number {
  if (!expiresAt) return 0;
  const end = new Date(expiresAt).getTime();
  return Number.isNaN(end) ? 0 : Math.max(0, Math.ceil((end - now) / 1000));
}

/** "9:42" for 582 seconds. */
export function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export function hasFine(loan: Pick<Loan, "accrued_fine">): boolean {
  return Number(loan.accrued_fine) > 0;
}

export type ReturnAction = "return" | "collect" | "waive";

/** Which return buttons to show: a plain return when nothing is due, otherwise collect (and waive for those allowed). */
export function returnActions(loan: Pick<Loan, "accrued_fine">, canWaive: boolean): ReturnAction[] {
  if (!hasFine(loan)) return ["return"];
  return canWaive ? ["collect", "waive"] : ["collect"];
}

export interface ReturnDraft {
  action: ReturnAction;
  waiveReason: string;
  condition: string;
  report: { type: ReportType; notes: string } | null;
}

/** A message when the draft cannot be sent yet (a waive with no reason), else null. */
export function returnDraftError(draft: ReturnDraft): string | null {
  if (draft.action === "waive" && !draft.waiveReason.trim()) return "Give a reason to waive the fine.";
  return null;
}

/** The request body. A lost report carries no fine (the replacement fee covers it), so no fine action is sent with it. */
export function buildReturnInput(draft: ReturnDraft): ReturnInput {
  const body: ReturnInput = {};
  const lost = draft.report?.type === "lost";
  if (!lost && draft.action === "collect") body.fine_action = "collect";
  if (!lost && draft.action === "waive") {
    body.fine_action = "waive";
    body.waive_reason = draft.waiveReason.trim();
  }
  if (draft.condition && !draft.report) body.condition = draft.condition as ReturnInput["condition"];
  if (draft.report) {
    body.report = { type: draft.report.type, ...(draft.report.notes.trim() ? { notes: draft.report.notes.trim() } : {}) };
  }
  return body;
}

const COPY_CODE = /^LIB-[A-Z0-9]+-\d{4}\/C\d+$/i;

/** True for a full copy code such as LIB-FIC-0001/C1, what a scanner types. */
export function looksLikeCopyCode(text: string): boolean {
  return COPY_CODE.test(text.trim());
}

/** Where a renew attempt will fail before the server is asked, or null. The server still decides. */
export function knownRenewBlock(loan: Pick<Loan, "state" | "status">): string | null {
  if (loan.status !== "issued") return "This loan is already closed.";
  if (loan.state === "overdue") return REFUSALS.library_loan_overdue({}, "");
  return null;
}

import type { LibraryCurrent, LibraryCurrentLoan, LibraryHistoryLoan, LibraryNextSlot } from "@/lib/api/parent";

/** "2 of 3 books allowed". A child with no card has no limit yet. */
export function allowanceText(open: number, limit: number | null): string {
  if (limit === null) return "";
  return `${open} of ${limit} book${limit === 1 ? "" : "s"} allowed`;
}

/** True when the child has used every loan the school allows. */
export function atLimit(open: number, limit: number | null): boolean {
  return limit !== null && open >= limit;
}

/** "Overdue by 3 days", "Due today", or "Due 12 Oct". */
export function dueText(loan: Pick<LibraryCurrentLoan, "state" | "days_overdue" | "due_date">): string {
  if (loan.state === "overdue") return `Overdue by ${loan.days_overdue} day${loan.days_overdue === 1 ? "" : "s"}`;
  if (loan.state === "due_today") return "Due today";
  return `Due ${formatShortDate(loan.due_date)}`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Money string for display, two decimals with grouping. Bad input shows 0.00. */
export function formatMoney(value: string | number | null | undefined): string {
  const n = typeof value === "number" ? value : Number(value);
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function hasFine(value: string | number | null | undefined): boolean {
  return Number(value) > 0;
}

/** "Tue 6 Oct, Period 3, 10:00 to 10:40 in Main Library". */
export function nextSlotText(slot: LibraryNextSlot | null): string {
  if (!slot) return "No library period has been set for your child's class yet.";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slot.date);
  const when = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : slot.date;
  return `${when}, ${slot.period_name}, ${slot.start_time} to ${slot.end_time} in ${slot.room_label}`;
}

export const REGISTRATION_TEXT: Record<"unpaid" | "paid" | "waived", { label: string; tone: "warn" | "ok" | "neutral" }> = {
  unpaid: { label: "Registration fee not paid yet", tone: "warn" },
  paid: { label: "Registration fee paid", tone: "ok" },
  waived: { label: "No registration fee", tone: "neutral" },
};

/** The one sentence that explains why borrowing is on hold, or "" when it is not. */
export function suspensionText(current: Pick<LibraryCurrent, "suspended" | "fines" | "replacement_fees">): string {
  if (!current.suspended) return "";
  const parts: string[] = [];
  if (hasFine(current.fines.total)) parts.push(`an overdue fine of ${formatMoney(current.fines.total)}`);
  if (hasFine(current.replacement_fees.total)) parts.push(`a replacement fee of ${formatMoney(current.replacement_fees.total)}`);
  return `Borrowing is on hold until ${parts.join(" and ")} is cleared at the library office.`;
}

/** What a history row says about how the loan ended. */
export function historyOutcome(loan: Pick<LibraryHistoryLoan, "state" | "return_date" | "returned_late">): { text: string; tone: "ok" | "warn" | "danger" } {
  if (loan.state === "lost") return { text: "Lost", tone: "danger" };
  const when = `Returned ${formatShortDate(loan.return_date)}`;
  return loan.returned_late ? { text: `${when}, late`, tone: "warn" } : { text: when, tone: "ok" };
}

/** Page count for a paginated history. At least 1. */
export function pageCount(count: number, size = 20): number {
  return Math.max(1, Math.ceil(count / size));
}

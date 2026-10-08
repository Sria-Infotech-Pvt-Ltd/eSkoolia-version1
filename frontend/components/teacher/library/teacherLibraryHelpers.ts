import type { LibraryClassLoan, LibraryLoanState, LibraryNextSlot, LibraryRequestStatus } from "@/lib/api/teacher";

export const REQUEST_STATUS: Record<LibraryRequestStatus, { label: string; tone: "warn" | "ok" | "danger" | "info" | "neutral" }> = {
  pending: { label: "Waiting for review", tone: "warn" },
  approved: { label: "Approved", tone: "ok" },
  rejected: { label: "Not approved", tone: "danger" },
  ordered: { label: "Ordered", tone: "info" },
  fulfilled: { label: "In the library", tone: "neutral" },
};

/** "Overdue by 3 days", "Due today", or the due date for a loan that is still on time. */
export function loanStatusText(state: LibraryLoanState, daysOverdue: number): string {
  if (state === "overdue") return `Overdue by ${daysOverdue} day${daysOverdue === 1 ? "" : "s"}`;
  if (state === "due_today") return "Due today";
  return "On loan";
}

export const STATE_TONE: Record<LibraryLoanState, "danger" | "warn" | "neutral"> = { overdue: "danger", due_today: "warn", open: "neutral" };

/** What the Send reminder cell shows for a loan. Only an overdue loan can be reminded, once a day. */
export function reminderAction(loan: Pick<LibraryClassLoan, "state" | "reminded_today">, sentNow: boolean): { kind: "button" | "sent" | "none"; text: string } {
  if (loan.state !== "overdue") return { kind: "none", text: "Not overdue yet" };
  if (loan.reminded_today || sentNow) return { kind: "sent", text: "Reminder sent" };
  return { kind: "button", text: "Send reminder" };
}

/** "Tue 6 Oct, Period 3, 10:00 to 10:40 in Main Library". */
export function nextSlotText(slot: LibraryNextSlot | null): string {
  if (!slot) return "No library period is set for this class yet.";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(slot.date);
  const when = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
    : slot.date;
  return `${when}, ${slot.period_name}, ${slot.start_time} to ${slot.end_time} in ${slot.room_label}`;
}

/** Borrowing line: "2 of 5 books". Null limit (not registered) gives an empty string. */
export function limitText(open: number, limit: number | null | undefined): string {
  if (limit === null || limit === undefined) return "";
  return `${open} of ${limit} book${limit === 1 ? "" : "s"}`;
}

/** Availability line for the search box. */
export function availabilityText(available: number, total: number, referenceOnly: boolean): string {
  if (total === 0) return "No copies on the shelf records";
  if (referenceOnly) return "Reference only, read in the library";
  if (available === 0) return `All ${total} cop${total === 1 ? "y is" : "ies are"} out`;
  return `${available} of ${total} available`;
}

/** The title a request would be filed under: trimmed and single-spaced, as the server stores it. */
export function cleanTitle(value: string): string {
  return value.split(/\s+/).filter(Boolean).join(" ");
}

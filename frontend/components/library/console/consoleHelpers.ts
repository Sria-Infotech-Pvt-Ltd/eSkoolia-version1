import type { RemindResult } from "@/types/library";

/** 0.7345 as "73%". Out-of-range input is clamped. */
export function formatShare(share: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(share) ? share : 0));
  return `${Math.round(clamped * 100)}%`;
}

/** The sentence shown after "Remind all overdue" or a single reminder. */
export function remindSummaryText(result: RemindResult): string {
  const parts = [`Queued ${result.queued} reminder${result.queued === 1 ? "" : "s"}.`];
  const already = result.skipped.filter((s) => s.reason === "already_sent").length;
  const other = result.skipped.length - already;
  if (already) parts.push(`${already} already reminded today.`);
  if (other) parts.push(`${other} skipped.`);
  if (result.remaining > 0) parts.push(`${result.remaining} more overdue: run it again to reach them.`);
  if (result.queued === 0 && result.skipped.length === 0 && result.remaining === 0) return "Nothing to remind: no overdue loans need a reminder today.";
  return parts.join(" ");
}

/** Polling should pause while the tab is hidden. Pure so it can be tested without a browser. */
export function shouldPoll(visibility: string | undefined): boolean {
  return visibility === undefined || visibility === "visible";
}

export const POLL_INTERVAL_MS = 30_000;

/** A person-readable age of the last refresh, "just now" under a minute. */
export function updatedText(generatedAt: string | null, now: number = Date.now()): string {
  if (!generatedAt) return "";
  const then = new Date(generatedAt).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "Updated just now";
  return `Updated ${Math.floor(seconds / 60)} min ago`;
}

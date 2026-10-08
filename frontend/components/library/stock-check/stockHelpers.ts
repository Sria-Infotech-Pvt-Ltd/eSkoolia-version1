import type { StockAudit, StockAuditItem } from "@/types/library";

export interface TitleGroup {
  book: number;
  title: string;
  rack: string;
  items: StockAuditItem[];
  found: number;
}

/** Group the copies of an audit by title, keeping the order the server sent (title, then copy code). */
export function groupByTitle(items: StockAuditItem[]): TitleGroup[] {
  const groups = new Map<number, TitleGroup>();
  for (const item of items) {
    const group = groups.get(item.book) ?? { book: item.book, title: item.book_title, rack: item.rack, items: [], found: 0 };
    group.items.push(item);
    if (item.found) group.found += 1;
    groups.set(item.book, group);
  }
  return [...groups.values()];
}

/** Found over total as a whole percentage, 0 to 100. An empty audit is 0. */
export function progressPercent(progress: { found: number; total: number }): number {
  if (!(progress.total > 0)) return 0;
  return Math.min(100, Math.round((progress.found / progress.total) * 100));
}

export function scopeLabel(audit: Pick<StockAudit, "scope_rack">): string {
  return audit.scope_rack ? `Rack ${audit.scope_rack}` : "All racks";
}

/** Why a missing copy cannot be reported lost here, or "" when it can. Only a copy still on the shelf qualifies (R15). */
export function lostBlockReason(item: Pick<StockAuditItem, "copy_status">): string {
  if (item.copy_status === "available") return "";
  if (item.copy_status === "lost") return "Reported lost";
  return `Now ${item.copy_status}`;
}

/** Items of a group that are not yet ticked, for the "Mark all found" button. */
export function unfoundIds(group: Pick<TitleGroup, "items">): number[] {
  return group.items.filter((item) => !item.found).map((item) => item.id);
}

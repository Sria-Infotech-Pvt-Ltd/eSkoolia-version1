import type { ActivityEventType, ActivityLogParams } from "@/types/library";

export const EVENT_LABEL: Record<ActivityEventType, string> = {
  accession: "Accession",
  issue: "Issue",
  return: "Return",
  renewal: "Renewal",
  lost: "Lost",
  damaged: "Damaged",
  fine: "Fine",
  donation: "Donation",
  purchase: "Purchase",
  member: "Member",
  hold: "Hold",
  request: "Teacher request",
  reminder: "Reminder",
  audit: "Stock check",
  settings: "Settings",
  export: "Export",
};

/** The chips in the order of the prototype, then the system events. */
export const EVENT_CHIPS: ActivityEventType[] = [
  "accession", "issue", "return", "renewal", "lost", "damaged", "fine", "donation", "purchase", "member", "hold", "request",
  "reminder", "audit", "settings", "export",
];

type Tone = "ok" | "warn" | "danger" | "info" | "neutral" | "brand";

export const EVENT_TONE: Record<ActivityEventType, Tone> = {
  accession: "brand", issue: "info", return: "ok", renewal: "info", lost: "danger", damaged: "warn", fine: "warn",
  donation: "ok", purchase: "brand", member: "neutral", hold: "info", request: "brand", reminder: "neutral",
  audit: "neutral", settings: "neutral", export: "warn",
};

export function eventLabel(type: string): string {
  return type in EVENT_LABEL ? EVENT_LABEL[type as ActivityEventType] : type;
}

export interface LogFilters {
  types: ActivityEventType[];
  from: string;
  to: string;
  member: number | null;
  search: string;
}

export const EMPTY_FILTERS: LogFilters = { types: [], from: "", to: "", member: null, search: "" };

/** Toggle a chip. Order follows EVENT_CHIPS so the query string is stable. */
export function toggleType(types: ActivityEventType[], type: ActivityEventType): ActivityEventType[] {
  const next = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
  return EVENT_CHIPS.filter((t) => next.includes(t));
}

/** True when both dates are given and the end is before the start. */
export function rangeIsBackwards(from: string, to: string): boolean {
  return Boolean(from && to && to < from);
}

/** Query parameters shared by the list and the export. Empty filters are left out. */
export function toLogParams(filters: LogFilters): Omit<ActivityLogParams, "page" | "page_size"> {
  const params: Omit<ActivityLogParams, "page" | "page_size"> = {};
  if (filters.types.length) params.event_type = filters.types.join(",");
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.member) params.member = filters.member;
  if (filters.search.trim()) params.search = filters.search.trim();
  return params;
}

export function hasFilters(filters: LogFilters): boolean {
  return Object.keys(toLogParams(filters)).length > 0;
}

/** "5 Oct 2026, 10:05" in the browser's time zone. Unparseable input is returned as is. */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${day}, ${time}`;
}

/** The sentence shown after an export. */
export function exportMessage(rows: number): string {
  if (rows === 0) return "Exported: nothing matched, so the file has only the header row.";
  return `Exported ${rows.toLocaleString("en-US")} row${rows === 1 ? "" : "s"}${rows >= 50_000 ? " (the limit is 50,000; narrow the dates to get the rest)" : ""}.`;
}

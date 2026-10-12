/**
 * Transport module formatting helpers (Master Prompt §0 rule 6, §6).
 * The demo "today" lives in one constant so it can later switch to new Date().
 */

/** Demo "today" — 06 Oct 2026, local midnight. */
export const TODAY = new Date(2026, 9, 6);
/** Demo clock at load. */
export const DEMO_CLOCK = "08:42 AM";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse "YYYY-MM-DD" as a local date (avoids UTC off-by-one). */
export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** "YYYY-MM-DD" for a local date. */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

/** TODAY shifted by n days, as "YYYY-MM-DD". */
export function isoFromToday(n: number): string {
  return toISO(new Date(TODAY.getTime() + n * DAY_MS));
}

/** round((date − TODAY) / 1 day) */
export function daysLeft(iso: string): number {
  return Math.round((parseISO(iso).getTime() - TODAY.getTime()) / DAY_MS);
}

/** ₹12,450 · ₹1,84,260 (en-IN grouping). */
export function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

/** en-IN number grouping without the currency sign. */
export function num(n: number): string {
  return Math.round(n).toLocaleString("en-IN");
}

/** 06 Oct 2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** "06:40" → "6:40 AM" */
export function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m, 2)} ${suffix}`;
}

/** Adds minutes to "HH:MM" and returns "HH:MM". */
export function addMinutes(hhmm: string, mins: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${pad(Math.floor(total / 60) % 24, 2)}:${pad(total % 60, 2)}`;
}

/** "N min ago" under 60 minutes, otherwise "N h ago". */
export function ageLabel(mins: number): string {
  return mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
}

/** Two-letter initials from a display name. */
export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z\s]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** "+91 98••• ••421" from a prefix digit pair and the last three digits. */
export function maskPhone(firstTwo: string | number, last3: string | number): string {
  return `+91 ${firstTwo}••• ••${String(last3).padStart(3, "0").slice(-3)}`;
}

/** Last three digits of n, zero-padded. */
export function last3(n: number): string {
  return String(n).padStart(3, "0").slice(-3);
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** "1 vehicle" / "3 vehicles" */
export function plural(n: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : pluralNoun}`;
}

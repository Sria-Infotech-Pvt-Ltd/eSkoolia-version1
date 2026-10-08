import type { GridSlot, SlotDay, SlotSummary, WeekGrid } from "@/types/library";

export const DAY_LABEL: Record<SlotDay, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
};

/** "Grade 4 A", or just "Grade 4" for a class-wide slot. */
export function slotLabel(slot: Pick<SlotSummary, "class_name" | "section_name">): string {
  return [slot.class_name, slot.section_name].filter(Boolean).join(" ");
}

/** Share of the scheduled class that has checked in, 0 to 100. Nobody scheduled gives 0. */
export function occupancyPercent(checkedIn: number, scheduled: number): number {
  if (!(scheduled > 0) || !(checkedIn > 0)) return 0;
  return Math.min(100, Math.round((checkedIn / scheduled) * 100));
}

/** Grid cells keyed "<day>|<period id>". Only active slots are drawn. */
export function cellsByDayPeriod(grid: Pick<WeekGrid, "slots">): Map<string, GridSlot[]> {
  const cells = new Map<string, GridSlot[]>();
  for (const slot of grid.slots) {
    if (!slot.is_active) continue;
    const key = `${slot.day}|${slot.period}`;
    cells.set(key, [...(cells.get(key) ?? []), slot]);
  }
  return cells;
}

/** "Starts in 12 min", "Starting now", or the date when it is not today. */
export function startsInText(minutes: number | null | undefined, dateText: string): string {
  if (minutes === null || minutes === undefined) return `Next period: ${dateText}`;
  if (minutes <= 0) return "Starting now";
  if (minutes === 1) return "Starts in 1 min";
  if (minutes < 60) return `Starts in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `Starts in ${hours} h ${rest} min` : `Starts in ${hours} h`;
}

/** Bar width as a percentage of the busiest class, so the busiest bar is full. Zero everywhere gives 0. */
export function barWidth(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.max(4, Math.round((value / max) * 100));
}

/** The 409 body of a clashing slot, as one sentence the form can show. */
export function conflictText(payload: Record<string, unknown> | undefined, fallback: string): string {
  const slot = payload?.slot as SlotSummary | undefined;
  if (!slot) return fallback;
  const what = payload?.conflict === "room" ? `${slot.room_label} is taken` : `${slotLabel(slot)} already has a library period`;
  return `${what} on ${DAY_LABEL[slot.day] ?? slot.day} during ${slot.period_name} (${slot.start_time} to ${slot.end_time}).`;
}

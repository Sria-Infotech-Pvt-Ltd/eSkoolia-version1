import {
  barWidth,
  cellsByDayPeriod,
  conflictText,
  occupancyPercent,
  slotLabel,
  startsInText,
} from "@/components/library/periods/periodsHelpers";
import { groupByTitle, lostBlockReason, progressPercent, scopeLabel, unfoundIds } from "@/components/library/stock-check/stockHelpers";
import type { GridSlot, StockAuditItem } from "@/types/library";

const slot = (over: Partial<GridSlot>): GridSlot => ({
  id: 1, class_name: "Grade 4", section_name: "A", day: "Mon", period_name: "Period 3", start_time: "10:00", end_time: "10:40",
  room_label: "Main Library", period: 7, school_class: 2, section: 3, supervisor_name: "", is_active: true, live: false, ...over,
});

const item = (over: Partial<StockAuditItem>): StockAuditItem => ({
  id: 1, copy: 1, copy_code: "LIB-FIC-0001/C1", copy_status: "available", book: 10, book_title: "Atlas", rack: "R1",
  cost_per_copy: "100.00", found: false, verified_at: null, ...over,
});

describe("periods helpers", () => {
  it("labels a slot with its section, or just the class", () => {
    expect(slotLabel({ class_name: "Grade 4", section_name: "A" })).toBe("Grade 4 A");
    expect(slotLabel({ class_name: "Grade 4", section_name: "" })).toBe("Grade 4");
  });

  it("computes occupancy as a clamped whole percentage", () => {
    expect(occupancyPercent(15, 30)).toBe(50);
    expect(occupancyPercent(40, 30)).toBe(100);
    expect(occupancyPercent(0, 30)).toBe(0);
    expect(occupancyPercent(5, 0)).toBe(0);
  });

  it("places only active slots in grid cells", () => {
    const cells = cellsByDayPeriod({ slots: [slot({ id: 1 }), slot({ id: 2, room_label: "Annexe" }), slot({ id: 3, is_active: false, period: 8 })] });
    expect(cells.get("Mon|7")?.map((s) => s.id)).toEqual([1, 2]);
    expect(cells.has("Mon|8")).toBe(false);
  });

  it("words the time until the next period", () => {
    expect(startsInText(0, "6 Oct 2026")).toBe("Starting now");
    expect(startsInText(1, "x")).toBe("Starts in 1 min");
    expect(startsInText(25, "x")).toBe("Starts in 25 min");
    expect(startsInText(90, "x")).toBe("Starts in 1 h 30 min");
    expect(startsInText(120, "x")).toBe("Starts in 2 h");
    expect(startsInText(null, "6 Oct 2026")).toBe("Next period: 6 Oct 2026");
  });

  it("scales bars against the busiest class", () => {
    expect(barWidth(10, 10)).toBe(100);
    expect(barWidth(5, 10)).toBe(50);
    expect(barWidth(1, 100)).toBe(4);
    expect(barWidth(0, 10)).toBe(0);
    expect(barWidth(3, 0)).toBe(0);
  });

  it("names the clashing slot in a conflict message", () => {
    expect(conflictText({ conflict: "room", slot: slot({}) }, "fallback")).toBe("Main Library is taken on Monday during Period 3 (10:00 to 10:40).");
    expect(conflictText({ conflict: "class", slot: slot({}) }, "fallback")).toContain("Grade 4 A already has a library period");
    expect(conflictText(undefined, "fallback")).toBe("fallback");
  });
});

describe("stock check helpers", () => {
  it("groups copies by title and counts the found ones", () => {
    const groups = groupByTitle([item({ id: 1 }), item({ id: 2, found: true }), item({ id: 3, book: 11, book_title: "Zoo", rack: "R2" })]);
    expect(groups.map((g) => [g.title, g.items.length, g.found])).toEqual([["Atlas", 2, 1], ["Zoo", 1, 0]]);
    expect(unfoundIds(groups[0])).toEqual([1]);
  });

  it("computes progress and labels the scope", () => {
    expect(progressPercent({ found: 3, total: 4 })).toBe(75);
    expect(progressPercent({ found: 0, total: 0 })).toBe(0);
    expect(scopeLabel({ scope_rack: "R1" })).toBe("Rack R1");
    expect(scopeLabel({ scope_rack: "" })).toBe("All racks");
  });

  it("only offers Mark as lost for a copy still on the shelf", () => {
    expect(lostBlockReason({ copy_status: "available" })).toBe("");
    expect(lostBlockReason({ copy_status: "lost" })).toBe("Reported lost");
    expect(lostBlockReason({ copy_status: "issued" })).toBe("Now issued");
  });
});

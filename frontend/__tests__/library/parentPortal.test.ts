import {
  allowanceText,
  atLimit,
  dueText,
  formatMoney,
  hasFine,
  historyOutcome,
  nextSlotText,
  pageCount,
  REGISTRATION_TEXT,
  suspensionText,
} from "@/components/parent/library/parentLibraryHelpers";
import { PARENT_MODULES } from "@/lib/parent-routes";

describe("parent library helpers", () => {
  it("says how many books are allowed", () => {
    expect(allowanceText(1, 2)).toBe("1 of 2 books allowed");
    expect(allowanceText(0, 1)).toBe("0 of 1 book allowed");
    expect(allowanceText(0, null)).toBe("");
    expect(atLimit(2, 2)).toBe(true);
    expect(atLimit(1, 2)).toBe(false);
    expect(atLimit(5, null)).toBe(false);
  });

  it("words a due date", () => {
    expect(dueText({ state: "overdue", days_overdue: 1, due_date: "2026-10-01" })).toBe("Overdue by 1 day");
    expect(dueText({ state: "overdue", days_overdue: 6, due_date: "2026-10-01" })).toBe("Overdue by 6 days");
    expect(dueText({ state: "due_today", days_overdue: 0, due_date: "2026-10-01" })).toBe("Due today");
    expect(dueText({ state: "open", days_overdue: 0, due_date: "2026-10-12" })).toBe("Due 12 Oct 2026");
  });

  it("formats money and spots a real fine", () => {
    expect(formatMoney("1500.5")).toBe("1,500.50");
    expect(formatMoney(null)).toBe("0.00");
    expect(hasFine("0.00")).toBe(false);
    expect(hasFine("20.00")).toBe(true);
    expect(hasFine(undefined)).toBe(false);
  });

  it("describes the next library period", () => {
    expect(nextSlotText(null)).toContain("No library period has been set");
    const text = nextSlotText({ id: 1, date: "2026-10-06", day: "Tue", period_name: "Period 3", start_time: "10:00", end_time: "10:40", room_label: "Main Library" });
    expect(text).toContain("Period 3, 10:00 to 10:40 in Main Library");
  });

  it("explains why borrowing is on hold", () => {
    expect(suspensionText({ suspended: false, fines: { total: "0.00" }, replacement_fees: { total: "0.00", items: [] } })).toBe("");
    expect(suspensionText({ suspended: true, fines: { total: "40.00" }, replacement_fees: { total: "0.00", items: [] } })).toBe(
      "Borrowing is on hold until an overdue fine of 40.00 is cleared at the library office.",
    );
    expect(suspensionText({ suspended: true, fines: { total: "40.00" }, replacement_fees: { total: "200.00", items: [] } })).toContain("and a replacement fee of 200.00");
  });

  it("labels the registration fee states", () => {
    expect(REGISTRATION_TEXT.unpaid.tone).toBe("warn");
    expect(REGISTRATION_TEXT.paid.tone).toBe("ok");
    expect(REGISTRATION_TEXT.waived.label).toBe("No registration fee");
  });

  it("describes how a closed loan ended", () => {
    expect(historyOutcome({ state: "lost", return_date: null, returned_late: false })).toEqual({ text: "Lost", tone: "danger" });
    expect(historyOutcome({ state: "returned", return_date: "2026-10-05", returned_late: false })).toEqual({ text: "Returned 5 Oct 2026", tone: "ok" });
    expect(historyOutcome({ state: "returned", return_date: "2026-10-05", returned_late: true }).tone).toBe("warn");
  });

  it("counts pages of twenty", () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(20)).toBe(1);
    expect(pageCount(21)).toBe(2);
    expect(pageCount(45)).toBe(3);
  });
});

describe("parent navigation", () => {
  const items = PARENT_MODULES.flatMap((m) => m.sub);

  it("points Library at the real page and adds History", () => {
    const library = items.find((s) => s.label === "Library");
    expect(library?.path).toBe("/parent/library");
    expect(items.find((s) => s.path === "/parent/library/history")).toBeDefined();
  });

  it("no longer has a Library item pointing at the home placeholder", () => {
    expect(items.filter((s) => s.label.startsWith("Library")).every((s) => s.path.startsWith("/parent/library"))).toBe(true);
  });
});

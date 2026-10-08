import {
  availabilityText,
  cleanTitle,
  limitText,
  loanStatusText,
  nextSlotText,
  reminderAction,
  REQUEST_STATUS,
} from "@/components/teacher/library/teacherLibraryHelpers";
import { libraryErrorCode, libraryErrorMessage } from "@/lib/api/teacher";
import { TEACHER_MODULES } from "@/lib/teacher-routes";

describe("teacher library helpers", () => {
  it("words a loan's status", () => {
    expect(loanStatusText("overdue", 1)).toBe("Overdue by 1 day");
    expect(loanStatusText("overdue", 4)).toBe("Overdue by 4 days");
    expect(loanStatusText("due_today", 0)).toBe("Due today");
    expect(loanStatusText("open", 0)).toBe("On loan");
  });

  it("offers a reminder only for an overdue loan, once", () => {
    expect(reminderAction({ state: "open", reminded_today: false }, false)).toEqual({ kind: "none", text: "Not overdue yet" });
    expect(reminderAction({ state: "due_today", reminded_today: false }, false).kind).toBe("none");
    expect(reminderAction({ state: "overdue", reminded_today: false }, false)).toEqual({ kind: "button", text: "Send reminder" });
    expect(reminderAction({ state: "overdue", reminded_today: true }, false)).toEqual({ kind: "sent", text: "Reminder sent" });
    expect(reminderAction({ state: "overdue", reminded_today: false }, true).kind).toBe("sent");
  });

  it("describes the next library period", () => {
    expect(nextSlotText(null)).toBe("No library period is set for this class yet.");
    const text = nextSlotText({ id: 1, date: "2026-10-06", day: "Tue", period_name: "Period 3", start_time: "10:00", end_time: "10:40", room_label: "Main Library" });
    expect(text).toContain("Period 3, 10:00 to 10:40 in Main Library");
    expect(text).toContain("Tue");
  });

  it("describes borrowing and availability", () => {
    expect(limitText(2, 5)).toBe("2 of 5 books");
    expect(limitText(0, 1)).toBe("0 of 1 book");
    expect(limitText(0, null)).toBe("");
    expect(availabilityText(2, 3, false)).toBe("2 of 3 available");
    expect(availabilityText(0, 1, false)).toBe("All 1 copy is out");
    expect(availabilityText(0, 4, false)).toBe("All 4 copies are out");
    expect(availabilityText(1, 1, true)).toBe("Reference only, read in the library");
  });

  it("cleans a title the way the server does", () => {
    expect(cleanTitle("  Atlas   of  the World ")).toBe("Atlas of the World");
    expect(cleanTitle("   ")).toBe("");
  });

  it("labels every request status", () => {
    expect(Object.keys(REQUEST_STATUS).sort()).toEqual(["approved", "fulfilled", "ordered", "pending", "rejected"]);
    expect(REQUEST_STATUS.rejected.label).toBe("Not approved");
  });
});

describe("library error helpers", () => {
  it("reads the server's message and code", () => {
    const err = { status: 409, message: "x", details: { error: { code: "library_renewal_cap", message: "The renewal limit for this loan has been reached." } } };
    expect(libraryErrorMessage(err, "fallback")).toBe("The renewal limit for this loan has been reached.");
    expect(libraryErrorCode(err)).toBe("library_renewal_cap");
  });

  it("prefers a field message and handles the unavailable and empty cases", () => {
    expect(libraryErrorMessage({ details: { field_errors: { title: ["Title is required."] } } }, "fallback")).toBe("Title is required.");
    expect(libraryErrorMessage({ status: 503 }, "fallback")).toContain("temporarily unavailable");
    expect(libraryErrorMessage({ message: "401" }, "fallback")).toBe("fallback");
    expect(libraryErrorMessage(null, "fallback")).toBe("fallback");
    expect(libraryErrorCode(undefined)).toBe("");
  });
});

describe("teacher navigation", () => {
  it("has a Library module with the three sub items and no raw colours", () => {
    const library = TEACHER_MODULES.find((m) => m.id === "teacher-library");
    expect(library).toBeDefined();
    expect(library?.name).toBe("Library");
    expect(library?.sub.map((s) => s.path)).toEqual(["/teacher/library", "/teacher/library/my-books", "/teacher/library/recommend"]);
    expect(library?.sub.map((s) => s.label)).toEqual(["My Class", "My Books", "Recommend"]);
    expect(library?.bg.startsWith("var(")).toBe(true);
    expect(library?.ic.startsWith("var(")).toBe(true);
  });
});

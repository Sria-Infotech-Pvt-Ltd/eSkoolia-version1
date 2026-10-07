import {
  blockReasonText,
  buildReturnInput,
  dueNoteText,
  formatCountdown,
  formatDate,
  knownRenewBlock,
  looksLikeCopyCode,
  refusalMessage,
  returnActions,
  returnDraftError,
  undoSecondsLeft,
  type ReturnDraft,
} from "@/components/library/issue-desk/deskHelpers";
import { LibraryApiError } from "@/hooks/useLibraryApi";

const draft = (over: Partial<ReturnDraft> = {}): ReturnDraft => ({ action: "return", waiveReason: "", condition: "", report: null, ...over });

describe("due-date notes", () => {
  it("formats the date and appends the server's note", () => {
    expect(formatDate("2026-03-24")).toBe("24 Mar 2026");
    expect(formatDate(null)).toBe("");
    expect(dueNoteText({ due_date: "2026-03-24", snapped: true, note: "Due on the next library period." })).toBe(
      "Due 24 Mar 2026. Due on the next library period.",
    );
    expect(dueNoteText({ due_date: "2026-03-24", snapped: false, note: "" })).toBe("Due 24 Mar 2026.");
  });
});

describe("block reasons", () => {
  it("says why, with the amount and the limit when known", () => {
    expect(blockReasonText("ok")).toBe("");
    expect(blockReasonText("suspended", { amountDue: "250.00" })).toContain("250.00");
    expect(blockReasonText("suspended")).toMatch(/suspended/i);
    expect(blockReasonText("limit_reached", { limit: 2, activeLoans: 2 })).toBe("At the borrowing limit (2 of 2 books out).");
    expect(blockReasonText("limit_reached")).toBe("At the borrowing limit.");
    for (const reason of ["already_holding", "not_eligible_audience", "reference_only", "no_copy_left", "inactive"] as const) {
      expect(blockReasonText(reason).length).toBeGreaterThan(5);
    }
  });
});

describe("refusal messages", () => {
  const error = (code: string, payload?: Record<string, unknown>, message = "server text", status = 409) =>
    new LibraryApiError(message, { code, status, payload });

  it("turns each library error code into the exact reason", () => {
    expect(refusalMessage(error("library_member_suspended", { amount_due: "30.00" }))).toContain("30.00");
    expect(refusalMessage(error("library_limit_reached", { limit: 2, active_loans: 2 }))).toContain("2 of 2");
    expect(refusalMessage(error("library_renewal_cap", { max_renewals: 2 }))).toContain("2 renewals");
    expect(refusalMessage(error("library_hold_exists"))).toMatch(/waiting/);
    expect(refusalMessage(error("library_loan_overdue"))).toMatch(/overdue/);
    expect(refusalMessage(error("library_copy_unavailable"))).toMatch(/elsewhere/);
    expect(refusalMessage(error("library_undo_expired"))).toMatch(/undo window/);
  });

  it("names the date a closed loan was closed", () => {
    expect(refusalMessage(error("library_already_returned", { status: "returned", return_date: "2026-03-01" }))).toContain("1 Mar 2026");
    expect(refusalMessage(error("library_already_returned"))).toBe("This loan was already closed.");
  });

  it("uses the server message for other states and for unknown codes", () => {
    expect(refusalMessage(error("library_invalid_state_transition", {}, "This charge is already paid."))).toBe("This charge is already paid.");
    expect(refusalMessage(error("something_else", {}, "Custom"))).toBe("Custom");
  });

  it("handles outages and non-library errors", () => {
    expect(refusalMessage(error("x", {}, "down", 503))).toMatch(/temporarily unavailable/);
    expect(refusalMessage(new Error("boom"))).toBe("boom");
    expect(refusalMessage(new Error("401"), "fallback")).toBe("fallback");
    expect(refusalMessage(null, "fallback")).toBe("fallback");
  });
});

describe("undo countdown", () => {
  const now = Date.parse("2026-03-24T10:00:00Z");
  it("counts down to zero and never goes negative", () => {
    expect(undoSecondsLeft("2026-03-24T10:09:42Z", now)).toBe(582);
    expect(undoSecondsLeft("2026-03-24T09:59:00Z", now)).toBe(0);
    expect(undoSecondsLeft(null, now)).toBe(0);
    expect(undoSecondsLeft("not a date", now)).toBe(0);
  });
  it("formats minutes and seconds", () => {
    expect(formatCountdown(582)).toBe("9:42");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(-3)).toBe("0:00");
  });
});

describe("return choices", () => {
  it("offers only a plain return when nothing is due", () => {
    expect(returnActions({ accrued_fine: "0.00" }, true)).toEqual(["return"]);
  });
  it("offers waive only to people who can waive", () => {
    expect(returnActions({ accrued_fine: "30.00" }, true)).toEqual(["collect", "waive"]);
    expect(returnActions({ accrued_fine: "30.00" }, false)).toEqual(["collect"]);
  });
  it("requires a reason to waive", () => {
    expect(returnDraftError(draft({ action: "waive" }))).toMatch(/reason/);
    expect(returnDraftError(draft({ action: "waive", waiveReason: "  " }))).toMatch(/reason/);
    expect(returnDraftError(draft({ action: "waive", waiveReason: "Parent request" }))).toBeNull();
    expect(returnDraftError(draft({ action: "collect" }))).toBeNull();
  });
  it("builds the request without any money or date", () => {
    expect(buildReturnInput(draft())).toEqual({});
    expect(buildReturnInput(draft({ action: "collect", condition: "worn" }))).toEqual({ fine_action: "collect", condition: "worn" });
    expect(buildReturnInput(draft({ action: "waive", waiveReason: " ok " }))).toEqual({ fine_action: "waive", waive_reason: "ok" });
  });
  it("sends a report instead of a condition, and no fine action for a lost copy", () => {
    expect(buildReturnInput(draft({ action: "collect", condition: "worn", report: { type: "lost", notes: " bus " } }))).toEqual({
      report: { type: "lost", notes: "bus" },
    });
    expect(buildReturnInput(draft({ action: "collect", report: { type: "damaged", notes: "" } }))).toEqual({
      fine_action: "collect",
      report: { type: "damaged" },
    });
  });
});

describe("scanner input and renew pre-checks", () => {
  it("recognises a copy code", () => {
    expect(looksLikeCopyCode("LIB-FIC-0001/C1")).toBe(true);
    expect(looksLikeCopyCode(" lib-fic2-0012/c14 ")).toBe(true);
    expect(looksLikeCopyCode("Treasure Island")).toBe(false);
    expect(looksLikeCopyCode("LIB-FIC-0001")).toBe(false);
  });
  it("blocks renewing an overdue or closed loan before asking the server", () => {
    expect(knownRenewBlock({ state: "overdue", status: "issued" })).toMatch(/overdue/);
    expect(knownRenewBlock({ state: "returned", status: "returned" })).toMatch(/closed/);
    expect(knownRenewBlock({ state: "due_today", status: "issued" })).toBeNull();
    expect(knownRenewBlock({ state: "open", status: "issued" })).toBeNull();
  });
});

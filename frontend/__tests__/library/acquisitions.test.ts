import {
  formatMoney,
  isOverBudget,
  isValidAmount,
  poActions,
  REQUEST_NEXT,
  spentPercent,
} from "@/components/library/acquisitions/acquisitionsHelpers";
import { emptyWizard, toBookInput } from "@/components/library/catalogue/wizard";

describe("acquisitions helpers", () => {
  it("formats money with two decimals and tolerates blanks", () => {
    expect(formatMoney("1500.5")).toBe("1,500.50");
    expect(formatMoney(0)).toBe("0.00");
    expect(formatMoney("")).toBe("0.00");
    expect(formatMoney(null)).toBe("0.00");
    expect(formatMoney("abc")).toBe("0.00");
  });

  it("computes the committed share and clamps it", () => {
    expect(spentPercent({ budget: "10000.00", committed: "2500.00" })).toBe(25);
    expect(spentPercent({ budget: "10000.00", committed: "25000.00" })).toBe(100);
    expect(spentPercent({ budget: "0.00", committed: "500.00" })).toBe(0);
    expect(spentPercent({ budget: "100.00", committed: "0.00" })).toBe(0);
  });

  it("flags over budget only when a budget exists", () => {
    expect(isOverBudget({ has_budget: true, remaining: "-1.00" })).toBe(true);
    expect(isOverBudget({ has_budget: true, remaining: "0.00" })).toBe(false);
    expect(isOverBudget({ has_budget: false, remaining: "-300.00" })).toBe(false);
  });

  it("offers a purchase order only the steps the server allows", () => {
    expect(poActions({ status: "ordered", payment_status: "pending", linked_books: 0 })).toEqual({
      receive: true, cancel: true, markPaid: true, remove: true,
    });
    expect(poActions({ status: "ordered", payment_status: "pending", linked_books: 3 }).remove).toBe(false);
    expect(poActions({ status: "received", payment_status: "pending", linked_books: 0 })).toEqual({
      receive: false, cancel: false, markPaid: true, remove: false,
    });
    expect(poActions({ status: "received", payment_status: "paid", linked_books: 0 }).markPaid).toBe(false);
    expect(poActions({ status: "cancelled", payment_status: "pending", linked_books: 0 }).markPaid).toBe(false);
  });

  it("moves requests forward only", () => {
    expect(REQUEST_NEXT.pending).toEqual(["approved", "rejected"]);
    expect(REQUEST_NEXT.approved).toEqual(["ordered", "fulfilled"]);
    expect(REQUEST_NEXT.ordered).toEqual(["fulfilled"]);
    expect(REQUEST_NEXT.rejected).toEqual([]);
    expect(REQUEST_NEXT.fulfilled).toEqual([]);
  });

  it("validates money input", () => {
    expect(isValidAmount("1500")).toBe(true);
    expect(isValidAmount("1500.50")).toBe(true);
    expect(isValidAmount(" 20 ")).toBe(true);
    expect(isValidAmount("")).toBe(false);
    expect(isValidAmount("-5")).toBe(false);
    expect(isValidAmount("1.234")).toBe(false);
    expect(isValidAmount("12a")).toBe(false);
  });
});

describe("accession wizard source links", () => {
  const base = { ...emptyWizard(), title: "Atlas", category: "4", age_band: "primary" as const };

  it("sends the purchase order only for a purchased title", () => {
    expect(toBookInput({ ...base, source: "purchased", purchase_order: "7", donation: "9" })).toMatchObject({
      purchase_order: 7, donation: null,
    });
  });

  it("sends the donation only for a donated title", () => {
    expect(toBookInput({ ...base, source: "donated", purchase_order: "7", donation: "9" })).toMatchObject({
      purchase_order: null, donation: 9,
    });
  });

  it("sends null when nothing is chosen", () => {
    expect(toBookInput(base)).toMatchObject({ purchase_order: null, donation: null });
  });
});

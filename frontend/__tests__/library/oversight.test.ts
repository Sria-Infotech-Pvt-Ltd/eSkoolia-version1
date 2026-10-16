import {
  EMPTY_FILTERS,
  EVENT_CHIPS,
  eventLabel,
  exportMessage,
  hasFilters,
  rangeIsBackwards,
  toggleType,
  toLogParams,
} from "@/components/library/transactions/logsHelpers";
import {
  budgetChartRows,
  collectionRate,
  feeChartRows,
  feesAreEmpty,
  formatAmount,
  monthLabel,
  moneyNumber,
  rangeText,
  trendIsEmpty,
} from "@/components/library/reports/reportsHelpers";
import type { FeeTypeRow } from "@/types/library";

describe("transaction log helpers", () => {
  it("covers every event type the server can write", () => {
    expect(EVENT_CHIPS).toHaveLength(16);
    expect(eventLabel("request")).toBe("Teacher request");
    expect(eventLabel("audit")).toBe("Stock check");
    expect(eventLabel("something_new")).toBe("something_new");
  });

  it("toggles chips and keeps a stable order", () => {
    expect(toggleType([], "return")).toEqual(["return"]);
    expect(toggleType(["return"], "issue")).toEqual(["issue", "return"]);
    expect(toggleType(["issue", "return"], "issue")).toEqual(["return"]);
  });

  it("builds query parameters without empty filters", () => {
    expect(toLogParams(EMPTY_FILTERS)).toEqual({});
    expect(toLogParams({ types: ["issue", "lost"], from: "2026-03-01", to: "", member: 7, search: "  atlas " })).toEqual({
      event_type: "issue,lost", from: "2026-03-01", member: 7, search: "atlas",
    });
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, search: "x" })).toBe(true);
    expect(hasFilters({ ...EMPTY_FILTERS, search: "   " })).toBe(false);
  });

  it("spots a backwards date range", () => {
    expect(rangeIsBackwards("2026-03-05", "2026-03-01")).toBe(true);
    expect(rangeIsBackwards("2026-03-01", "2026-03-01")).toBe(false);
    expect(rangeIsBackwards("", "2026-03-01")).toBe(false);
  });

  it("says what an export did", () => {
    expect(exportMessage(0)).toContain("only the header row");
    expect(exportMessage(1)).toBe("Exported 1 row.");
    expect(exportMessage(1200)).toBe("Exported 1,200 rows.");
    expect(exportMessage(50000)).toContain("limit is 50,000");
  });
});

describe("report helpers", () => {
  const row = (over: Partial<FeeTypeRow>): FeeTypeRow => ({
    charge_type: "overdue_fine", count: 1, charged: "100.00", collected: "60.00", waived: "10.00", written_off: "0.00", outstanding: "30.00", ...over,
  });

  it("labels months and ranges", () => {
    expect(monthLabel("2026-07")).toBe("Jul 2026");
    expect(monthLabel("junk")).toBe("junk");
    expect(rangeText("2026-06-01", "2027-03-31")).toBe("1 Jun 2026 to 31 Mar 2027");
  });

  it("formats money and tolerates bad input", () => {
    expect(formatAmount("1500.5")).toBe("1,500.50");
    expect(formatAmount(null)).toBe("0.00");
    expect(moneyNumber("12.30")).toBe(12.3);
    expect(moneyNumber("abc")).toBe(0);
  });

  it("detects empty trend and fee reports", () => {
    expect(trendIsEmpty([{ month: "2026-07", issues: 0, returns: 0 }])).toBe(true);
    expect(trendIsEmpty([{ month: "2026-07", issues: 0, returns: 2 }])).toBe(false);
    expect(feesAreEmpty({ count: 0, charged: "0.00", collected: "0.00", waived: "0.00", written_off: "0.00", outstanding: "0.00" })).toBe(true);
  });

  it("builds chart rows with labels", () => {
    expect(feeChartRows([row({}), row({ charge_type: "replacement", collected: "5.50" })]).map((r) => [r.name, r.collected])).toEqual([
      ["Overdue fines", 60], ["Replacement fees", 5.5],
    ]);
    expect(budgetChartRows({ budget: "10000.00", committed: "3500.00", paid: "1500.00" })).toEqual([
      { name: "Budget", value: 10000 }, { name: "Committed", value: 3500 }, { name: "Paid", value: 1500 },
    ]);
  });

  it("computes the collection rate as a clamped percentage", () => {
    expect(collectionRate({ charged: "200.00", collected: "50.00" })).toBe(25);
    expect(collectionRate({ charged: "0.00", collected: "0.00" })).toBe(0);
    expect(collectionRate({ charged: "10.00", collected: "20.00" })).toBe(100);
  });
});

import type { BudgetVsSpend, FeeColumns, FeeTypeRow, MonthlyTrendRow } from "@/types/library";

export const FEE_TYPE_LABEL: Record<FeeTypeRow["charge_type"], string> = {
  registration: "Registration",
  overdue_fine: "Overdue fines",
  replacement: "Replacement fees",
};

/** "2026-07" as "Jul 2026". Anything else is returned unchanged. */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return month;
  return new Date(Number(match[1]), Number(match[2]) - 1, 1).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/** Money string to a number for a chart axis. Not for display or arithmetic that matters. */
export function moneyNumber(value: string | number | null | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Money for text: grouping and two decimals. */
export function formatAmount(value: string | number | null | undefined): string {
  return moneyNumber(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** True when a report has nothing to chart. */
export function trendIsEmpty(rows: MonthlyTrendRow[]): boolean {
  return rows.every((row) => row.issues === 0 && row.returns === 0);
}

export function feesAreEmpty(totals: FeeColumns): boolean {
  return totals.count === 0;
}

/** Stacked bar rows, one per charge type. Numbers are for the chart only; the table shows the exact strings. */
export function feeChartRows(rows: FeeTypeRow[]) {
  return rows.map((row) => ({
    name: FEE_TYPE_LABEL[row.charge_type],
    collected: moneyNumber(row.collected),
    waived: moneyNumber(row.waived),
    written_off: moneyNumber(row.written_off),
    outstanding: moneyNumber(row.outstanding),
  }));
}

/** Three bars: budget, committed and paid. */
export function budgetChartRows(report: Pick<BudgetVsSpend, "budget" | "committed" | "paid">) {
  return [
    { name: "Budget", value: moneyNumber(report.budget) },
    { name: "Committed", value: moneyNumber(report.committed) },
    { name: "Paid", value: moneyNumber(report.paid) },
  ];
}

/** Collected share of what was charged, as a whole percentage. Nothing charged gives 0. */
export function collectionRate(totals: Pick<FeeColumns, "charged" | "collected">): number {
  const charged = moneyNumber(totals.charged);
  if (!(charged > 0)) return 0;
  return Math.min(100, Math.round((moneyNumber(totals.collected) / charged) * 100));
}

/** "1 Jun 2026 to 31 Mar 2027". */
export function rangeText(from: string, to: string): string {
  const format = (iso: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!match) return iso;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  };
  return `${format(from)} to ${format(to)}`;
}

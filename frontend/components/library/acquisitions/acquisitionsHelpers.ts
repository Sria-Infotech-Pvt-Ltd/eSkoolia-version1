import type {
  AcquisitionsSummary,
  BookRequestStatus,
  DonorType,
  PaymentStatus,
  PoStatus,
  PurchaseOrder,
} from "@/types/library";

export const DONOR_TYPE_LABEL: Record<DonorType, string> = {
  parent: "Parent",
  alumni: "Alumni",
  staff: "Staff",
  publisher: "Publisher",
  ngo_trust: "NGO or trust",
};

export const REQUEST_STATUS_LABEL: Record<BookRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  ordered: "Ordered",
  fulfilled: "Fulfilled",
};

/** Forward-only moves, mirroring services/acquisitions.py. */
export const REQUEST_NEXT: Record<BookRequestStatus, Exclude<BookRequestStatus, "pending">[]> = {
  pending: ["approved", "rejected"],
  approved: ["ordered", "fulfilled"],
  ordered: ["fulfilled"],
  rejected: [],
  fulfilled: [],
};

/** Money as the server sends it ("1500.50"), shown with grouping and two decimals. Not a currency symbol: the school sets that elsewhere. */
export function formatMoney(value: string | number | null | undefined): string {
  const number = typeof value === "number" ? value : Number(value);
  if (value === null || value === undefined || value === "" || Number.isNaN(number)) return "0.00";
  return number.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Share of the budget already committed, 0 to 100. No budget (or zero) gives 0. */
export function spentPercent(summary: Pick<AcquisitionsSummary, "budget" | "committed">): number {
  const budget = Number(summary.budget);
  const committed = Number(summary.committed);
  if (!(budget > 0) || Number.isNaN(committed) || committed <= 0) return 0;
  return Math.min(100, Math.round((committed / budget) * 100));
}

export function isOverBudget(summary: Pick<AcquisitionsSummary, "has_budget" | "remaining">): boolean {
  return summary.has_budget && Number(summary.remaining) < 0;
}

/** What a purchase order can still do. Delete needs an open order with no titles linked. */
export function poActions(order: Pick<PurchaseOrder, "status" | "payment_status" | "linked_books">): {
  receive: boolean;
  cancel: boolean;
  markPaid: boolean;
  remove: boolean;
} {
  const open = order.status === "ordered";
  return {
    receive: open,
    cancel: open,
    markPaid: order.payment_status === "pending" && order.status !== "cancelled",
    remove: open && order.linked_books === 0,
  };
}

export const PO_STATUS_TONE: Record<PoStatus, "warn" | "ok" | "neutral"> = {
  ordered: "warn",
  received: "ok",
  cancelled: "neutral",
};

export const PAYMENT_TONE: Record<PaymentStatus, "warn" | "ok"> = { pending: "warn", paid: "ok" };

/** True when a money field holds a non-negative number with at most two decimals. */
export function isValidAmount(text: string): boolean {
  return /^\d{1,10}(\.\d{1,2})?$/.test(text.trim());
}

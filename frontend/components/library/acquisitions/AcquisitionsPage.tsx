"use client";

import { useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import { SkeletonRows, StateBox, useToast } from "../catalogue/ui";
import { BudgetCard } from "./BudgetCard";
import { DonationsSection } from "./DonationsSection";
import { PurchaseOrdersSection } from "./PurchaseOrdersSection";
import { RequestsSection } from "./RequestsSection";

const SECTION_CODES = [
  "library.budgets.view",
  "library.purchase_orders.view",
  "library.donations.view",
  "library.donations.create",
  "library.book_requests.view",
];

export function AcquisitionsPage() {
  const { me, can } = usePermissions();
  // Bumped after any purchase order change so the budget card reloads its totals.
  const [refreshKey, setRefreshKey] = useState(0);
  const { show, node: toastNode } = useToast();

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={6} />
      </Shell>
    );
  }
  if (!SECTION_CODES.some((code) => can(code))) {
    return (
      <Shell>
        <StateBox title="You do not have access to acquisitions">
          Ask an administrator to give your role the library budgets, purchase orders, donations or book requests permission.
        </StateBox>
      </Shell>
    );
  }

  const changed = (message: string, tone: "ok" | "danger" = "ok") => {
    show(message, tone);
    setRefreshKey((n) => n + 1);
  };

  return (
    <Shell>
      {can("library.budgets.view") ? <BudgetCard canManage={can("library.budgets.manage")} refreshKey={refreshKey} onSaved={(message) => show(message)} /> : null}
      <PurchaseOrdersSection can={can} refreshKey={refreshKey} onChanged={changed} />
      <DonationsSection can={can} onChanged={(message, tone) => show(message, tone ?? "ok")} />
      <RequestsSection can={can} onChanged={(message, tone) => show(message, tone ?? "ok")} />
      {toastNode}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Acquisitions</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Budget, purchase orders, donations and what teachers have asked for</p>
      </div>
      {children}
    </div>
  );
}

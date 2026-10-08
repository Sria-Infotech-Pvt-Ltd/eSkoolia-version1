"use client";

import { useMemo, useState } from "react";
import { usePermissions } from "@/hooks/usePermissions";
import type { ReportRangeParams } from "@/types/library";
import { Btn, inputStyle, SkeletonRows, StateBox } from "../catalogue/ui";
import { rangeIsBackwards } from "../transactions/logsHelpers";
import { BudgetPanel, CirculationPanel, FeesPanel, TrendPanel } from "./ReportPanels";

export function ReportsPage() {
  const { me, can } = usePermissions();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const backwards = rangeIsBackwards(from, to);
  // Blank means the current academic year (the server's default). A backwards range is never sent.
  const params = useMemo<ReportRangeParams>(() => (backwards ? {} : { ...(from ? { from } : {}), ...(to ? { to } : {}) }), [from, to, backwards]);

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={8} columns={4} />
      </Shell>
    );
  }
  if (!can("library.reports.view")) {
    return (
      <Shell>
        <StateBox title="You do not have access to library reports">Ask an administrator to give your role the library reports view permission.</StateBox>
      </Shell>
    );
  }

  return (
    <Shell>
      <div role="group" aria-label="Period" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 16 }}>
        <label style={labelText}>
          From
          <input type="date" style={{ ...inputStyle, width: 160 }} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label style={labelText}>
          To
          <input type="date" style={{ ...inputStyle, width: 160 }} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </label>
        {from || to ? <Btn variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>Use the current academic year</Btn> : <span style={{ fontSize: 12, color: "var(--ink-3)", paddingBottom: 10 }}>Showing the current academic year. Pick dates to change it.</span>}
      </div>
      {backwards ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>The end date is before the start date, so the current academic year is shown.</div> : null}
      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))" }}>
        <CirculationPanel params={params} />
        <TrendPanel params={params} />
        <FeesPanel params={params} />
        <BudgetPanel />
      </div>
    </Shell>
  );
}

const labelText = { display: "grid", gap: 3, fontSize: 12, fontWeight: 600, color: "var(--ink-2)" } as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Reports</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Worked out from real loans, charges and orders</p>
      </div>
      {children}
    </div>
  );
}

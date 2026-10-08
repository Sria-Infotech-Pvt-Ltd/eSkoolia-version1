"use client";

import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getBudgetVsSpend, getCirculationByCategory, getFinesAndFees, getMonthlyTrend } from "@/hooks/useLibraryApi";
import type { ReportRangeParams } from "@/types/library";
import { Btn, Pill, SkeletonRows, StateBox, tdStyle, thStyle } from "../catalogue/ui";
import { colorVar } from "../catalogue/colors";
import {
  budgetChartRows,
  collectionRate,
  feeChartRows,
  FEE_TYPE_LABEL,
  feesAreEmpty,
  formatAmount,
  monthLabel,
  rangeText,
  trendIsEmpty,
} from "./reportsHelpers";
import { useReport, type ReportState } from "./useReport";

const AXIS = { fill: "var(--ink-3)", fontSize: 11 } as const;
const TOOLTIP = { background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 8, color: "var(--ink-1)", fontSize: 12 } as const;
const panel = { background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 16 } as const;

function Panel<T>({
  title, caption, state, empty, isEmpty, emptyText, children,
}: {
  title: string; caption?: string; state: ReportState<T>; empty?: ReactNode; isEmpty: (data: T) => boolean; emptyText: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <section style={panel} aria-label={title}>
      <h2 style={{ margin: 0, fontSize: 15, color: "var(--ink-1)" }}>{title}</h2>
      {caption ? <p style={{ margin: "2px 0 10px", fontSize: 12, color: "var(--ink-3)" }}>{caption}</p> : <div style={{ height: 10 }} />}
      {state.loading ? (
        <SkeletonRows rows={4} columns={3} />
      ) : state.error ? (
        <StateBox tone={state.status === 400 || state.status === 404 ? "neutral" : "danger"} title={state.status === 400 || state.status === 404 ? "Nothing to show yet" : `Could not load ${title.toLowerCase()}`}>
          {state.error} <Btn small onClick={state.reload}>Retry</Btn>
        </StateBox>
      ) : state.data === null || isEmpty(state.data) ? (
        (empty ?? <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>{emptyText}</p>)
      ) : (
        children(state.data)
      )}
    </section>
  );
}

function Figures({ children }: { children: ReactNode }) {
  return (
    <details style={{ marginTop: 10 }}>
      <summary style={{ fontSize: 12, color: "var(--pu-deep)", cursor: "pointer" }}>Show the figures</summary>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </details>
  );
}

export function CirculationPanel({ params }: { params: ReportRangeParams }) {
  const key = JSON.stringify(params);
  const state = useReport(true, () => getCirculationByCategory(params, { silent401: true }), key, "Could not load circulation by category.");
  return (
    <Panel
      title="Circulation by category"
      caption={state.data ? `${state.data.total} loan${state.data.total === 1 ? "" : "s"}, ${rangeText(state.data.from, state.data.to)}` : undefined}
      state={state}
      isEmpty={(d) => d.total === 0}
      emptyText="No books were issued in this period."
    >
      {(data) => (
        <>
          <ResponsiveContainer width="100%" height={Math.max(160, data.results.length * 34)}>
            <BarChart data={data.results} layout="vertical" margin={{ left: 8, right: 16 }}>
              <CartesianGrid stroke="var(--bd)" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={AXIS} stroke="var(--bd-2)" />
              <YAxis type="category" dataKey="category_name" width={110} tick={AXIS} stroke="var(--bd-2)" />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--bg-2)" }} />
              <Bar dataKey="issues" name="Loans" radius={[0, 4, 4, 0]}>
                {data.results.map((row) => (
                  <Cell key={row.category ?? "none"} fill={colorVar(row.color_key)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Figures>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr><th style={thStyle}>Category</th><th style={thStyle}>Loans</th><th style={thStyle}>Share</th></tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.category ?? "none"}>
                    <td style={tdStyle}>{row.category_name}</td>
                    <td style={tdStyle}>{row.issues}</td>
                    <td style={tdStyle}>{Math.round(row.share * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Figures>
        </>
      )}
    </Panel>
  );
}

export function TrendPanel({ params }: { params: ReportRangeParams }) {
  const key = JSON.stringify(params);
  const state = useReport(true, () => getMonthlyTrend(params, { silent401: true }), key, "Could not load the monthly trend.");
  return (
    <Panel
      title="Monthly circulation"
      caption={state.data ? `${state.data.total_issues} issued and ${state.data.total_returns} returned, ${rangeText(state.data.from, state.data.to)}` : undefined}
      state={state}
      isEmpty={(d) => trendIsEmpty(d.results)}
      emptyText="No loans were issued or returned in this period."
    >
      {(data) => (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.results.map((r) => ({ ...r, label: monthLabel(r.month) }))} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--bd)" vertical={false} />
              <XAxis dataKey="label" tick={AXIS} stroke="var(--bd-2)" />
              <YAxis allowDecimals={false} tick={AXIS} stroke="var(--bd-2)" width={32} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--bg-2)" }} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} />
              <Bar dataKey="issues" name="Issued" fill="var(--pu)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="returns" name="Returned" fill="var(--ok)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Figures>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr><th style={thStyle}>Month</th><th style={thStyle}>Issued</th><th style={thStyle}>Returned</th></tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr key={row.month}>
                    <td style={tdStyle}>{monthLabel(row.month)}</td>
                    <td style={tdStyle}>{row.issues}</td>
                    <td style={tdStyle}>{row.returns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Figures>
        </>
      )}
    </Panel>
  );
}

export function FeesPanel({ params }: { params: ReportRangeParams }) {
  const key = JSON.stringify(params);
  const state = useReport(true, () => getFinesAndFees(params, { silent401: true }), key, "Could not load fines and fees.");
  return (
    <Panel
      title="Fines and fees"
      caption={state.data ? `Charged ${formatAmount(state.data.totals.charged)}, ${collectionRate(state.data.totals)}% collected, ${rangeText(state.data.from, state.data.to)}` : undefined}
      state={state}
      isEmpty={(d) => feesAreEmpty(d.totals)}
      emptyText="No fines or fees were charged in this period."
    >
      {(data) => (
        <>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={feeChartRows(data.results)} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--bd)" vertical={false} />
              <XAxis dataKey="name" tick={AXIS} stroke="var(--bd-2)" />
              <YAxis tick={AXIS} stroke="var(--bd-2)" width={52} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--bg-2)" }} />
              <Legend wrapperStyle={{ fontSize: 12, color: "var(--ink-2)" }} />
              <Bar dataKey="collected" name="Collected" stackId="fees" fill="var(--ok)" />
              <Bar dataKey="waived" name="Waived" stackId="fees" fill="var(--info)" />
              <Bar dataKey="written_off" name="Written off" stackId="fees" fill="var(--ink-4)" />
              <Bar dataKey="outstanding" name="Outstanding" stackId="fees" fill="var(--warn)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <Figures>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Type</th><th style={thStyle}>Charged</th><th style={thStyle}>Collected</th>
                  <th style={thStyle}>Waived</th><th style={thStyle}>Written off</th><th style={thStyle}>Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {[...data.results.map((r) => ({ ...r, label: FEE_TYPE_LABEL[r.charge_type] })), { ...data.totals, label: "Total", charge_type: "total" }].map((row) => (
                  <tr key={row.charge_type} style={row.charge_type === "total" ? { fontWeight: 700 } : undefined}>
                    <td style={tdStyle}>{row.label}</td>
                    <td style={tdStyle}>{formatAmount(row.charged)}</td>
                    <td style={tdStyle}>{formatAmount(row.collected)}</td>
                    <td style={tdStyle}>{formatAmount(row.waived)}</td>
                    <td style={tdStyle}>{formatAmount(row.written_off)}</td>
                    <td style={tdStyle}>{formatAmount(row.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Figures>
        </>
      )}
    </Panel>
  );
}

export function BudgetPanel() {
  const state = useReport(true, () => getBudgetVsSpend(undefined, { silent401: true }), "current", "Could not load budget against spend.");
  return (
    <Panel
      title="Budget against spend"
      caption={state.data ? `${state.data.academic_year_name}, ${rangeText(state.data.from, state.data.to)}. Always the current academic year.` : "Always the current academic year."}
      state={state}
      isEmpty={(d) => !d.has_budget && Number(d.committed) === 0}
      emptyText="No budget is set and nothing has been ordered this academic year. Set one on the Acquisitions page."
    >
      {(data) => (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, fontSize: 13, color: "var(--ink-1)" }}>
            Remaining <strong style={{ color: Number(data.remaining) < 0 ? "var(--danger)" : "var(--ink-1)" }}>{formatAmount(data.remaining)}</strong>
            {Number(data.remaining) < 0 && data.has_budget ? <Pill tone="danger">Over budget</Pill> : null}
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={budgetChartRows(data)} margin={{ left: 0, right: 8 }}>
              <CartesianGrid stroke="var(--bd)" vertical={false} />
              <XAxis dataKey="name" tick={AXIS} stroke="var(--bd-2)" />
              <YAxis tick={AXIS} stroke="var(--bd-2)" width={56} />
              <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "var(--bg-2)" }} />
              <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]}>
                <Cell fill="var(--info)" />
                <Cell fill="var(--warn)" />
                <Cell fill="var(--ok)" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Figures>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <tbody>
                {([["Budget", data.has_budget ? formatAmount(data.budget) : "Not set"], ["Committed", formatAmount(data.committed)], ["Paid", formatAmount(data.paid)], ["Remaining", formatAmount(data.remaining)]] as const).map(([label, value]) => (
                  <tr key={label}><td style={tdStyle}>{label}</td><td style={tdStyle}>{value}</td></tr>
                ))}
                {data.by_status.map((row) => (
                  <tr key={row.status}><td style={tdStyle}>Orders {row.status}</td><td style={tdStyle}>{row.orders} ({formatAmount(row.total)})</td></tr>
                ))}
              </tbody>
            </table>
          </Figures>
        </>
      )}
    </Panel>
  );
}

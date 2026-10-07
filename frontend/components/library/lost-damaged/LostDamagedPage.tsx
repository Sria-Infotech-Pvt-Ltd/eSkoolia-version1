"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listReports, markReportFeePaid, resolveReport, updateReportNotes } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistentPagination } from "@/hooks/usePersistentPagination";
import type { FeeStatus, LostDamagedRow, ReportResolution, ReportType } from "@/types/library";
import { Btn, ConfirmDialog, inputStyle, Pill, SkeletonRows, StateBox, tdStyle, thStyle, useToast } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { BillPrintView } from "./BillPrintView";
import { ReportCopyModal } from "./ReportCopyModal";

const FEE_PILL: Record<FeeStatus, { tone: "warn" | "ok" | "neutral" | "danger"; label: string }> = {
  charged: { tone: "warn", label: "Charged" },
  paid: { tone: "ok", label: "Paid" },
  waived: { tone: "neutral", label: "Waived" },
  written_off: { tone: "neutral", label: "Written off" },
  none: { tone: "neutral", label: "No fee" },
};

export function LostDamagedPage() {
  const { me, can } = usePermissions();
  const { page, pageSize, setPage, setPageSize } = usePersistentPagination("library-lost-damaged", 1, 25);
  const [resolution, setResolution] = useState<ReportResolution | "">("pending");
  const [type, setType] = useState<ReportType | "">("");
  const [rows, setRows] = useState<LostDamagedRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [bill, setBill] = useState<number | null>(null);
  const [reporting, setReporting] = useState(false);
  const [resolving, setResolving] = useState<LostDamagedRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const { show, node: toastNode } = useToast();
  const latest = useRef(0);
  const canView = can("library.lost_damaged.view");

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const data = await listReports({ page, page_size: pageSize, resolution: resolution || undefined, report_type: type || undefined });
      if (ticket !== latest.current) return;
      setRows(data.results);
      setCount(data.count);
    } catch (err) {
      if (ticket !== latest.current) return;
      if ((err as { status?: number }).status === 404 && page > 1) {
        setPage(1);
        return;
      }
      setError(refusalMessage(err, "Could not load the reports."));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolution, type, page, pageSize]);

  useEffect(() => {
    if (me && canView) void load();
  }, [me, canView, load]);

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      show(done);
      await load();
    } catch (err) {
      // 409: someone else changed it first. Say why and show the current state.
      show(refusalMessage(err), "danger");
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={7} />
      </Shell>
    );
  }
  if (!canView) {
    return (
      <Shell>
        <StateBox title="You do not have access to lost and damaged reports">Ask an administrator to give your role the library lost and damaged view permission.</StateBox>
      </Shell>
    );
  }

  const pages = Math.max(1, Math.ceil(count / pageSize));
  const filtered = Boolean(resolution || type);

  return (
    <Shell
      actions={
        can("library.lost_damaged.create") ? (
          <Btn variant="primary" onClick={() => setReporting(true)}>
            Report a copy
          </Btn>
        ) : null
      }
    >
      <div role="group" aria-label="Filters" style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <select aria-label="Resolution" style={{ ...inputStyle, width: 170 }} value={resolution} onChange={(e) => { setResolution(e.target.value as ReportResolution | ""); setPage(1); }}>
          <option value="">All reports</option>
          <option value="pending">Pending</option>
          <option value="resolved">Resolved</option>
        </select>
        <select aria-label="Type" style={{ ...inputStyle, width: 170 }} value={type} onChange={(e) => { setType(e.target.value as ReportType | ""); setPage(1); }}>
          <option value="">Lost and damaged</option>
          <option value="lost">Lost</option>
          <option value="damaged">Damaged</option>
        </select>
      </div>

      {error ? (
        <StateBox tone="danger" title="Could not load the reports">
          {error} <Btn small onClick={load}>Retry</Btn>
        </StateBox>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: "4px 8px" }}>
          {loading ? (
            <SkeletonRows rows={6} columns={8} />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Borrower</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}>Replacement</th>
                  <th style={thStyle}>Fee</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const fee = FEE_PILL[row.fee_status];
                  return (
                    <tr key={row.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>{row.book_title}</div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{row.copy_code}</div>
                      </td>
                      <td style={tdStyle}>{row.member_name || <span style={{ color: "var(--ink-3)" }}>None (shelf)</span>}</td>
                      <td style={tdStyle}>
                        <Pill tone={row.report_type === "lost" ? "danger" : "warn"}>{row.report_type === "lost" ? "Lost" : "Damaged"}</Pill>
                      </td>
                      <td style={tdStyle}>{formatDate(row.reported_on)}</td>
                      <td style={{ ...tdStyle, minWidth: 180 }}>
                        {editing?.id === row.id ? (
                          <span style={{ display: "flex", gap: 4 }}>
                            <input
                              aria-label="Note"
                              style={{ ...inputStyle, height: 30 }}
                              value={editing.text}
                              autoFocus
                              maxLength={1000}
                              onChange={(e) => setEditing({ id: row.id, text: e.target.value })}
                            />
                            <Btn
                              small
                              variant="primary"
                              disabled={busy}
                              onClick={async () => {
                                const text = editing.text;
                                setEditing(null);
                                await act(() => updateReportNotes(row.id, text), "Note saved");
                              }}
                            >
                              Save
                            </Btn>
                            <Btn small onClick={() => setEditing(null)}>Cancel</Btn>
                          </span>
                        ) : (
                          <>
                            {row.notes || <span style={{ color: "var(--ink-3)" }}>No note</span>}{" "}
                            {can("library.lost_damaged.update") ? (
                              <Btn small variant="ghost" onClick={() => setEditing({ id: row.id, text: row.notes })}>
                                {row.notes ? "Edit" : "Add note"}
                              </Btn>
                            ) : null}
                          </>
                        )}
                      </td>
                      <td style={tdStyle}>{row.replacement_cost}</td>
                      <td style={tdStyle}>
                        <Pill tone={fee.tone}>{fee.label}</Pill>
                      </td>
                      <td style={tdStyle}>
                        <Pill tone={row.resolution === "pending" ? "warn" : "ok"}>{row.resolution === "pending" ? "Pending" : "Resolved"}</Pill>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                        {row.fee_status === "charged" && can("library.charges.collect") ? (
                          <Btn small variant="ghost" disabled={busy} onClick={() => act(() => markReportFeePaid(row.id), "Fee marked as paid")}>
                            Mark fee paid
                          </Btn>
                        ) : null}
                        {row.resolution === "pending" && row.fee_status !== "charged" && can("library.lost_damaged.resolve") ? (
                          <Btn small variant="ghost" disabled={busy} onClick={() => setResolving(row)}>
                            Resolve
                          </Btn>
                        ) : null}
                        <Btn small variant="ghost" onClick={() => setBill(row.id)}>
                          Bill
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>
                      {filtered ? (
                        <>
                          Nothing matches this filter.{" "}
                          <Btn small variant="ghost" onClick={() => { setResolution(""); setType(""); setPage(1); }}>Show everything</Btn>
                        </>
                      ) : (
                        "Nothing lost or damaged on record."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!error && count > 0 ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--ink-2)", flexWrap: "wrap" }}>
          <span>{count} report{count === 1 ? "" : "s"}</span>
          <Btn small disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</Btn>
          <span>Page {page} of {pages}</span>
          <Btn small disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Next</Btn>
          <label>
            Per page{" "}
            <select aria-label="Page size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ ...inputStyle, width: 70, height: 30, display: "inline-block" }}>
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {bill !== null ? <BillPrintView reportId={bill} onClose={() => setBill(null)} /> : null}
      {reporting ? (
        <ReportCopyModal
          canFindCopy={can("library.book_copies.view")}
          onClose={() => setReporting(false)}
          onCreated={(message) => {
            setReporting(false);
            show(message);
            void load();
          }}
        />
      ) : null}
      {resolving ? (
        <ConfirmDialog
          title="Resolve report"
          message={`Close the ${resolving.report_type} report for ${resolving.book_title} (${resolving.copy_code})? The copy stays marked ${resolving.report_type}; withdraw or replace it from the catalogue.`}
          confirmLabel="Resolve"
          busy={busy}
          onConfirm={async () => {
            const target = resolving;
            setResolving(null);
            await act(() => resolveReport(target.id), "Report resolved");
          }}
          onCancel={() => setResolving(null)}
        />
      ) : null}
      {toastNode}
    </Shell>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Lost and damaged</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Copies that did not come back whole, and what is owed for them</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{actions}</div>
      </div>
      {children}
    </div>
  );
}

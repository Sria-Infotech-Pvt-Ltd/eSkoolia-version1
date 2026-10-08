"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  bulkMarkAuditItems,
  cancelStockAudit,
  finishStockAudit,
  getStockAudit,
  listStockAuditItems,
  markAuditItem,
  markAuditItemLost,
} from "@/hooks/useLibraryApi";
import type { StockAudit, StockAuditItem } from "@/types/library";
import { Btn, ConfirmDialog, inputStyle, Pill, SkeletonRows, StateBox, tdStyle, thStyle } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { groupByTitle, lostBlockReason, progressPercent, scopeLabel, unfoundIds } from "./stockHelpers";

const PAGE = 500;
const MAX_PAGES = 20;

interface Props {
  auditId: number;
  can: (code: string) => boolean;
  onBack: () => void;
  /** The audit list needs a reload (it finished, was cancelled, or its counts changed). */
  onChanged: (message?: string, tone?: "ok" | "danger") => void;
}

/** One stock check: tick copies while it is open, read the result once it is finished. */
export function AuditWorkspace({ auditId, can, onBack, onChanged }: Props) {
  const [audit, setAudit] = useState<StockAudit | null>(null);
  const [items, setItems] = useState<StockAuditItem[]>([]);
  const [filter, setFilter] = useState<"all" | "missing" | "found">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"finish" | "cancel" | null>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setError("");
    try {
      const detail = await getStockAudit(auditId);
      const rows: StockAuditItem[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const batch = await listStockAuditItems(auditId, { page, page_size: PAGE });
        rows.push(...batch.results);
        if (!batch.next) break;
      }
      if (ticket !== latest.current) return;
      setAudit(detail);
      setItems(rows);
    } catch (err) {
      if (ticket === latest.current) setError(refusalMessage(err, "Could not load this stock check."));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [auditId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) onChanged(done);
    } catch (err) {
      // 409: someone else finished or cancelled it first. Say why and show the current state.
      onChanged(refusalMessage(err), "danger");
    } finally {
      await load();
      setBusy(false);
    }
  };

  const mark = async (item: StockAuditItem, found: boolean) => {
    // Optimistic tick, rolled back by the reload if the server refuses.
    setItems((rows) => rows.map((row) => (row.id === item.id ? { ...row, found } : row)));
    setBusy(true);
    try {
      const result = await markAuditItem(auditId, item.id, found);
      setItems((rows) => rows.map((row) => (row.id === item.id ? result.item : row)));
      setAudit((current) => (current ? { ...current, progress: result.progress } : current));
    } catch (err) {
      onChanged(refusalMessage(err), "danger");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const markGroup = (ids: number[]) =>
    run(async () => {
      await bulkMarkAuditItems(auditId, ids, true);
    });

  if (loading) return <SkeletonRows rows={8} columns={5} />;
  if (error || !audit) {
    return (
      <StateBox tone="danger" title="Could not load this stock check">
        {error} <Btn small onClick={() => { setLoading(true); void load(); }}>Retry</Btn> <Btn small onClick={onBack}>Back</Btn>
      </StateBox>
    );
  }

  const open = audit.status === "in_progress";
  const completed = audit.status === "completed";
  const percent = progressPercent(audit.progress);
  const shown = items.filter((item) => (filter === "all" ? true : filter === "found" ? item.found : !item.found));
  const groups = groupByTitle(shown);
  const canRun = can("library.stock_audits.run");
  const canReportLost = can("library.lost_damaged.create");

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div>
          <Btn small variant="ghost" onClick={onBack}>Back to stock checks</Btn>
          <h2 style={{ margin: "4px 0 0", fontSize: 18, color: "var(--ink-1)" }}>
            {scopeLabel(audit)}{" "}
            <Pill tone={open ? "warn" : completed ? "ok" : "neutral"}>{open ? "In progress" : completed ? "Finished" : "Cancelled"}</Pill>
          </h2>
          <div style={{ fontSize: 12, color: "var(--ink-3)" }}>Started {formatDate(audit.started_at)}{audit.finished_at ? `, ended ${formatDate(audit.finished_at)}` : ""}</div>
        </div>
        {open && canRun ? (
          <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => setConfirm("cancel")} disabled={busy}>Cancel check</Btn>
            <Btn variant="primary" onClick={() => setConfirm("finish")} disabled={busy}>Finish check</Btn>
          </div>
        ) : null}
      </div>

      <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 16, marginBottom: 14 }}>
        {completed ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
            <Figure label="In scope" value={String(audit.total_in_scope)} />
            <Figure label="Accounted for" value={String(audit.accounted_count)} />
            <Figure label="Missing" value={String(audit.missing_count)} bad={audit.missing_count > 0} />
            <Figure label="Value at risk" value={audit.value_at_risk} bad={Number(audit.value_at_risk) > 0} />
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "var(--ink-1)", marginBottom: 6 }}>
              <strong>{audit.progress.found}</strong> of {audit.progress.total} copies found ({percent}%)
            </div>
            <div role="progressbar" aria-label="Copies found" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} style={{ height: 8, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
              <div style={{ width: `${percent}%`, height: "100%", background: "var(--pu)" }} />
            </div>
          </>
        )}
      </div>

      <div role="group" aria-label="Show" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <select aria-label="Show copies" style={{ ...inputStyle, width: 190 }} value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
          <option value="all">All copies</option>
          <option value="missing">{completed ? "Missing copies" : "Not found yet"}</option>
          <option value="found">Found copies</option>
        </select>
      </div>

      {groups.length === 0 ? (
        <StateBox title={filter === "all" ? "No copies in this stock check" : "Nothing matches this filter"}>
          {filter !== "all" ? <Btn small onClick={() => setFilter("all")}>Show all copies</Btn> : null}
        </StateBox>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {groups.map((group) => (
            <section key={group.book} aria-label={group.title} style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: "4px 12px 8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0" }}>
                <div>
                  <strong style={{ color: "var(--ink-1)" }}>{group.title}</strong>{" "}
                  <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{group.rack ? `Rack ${group.rack}` : "No rack"}, {group.found} of {group.items.length} found</span>
                </div>
                {open && canRun && unfoundIds(group).length > 0 ? (
                  <Btn small disabled={busy} onClick={() => markGroup(unfoundIds(group))}>Mark all found</Btn>
                ) : null}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Copy</th>
                    <th style={thStyle}>Status</th>
                    <th style={thStyle} />
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item) => {
                    const block = lostBlockReason(item);
                    return (
                      <tr key={item.id}>
                        <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>{item.copy_code}</td>
                        <td style={tdStyle}>
                          <Pill tone={item.found ? "ok" : completed ? "danger" : "neutral"}>{item.found ? "Found" : completed ? "Missing" : "Not found yet"}</Pill>
                        </td>
                        <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                          {open && canRun ? (
                            <Btn small variant="ghost" disabled={busy} onClick={() => mark(item, !item.found)}>{item.found ? "Undo" : "Mark found"}</Btn>
                          ) : null}
                          {completed && !item.found && canReportLost ? (
                            block ? (
                              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{block}</span>
                            ) : (
                              <Btn small variant="ghost" disabled={busy} onClick={() => run(() => markAuditItemLost(auditId, item.id), `${item.copy_code} reported lost`)}>Mark as lost</Btn>
                            )
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}

      {confirm === "finish" ? (
        <ConfirmDialog
          title="Finish stock check"
          message={`${audit.progress.total - audit.progress.found} copies have not been found and will be counted as missing. The counts cannot be changed afterwards.`}
          confirmLabel="Finish"
          busy={busy}
          onConfirm={() => {
            setConfirm(null);
            void run(async () => {
              await finishStockAudit(auditId);
            }, "Stock check finished");
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {confirm === "cancel" ? (
        <ConfirmDialog
          title="Cancel stock check"
          message="Nothing is recorded against any copy and the ticks are kept only on this cancelled check. You can start a new one for the same rack."
          confirmLabel="Cancel check"
          busy={busy}
          onConfirm={() => {
            setConfirm(null);
            void run(async () => {
              await cancelStockAudit(auditId);
            }, "Stock check cancelled");
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </div>
  );
}

function Figure({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: bad ? "var(--danger)" : "var(--ink-1)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

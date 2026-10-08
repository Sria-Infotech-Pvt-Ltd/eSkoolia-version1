"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getConsoleSummary, remindLoans } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import type { ConsoleSummary, Loan } from "@/types/library";
import { colorVar } from "../catalogue/colors";
import { Btn, ConfirmDialog, Dot, Pill, SkeletonRows, StateBox, tdStyle, thStyle, useToast } from "../catalogue/ui";
import { formatDate, formatTime, refusalMessage } from "../issue-desk/deskHelpers";
import { formatShare, POLL_INTERVAL_MS, remindSummaryText, shouldPoll, updatedText } from "./consoleHelpers";

const card = { background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 14 } as const;

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "warn" }) {
  return (
    <div style={{ ...card, minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color: tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : "var(--ink-1)", lineHeight: 1.2 }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{hint}</div> : null}
    </div>
  );
}

export function ConsolePage() {
  const { me, can } = usePermissions();
  const canView = can("library.console.view");
  const [data, setData] = useState<ConsoleSummary | null>(null);
  const [error, setError] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const { show, node: toastNode } = useToast();
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      // Background poll: silent401 so a stray 401 cannot log the librarian out mid-task.
      setData(await getConsoleSummary({ silent401: true }));
      setError("");
    } catch (err) {
      setError(refusalMessage(err, "The console could not be refreshed."));
    } finally {
      loading.current = false;
    }
  }, []);

  useEffect(() => {
    if (!me || !canView) return;
    void load();
    const handle = setInterval(() => {
      if (shouldPoll(document.visibilityState)) void load();
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (shouldPoll(document.visibilityState)) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(handle);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me, canView, load]);

  const remind = async (body: { issue_ids?: number[]; all_overdue?: boolean }) => {
    setBusy(true);
    try {
      show(remindSummaryText(await remindLoans(body)));
      await load();
    } catch (err) {
      show(refusalMessage(err, "Could not send reminders."), "danger");
    } finally {
      setBusy(false);
    }
  };

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={4} />
      </Shell>
    );
  }
  if (!canView) {
    return (
      <Shell>
        <StateBox title="You do not have access to the library console">
          Ask an administrator for the library console view permission, or go straight to the{" "}
          <Link href="/library/catalogue" style={{ color: "var(--pu-deep)" }}>catalogue</Link>.
        </StateBox>
      </Shell>
    );
  }

  const canRemind = can("library.book_issues.remind");

  return (
    <Shell updated={data ? updatedText(data.generated_at) : ""}>
      {error ? (
        <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "9px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {error} {data ? "Showing the last numbers received." : null} <Btn small onClick={load}>Retry</Btn>
        </div>
      ) : null}
      {!data && !error ? <SkeletonRows rows={6} columns={4} /> : null}
      {!data && error ? <StateBox tone="danger" title="The console could not be loaded">{error}</StateBox> : null}

      {data ? (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
            <Tile label="Titles" value={String(data.tiles.titles)} />
            <Tile label="Collection value" value={data.tiles.collection_value} hint="Copies not lost or withdrawn" />
            <Tile label="Copies available" value={`${data.tiles.copies_available} of ${data.tiles.copies_total}`} hint={`${formatShare(data.tiles.available_share)} on the shelf`} />
            <Tile label="Active loans" value={String(data.tiles.active_loans)} />
            <Tile label="Due today" value={String(data.due_today)} tone={data.due_today ? "warn" : undefined} />
            <Tile label="Overdue" value={String(data.overdue)} tone={data.overdue ? "danger" : undefined} />
            <Tile label="Holds waiting" value={String(data.holds_waiting)} />
            <div style={{ ...card }}>
              <div style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 600 }}>Lost and damaged pending</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: data.tiles.pending_reports ? "var(--danger)" : "var(--ink-1)", lineHeight: 1.2 }}>{data.tiles.pending_reports}</div>
              {can("library.lost_damaged.view") ? (
                <Link href="/library/lost-damaged" style={{ fontSize: 12, color: "var(--pu-deep)" }}>Open the list</Link>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ flex: "2 1 520px", minWidth: 0, display: "grid", gap: 16 }}>
              <section style={card} aria-label="Due and overdue">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 15, color: "var(--ink-1)" }}>Due and overdue</h2>
                  <span style={{ display: "flex", gap: 8 }}>
                    {can("library.book_issues.view") ? <Link href="/library/issue-desk" style={{ fontSize: 13, color: "var(--pu-deep)", alignSelf: "center" }}>Issue desk</Link> : null}
                    {canRemind ? (
                      <Btn small variant="primary" disabled={busy || data.overdue === 0} onClick={() => setConfirmAll(true)}>
                        Remind all overdue
                      </Btn>
                    ) : null}
                  </span>
                </div>
                {data.attention.length === 0 ? (
                  <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>Nothing is due today and nothing is overdue.</p>
                ) : (
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                      <thead>
                        <tr>
                          <th style={thStyle}>Book</th>
                          <th style={thStyle}>Borrower</th>
                          <th style={thStyle}>Due</th>
                          <th style={thStyle}>Fine so far</th>
                          <th style={thStyle} />
                        </tr>
                      </thead>
                      <tbody>
                        {data.attention.map((loan: Loan) => (
                          <tr key={loan.id}>
                            <td style={tdStyle}>{loan.book_title}</td>
                            <td style={tdStyle}>
                              {loan.member_name}
                              <span style={{ color: "var(--ink-3)", fontSize: 11 }}> {loan.school_class}</span>
                            </td>
                            <td style={tdStyle}>
                              {formatDate(loan.due_date)}{" "}
                              <Pill tone={loan.state === "overdue" ? "danger" : "warn"}>{loan.state === "overdue" ? `${loan.days_overdue}d late` : "Today"}</Pill>
                            </td>
                            <td style={tdStyle}>{loan.accrued_fine}</td>
                            <td style={{ ...tdStyle, textAlign: "right" }}>
                              {canRemind && loan.state === "overdue" ? (
                                <Btn small variant="ghost" disabled={busy} onClick={() => remind({ issue_ids: [loan.id] })}>
                                  Remind
                                </Btn>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {data.due_today + data.overdue > data.attention.length ? (
                  <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "8px 0 0" }}>Showing the oldest {data.attention.length}. The issue desk has the rest.</p>
                ) : null}
              </section>

              <section style={card} aria-label="Collection mix">
                <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "var(--ink-1)" }}>Collection mix</h2>
                {data.mix.length === 0 ? <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>No copies yet.</p> : null}
                {data.mix.map((row) => (
                  <div key={row.category_id ?? "none"} style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ink-1)" }}>
                      <span>
                        <Dot color={colorVar(row.color_key)} />
                        {row.name}
                      </span>
                      <span style={{ color: "var(--ink-3)" }}>
                        {row.copies} ({formatShare(row.share)})
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: "var(--bg-3)", marginTop: 3 }}>
                      <div style={{ width: formatShare(row.share), height: 6, borderRadius: 999, background: colorVar(row.color_key) }} />
                    </div>
                  </div>
                ))}
              </section>
            </div>

            <div style={{ flex: "1 1 300px", minWidth: 0, display: "grid", gap: 16 }}>
              <section style={card} aria-label="Library period">
                <h2 style={{ margin: "0 0 6px", fontSize: 15, color: "var(--ink-1)" }}>Library period</h2>
                {!("slots" in data.period) ? (
                  <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>No library period is running right now. Set up periods on the Periods and Occupancy page.</p>
                ) : (
                  <>
                    <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "0 0 6px" }}>{data.period.label}</p>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--ink-1)", fontVariantNumeric: "tabular-nums" }}>
                      {data.period.checked_in} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--ink-3)" }}>checked in of {data.period.scheduled}</span>
                    </div>
                    {data.period.slots.map((row) => (
                      <div key={row.slot_id} style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 4 }}>
                        {[row.class_name, row.section_name].filter(Boolean).join(" ")} in {row.room_label}: {row.checked_in} / {row.scheduled}
                      </div>
                    ))}
                  </>
                )}
              </section>

              <section style={card} aria-label="Holds waiting">
                <h2 style={{ margin: "0 0 6px", fontSize: 15, color: "var(--ink-1)" }}>Holds waiting</h2>
                {data.holds.length === 0 ? <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>Nobody is waiting for a title.</p> : null}
                {data.holds.map((hold) => (
                  <div key={hold.id} style={{ padding: "5px 0", borderBottom: "1px solid var(--bd)", fontSize: 13, color: "var(--ink-1)" }}>
                    <strong>{hold.book_title}</strong>
                    <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{hold.member_name} · {hold.card_no}</div>
                  </div>
                ))}
              </section>

              <section style={card} aria-label="Recent activity">
                <h2 style={{ margin: "0 0 6px", fontSize: 15, color: "var(--ink-1)" }}>Recent activity</h2>
                {data.activity.length === 0 ? <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>Nothing has happened yet.</p> : null}
                {data.activity.map((entry) => (
                  <div key={entry.id} style={{ padding: "5px 0", borderBottom: "1px solid var(--bd)", fontSize: 12 }}>
                    <div style={{ color: "var(--ink-1)" }}>{entry.summary}</div>
                    <div style={{ color: "var(--ink-3)" }}>
                      {formatDate(entry.created_at.slice(0, 10))} {formatTime(entry.created_at)}
                      {entry.actor_name ? ` · ${entry.actor_name}` : ""}
                    </div>
                  </div>
                ))}
              </section>
            </div>
          </div>
        </>
      ) : null}

      {confirmAll ? (
        <ConfirmDialog
          title="Remind all overdue"
          message="Send a reminder for every overdue loan that has not been reminded today? Families and staff are notified in the app. Each loan is reminded at most once a day."
          confirmLabel="Send reminders"
          busy={busy}
          onConfirm={async () => {
            setConfirmAll(false);
            await remind({ all_overdue: true });
          }}
          onCancel={() => setConfirmAll(false)}
        />
      ) : null}
      {toastNode}
    </Shell>
  );
}

function Shell({ children, updated }: { children: React.ReactNode; updated?: string }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Library console</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>The library at a glance. Refreshes every 30 seconds while this tab is open.</p>
        </div>
        {updated ? <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{updated}</span> : null}
      </div>
      {children}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParentChild } from "@/contexts/ParentChildContext";
import { usePortalNotifications } from "@/hooks/usePortalNotifications";
import { fetchChildLibraryHistory, type LibraryHistoryPage } from "@/lib/api/parent";
import { card, ChildSwitch, EmptyState, ErrorState, Frame, Pill, Skeletons } from "./shared";
import { formatMoney, formatShortDate, hasFine, historyOutcome, pageCount } from "./parentLibraryHelpers";

/** Library: History. Closed loans, newest first, twenty to a page. */
export default function ParentLibraryHistoryPage() {
  const { selectedChild, loading: ctxLoading } = useParentChild();
  const childId = selectedChild?.id ?? null;
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LibraryHistoryPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);

  // A different child starts again at page one.
  useEffect(() => {
    setPage(1);
  }, [childId]);

  const load = useCallback(async (quiet = false) => {
    if (childId === null) return;
    const ticket = ++latest.current;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await fetchChildLibraryHistory(childId, page, quiet);
      if (ticket === latest.current) setData(result);
    } catch (err) {
      if (ticket !== latest.current || quiet) return;
      if ((err as { status?: number }).status === 404 && page > 1) {
        setPage(1); // the history got shorter: go back to the first page
        return;
      }
      setError((err as { message?: string })?.message || "Could not load the library history.");
    } finally {
      if (ticket === latest.current && !quiet) setLoading(false);
    }
  }, [childId, page]);

  useEffect(() => {
    void load();
  }, [load]);

  usePortalNotifications(
    useCallback((n) => {
      if (n.kind === "library") void load(true);
    }, [load]),
  );

  const firstName = selectedChild?.name.split(" ")[0] ?? "your child";
  const pages = data ? pageCount(data.count) : 1;

  return (
    <Frame title="Library" accent="History" subtitle={`Books ${firstName} has already returned.`}>
      <ChildSwitch />
      {ctxLoading || loading ? (
        <Skeletons rows={5} h={68} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !selectedChild ? (
        <EmptyState title="No child linked to your account yet">Ask the school office to link your child to your account.</EmptyState>
      ) : data === null ? null : data.count === 0 ? (
        <EmptyState title="No returned books yet">Books {firstName} returns will be listed here.</EmptyState>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.results.map((loan) => {
              const outcome = historyOutcome(loan);
              return (
                <article key={loan.id} style={card}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-1)" }}>{loan.book_title}</div>
                      {loan.author ? <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{loan.author}</div> : null}
                    </div>
                    <Pill tone={outcome.tone}>{outcome.text}</Pill>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6 }}>
                    Borrowed {formatShortDate(loan.issue_date)}, was due {formatShortDate(loan.due_date)}
                    {hasFine(loan.fine_amount) ? <span style={{ color: "var(--warn)", fontWeight: 600 }}>. Fine {formatMoney(loan.fine_amount)}</span> : null}
                  </div>
                </article>
              );
            })}
          </div>
          <nav aria-label="Pages" style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 16, fontSize: 13, color: "var(--ink-2)", flexWrap: "wrap" }}>
            <span>{data.count} loan{data.count === 1 ? "" : "s"}</span>
            <button type="button" disabled={!data.previous} onClick={() => setPage((p) => Math.max(1, p - 1))} style={pagerButton(!data.previous)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button type="button" disabled={!data.next} onClick={() => setPage((p) => p + 1)} style={pagerButton(!data.next)}>Next</button>
          </nav>
        </>
      )}
    </Frame>
  );
}

function pagerButton(disabled: boolean) {
  return {
    border: "1px solid var(--bd-3)", background: "var(--bg-1)", color: "var(--ink-1)", borderRadius: 8, padding: "5px 14px", fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1,
  } as const;
}

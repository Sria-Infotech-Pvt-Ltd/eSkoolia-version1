"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortalNotifications } from "@/hooks/usePortalNotifications";
import { fetchLibraryMyBooks, libraryErrorMessage, renewLibraryLoan, type LibraryMyBooks } from "@/lib/api/teacher";
import { formatDate } from "@/components/library/issue-desk/deskHelpers";
import { Button, card, EmptyBox, ErrorBox, LoadingBlock, Notice, Page, Pill, td, th } from "./shared";
import { limitText, loanStatusText, STATE_TONE } from "./teacherLibraryHelpers";

/** My Books: the teacher's own loans. Renew when it is allowed, otherwise say why not. */
export function MyBooksPage() {
  const [data, setData] = useState<LibraryMyBooks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const latest = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const ticket = ++latest.current;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await fetchLibraryMyBooks(quiet);
      if (ticket === latest.current) setData(result);
    } catch (err) {
      if (ticket === latest.current && !quiet) setError(libraryErrorMessage(err, "Could not load your books."));
    } finally {
      if (ticket === latest.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  usePortalNotifications(
    useCallback((n) => {
      if (n.kind === "library") void load(true);
    }, [load]),
  );

  const renew = async (loanId: number, title: string) => {
    setBusy(loanId);
    setMessage(null);
    try {
      const result = await renewLibraryLoan(loanId);
      setMessage({ tone: "ok", text: `${title} renewed. It is now due ${formatDate(result.due_date)}.` });
    } catch (err) {
      // 409: it changed since the page loaded (someone placed a hold, or it went overdue). Say why and refresh.
      setMessage({ tone: "danger", text: libraryErrorMessage(err, "Could not renew this book.") });
    } finally {
      setBusy(null);
      await load(true);
    }
  };

  return (
    <Page title="Library: My Books" subtitle="Books you have borrowed">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBox message={error || "Could not load your books."} onRetry={() => void load()} />
      ) : !data.registered ? (
        <EmptyBox title="You are not registered with the library yet">
          Ask the librarian to register you. Once you have a library card your borrowed books will appear here.
        </EmptyBox>
      ) : (
        <>
          <div style={{ ...card, display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}>LIBRARY CARD</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)", fontFamily: "var(--font-mono)" }}>{data.card_no}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}>BORROWED</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--ink-1)" }}>{limitText(data.open_loans, data.borrowing_limit)}</div>
            </div>
            {data.is_active === false ? <Pill tone="warn">Your library card is switched off</Pill> : null}
          </div>
          {data.loans.length === 0 ? (
            <EmptyBox title="You have no books out">Borrow a book at the library desk and it will show up here.</EmptyBox>
          ) : (
            <div style={{ ...card, padding: 8, overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 620 }}>
                <thead>
                  <tr>
                    <th style={th}>Book</th>
                    <th style={th}>Due</th>
                    <th style={th}>Status</th>
                    <th style={th}>Renewals</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {data.loans.map((loan) => (
                    <tr key={loan.id}>
                      <td style={td}>
                        {loan.book_title}
                        {loan.author ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{loan.author}</div> : null}
                      </td>
                      <td style={td}>{formatDate(loan.due_date)}</td>
                      <td style={td}><Pill tone={STATE_TONE[loan.state]}>{loanStatusText(loan.state, loan.days_overdue)}</Pill></td>
                      <td style={td}>{loan.renew_count} of {loan.max_renewals}</td>
                      <td style={{ ...td, textAlign: "right" }}>
                        {loan.can_renew ? (
                          <Button small variant="primary" disabled={busy === loan.id} onClick={() => renew(loan.id, loan.book_title)}>
                            {busy === loan.id ? "Renewing..." : "Renew"}
                          </Button>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{loan.reason_text}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

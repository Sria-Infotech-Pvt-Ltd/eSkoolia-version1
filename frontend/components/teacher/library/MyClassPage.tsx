"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortalNotifications } from "@/hooks/usePortalNotifications";
import {
  fetchLibraryMyClass,
  libraryErrorCode,
  libraryErrorMessage,
  sendLibraryReminder,
  type LibraryMyClass,
} from "@/lib/api/teacher";
import { formatDate } from "@/components/library/issue-desk/deskHelpers";
import { Button, card, EmptyBox, ErrorBox, LoadingBlock, Notice, Page, Pill, td, th } from "./shared";
import { loanStatusText, nextSlotText, reminderAction, STATE_TONE } from "./teacherLibraryHelpers";

/** My Class: the next library period and the books the class has out. The class teacher can remind a family. */
export function MyClassPage() {
  const [data, setData] = useState<LibraryMyClass | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<number | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const latest = useRef(0);

  /** `quiet` is a background refresh: no skeleton, silent401, and a failure keeps what is on screen. */
  const load = useCallback(async (quiet = false) => {
    const ticket = ++latest.current;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await fetchLibraryMyClass(quiet);
      if (ticket !== latest.current) return;
      setData(result);
    } catch (err) {
      if (ticket === latest.current && !quiet) setError(libraryErrorMessage(err, "Could not load your class."));
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

  const remind = async (loanId: number, student: string) => {
    setBusy(loanId);
    setMessage(null);
    try {
      await sendLibraryReminder(loanId);
      setSent((current) => new Set(current).add(loanId));
      setMessage({ tone: "ok", text: `A reminder is on its way to the family of ${student}.` });
    } catch (err) {
      if (libraryErrorCode(err) === "library_reminder_already_sent") {
        setSent((current) => new Set(current).add(loanId));
        setMessage({ tone: "ok", text: "A reminder was already sent today for this book." });
      } else {
        setMessage({ tone: "danger", text: libraryErrorMessage(err, "Could not send the reminder.") });
      }
      await load(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Library: My Class" subtitle="Your class's next library period and the books they have out">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {loading ? (
        <LoadingBlock />
      ) : error || !data ? (
        <ErrorBox message={error || "Could not load your class."} onRetry={() => void load()} />
      ) : !data.has_class_scope ? (
        <EmptyBox title="You are not a class teacher this year">
          This page shows the classes you are the class teacher of. Ask the school office if you should be assigned one.
        </EmptyBox>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {data.classes.map((group) => (
            <section key={`${group.school_class}-${group.section}`} style={card} aria-label={`${group.class_name} ${group.section_name}`}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
                <h2 style={{ margin: 0, fontSize: 17, color: "var(--ink-1)" }}>{[group.class_name, group.section_name].filter(Boolean).join(" ")}</h2>
                <Pill tone={group.loan_count > 0 ? "info" : "neutral"}>{group.loan_count} book{group.loan_count === 1 ? "" : "s"} out</Pill>
              </div>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)" }}>
                <strong>Next library period:</strong> {nextSlotText(group.next_slot)}
              </p>
              {group.loans.length === 0 ? (
                <EmptyBox title="No books are out for this class" />
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                    <thead>
                      <tr>
                        <th style={th}>Student</th>
                        <th style={th}>Book</th>
                        <th style={th}>Due</th>
                        <th style={th}>Status</th>
                        <th style={th} />
                      </tr>
                    </thead>
                    <tbody>
                      {group.loans.map((loan) => {
                        const action = reminderAction(loan, sent.has(loan.id));
                        return (
                          <tr key={loan.id}>
                            <td style={td}>{loan.student_name}{!group.section ? <span style={{ color: "var(--ink-3)" }}> {loan.section_name}</span> : null}</td>
                            <td style={td}>
                              {loan.book_title}
                              <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{loan.copy_code}</div>
                            </td>
                            <td style={td}>{formatDate(loan.due_date)}</td>
                            <td style={td}><Pill tone={STATE_TONE[loan.state]}>{loanStatusText(loan.state, loan.days_overdue)}</Pill></td>
                            <td style={{ ...td, textAlign: "right" }}>
                              {action.kind === "none" ? (
                                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{action.text}</span>
                              ) : (
                                <Button small disabled={action.kind === "sent" || busy === loan.id} onClick={() => remind(loan.id, loan.student_name)}>
                                  {busy === loan.id ? "Sending..." : action.text}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {group.loan_count > group.loans.length ? (
                <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "10px 0 0" }}>Showing the first {group.loans.length} of {group.loan_count} loans, oldest due date first.</p>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </Page>
  );
}

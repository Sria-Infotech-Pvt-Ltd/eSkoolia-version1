"use client";

import { RefObject, useState } from "react";
import { lookupOpenLoans, returnLoan } from "@/hooks/useLibraryApi";
import type { CopyCondition, Loan, ReportType, ReturnResult } from "@/types/library";
import { Btn, Field, inputStyle, Pill } from "../catalogue/ui";
import {
  buildReturnInput,
  formatDate,
  hasFine,
  refusalMessage,
  returnActions,
  returnDraftError,
  type ReturnAction,
} from "./deskHelpers";
import { DeskSearch, SuggestionList, SuggestionRow } from "./DeskSearch";
import { OverdueNotice } from "./OverdueNotice";
import { resolveNow, useSuggest } from "./useSuggest";

interface Props {
  can: (code: string) => boolean;
  searchRef: RefObject<HTMLInputElement>;
  notify: (text: string, tone?: "ok" | "danger") => void;
  onActed: () => void;
  /** Tells the page a return happened so it can offer the undo toast. */
  onReturned: (loan: Loan, result: ReturnResult) => void;
}

const CONDITIONS: CopyCondition[] = ["new", "good", "fair", "worn", "damaged"];
const fetchLoans = (q: string, signal: AbortSignal) => lookupOpenLoans(q, { silent401: true, signal });

export function stateTone(loan: Loan): "ok" | "warn" | "danger" | "info" {
  return loan.state === "overdue" ? "danger" : loan.state === "due_today" ? "warn" : "ok";
}

export function LoanSummary({ loan }: { loan: Loan }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink-1)" }}>{loan.book_title}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", fontFamily: "var(--font-mono)" }}>{loan.copy_code || "No copy linked"}</div>
        </div>
        <Pill tone={stateTone(loan)}>{loan.state === "overdue" ? `${loan.days_overdue} days overdue` : loan.state === "due_today" ? "Due today" : "On time"}</Pill>
      </div>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px", margin: "10px 0 0", fontSize: 13 }}>
        <dt style={{ color: "var(--ink-3)" }}>Borrower</dt>
        <dd style={{ margin: 0 }}>
          {loan.member_name} <span style={{ color: "var(--ink-3)" }}>{loan.member_card_no}{loan.school_class ? ` · ${loan.school_class}${loan.section ? ` ${loan.section}` : ""}` : ""}</span>
        </dd>
        <dt style={{ color: "var(--ink-3)" }}>Issued</dt>
        <dd style={{ margin: 0 }}>{formatDate(loan.issue_date)}</dd>
        <dt style={{ color: "var(--ink-3)" }}>Due</dt>
        <dd style={{ margin: 0 }}>{formatDate(loan.due_date)}</dd>
        <dt style={{ color: "var(--ink-3)" }}>Renewed</dt>
        <dd style={{ margin: 0 }}>{loan.renew_count} time(s)</dd>
        <dt style={{ color: "var(--ink-3)" }}>Fine so far</dt>
        <dd style={{ margin: 0, fontWeight: 700, color: hasFine(loan) ? "var(--danger)" : "var(--ink-1)" }}>{loan.accrued_fine}</dd>
      </dl>
    </div>
  );
}

export function ReturnTab({ can, searchRef, notify, onActed, onReturned }: Props) {
  const canReturn = can("library.book_issues.return");
  const canWaive = can("library.book_issues.waive_fine");
  const [query, setQuery] = useState("");
  const [loan, setLoan] = useState<Loan | null>(null);
  const suggest = useSuggest(query, fetchLoans);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"ok" | ReportType>("ok");
  const [notes, setNotes] = useState("");
  const [condition, setCondition] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [waiving, setWaiving] = useState(false);
  const [result, setResult] = useState<{ loan: Loan; outcome: ReturnResult } | null>(null);
  const [notice, setNotice] = useState<Loan | null>(null);

  const refocus = () => setTimeout(() => searchRef.current?.focus(), 0);

  const choose = (picked: Loan) => {
    setLoan(picked);
    setQuery("");
    setProblem("");
    setResult(null);
    setMode("ok");
    setNotes("");
    setCondition("");
    setWaiveReason("");
    setWaiving(false);
  };

  const onSubmit = async (value: string) => {
    try {
      const rows = await resolveNow(fetchLoans, value);
      if (rows.length >= 1 && (rows.length === 1 || rows[0].copy_code.toLowerCase() === value.trim().toLowerCase())) choose(rows[0]);
      else if (rows.length === 0) setProblem("No open loan matches that code, title or borrower.");
    } catch {
      setProblem("Search is unavailable. Try again in a moment.");
    }
  };

  const submit = async (action: ReturnAction) => {
    if (!loan) return;
    const draft = { action, waiveReason, condition, report: mode === "ok" ? null : { type: mode, notes } };
    const invalid = returnDraftError(draft);
    if (invalid) {
      setProblem(invalid);
      return;
    }
    setBusy(true);
    setProblem("");
    try {
      const outcome = await returnLoan(loan.id, buildReturnInput(draft));
      setResult({ loan, outcome });
      onReturned(loan, outcome);
      notify(`Returned ${loan.book_title}`);
      setLoan(null);
      onActed();
      refocus();
    } catch (err) {
      setProblem(refusalMessage(err, "Could not return this book."));
      suggest.refresh();
    } finally {
      setBusy(false);
    }
  };

  const actions = loan ? returnActions(loan, canWaive) : [];
  const lost = mode === "lost";

  return (
    <div>
      <DeskSearch
        value={query}
        onChange={(v) => {
          setQuery(v);
          setProblem("");
        }}
        onSubmit={onSubmit}
        inputRef={searchRef}
        label="Find a loan to return"
        placeholder="Scan the copy code, or type a title or borrower"
        loading={suggest.loading}
      >
        {suggest.error ? <p role="alert" style={{ fontSize: 12, color: "var(--danger)", margin: 0 }}>{suggest.error}</p> : null}
        {suggest.items.length ? (
          <SuggestionList>
            {suggest.items.map((row) => (
              <SuggestionRow key={row.id} onPick={() => choose(row)}>
                <span>
                  <strong>{row.book_title}</strong>
                  <span style={{ color: "var(--ink-3)" }}> · {row.member_name} · {row.copy_code}</span>
                </span>
                <Pill tone={stateTone(row)}>{row.state === "overdue" ? "Overdue" : "Out"}</Pill>
              </SuggestionRow>
            ))}
          </SuggestionList>
        ) : query.trim().length >= 2 && !suggest.loading && !suggest.error ? (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>No open loan matches.</p>
        ) : null}
      </DeskSearch>

      {problem ? (
        <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "9px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {problem}
        </div>
      ) : null}

      {result ? (
        <section style={{ background: "var(--ok-soft)", borderRadius: 12, padding: 14, marginBottom: 12 }} aria-label="Returned">
          <strong style={{ color: "var(--ok)" }}>
            {result.outcome.loan.status === "lost" ? `${result.loan.book_title} recorded as lost` : `${result.loan.book_title} returned`}
          </strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 13, color: "var(--ink-1)" }}>
            {result.outcome.charge ? (
              <li>
                Fine {result.outcome.charge.amount} {result.outcome.charge.status === "paid" ? `collected (receipt ${result.outcome.charge.receipt_no})` : "waived"}.
              </li>
            ) : null}
            {result.outcome.report ? (
              <li>
                Recorded as {result.outcome.report.report_type}.
                {result.outcome.replacement_charge ? ` Replacement fee ${result.outcome.replacement_charge.amount} is pending.` : ""}
              </li>
            ) : null}
            {result.outcome.hold_queue_count > 0 ? (
              <li>
                {result.outcome.hold_queue_count} member(s) are waiting for this title: set it aside.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}

      {loan ? (
        <section style={{ border: "1px solid var(--bd)", borderRadius: 12, padding: 14, background: "var(--bg-1)" }} aria-label="Loan to return">
          <LoanSummary loan={loan} />
          {loan.state === "overdue" && can("library.book_issues.view") ? (
            <div style={{ marginTop: 8 }}>
              <Btn small variant="ghost" onClick={() => setNotice(loan)}>Print overdue notice</Btn>
            </div>
          ) : null}

          {canReturn ? (
            <div style={{ marginTop: 12 }}>
              <fieldset style={{ border: "none", padding: 0, margin: "0 0 10px" }}>
                <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>How is it coming back?</legend>
                {(
                  [
                    ["ok", "In order"],
                    ["damaged", "Damaged"],
                    ["lost", "Lost"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} style={{ marginRight: 14, fontSize: 13, color: "var(--ink-1)" }}>
                    <input type="radio" name="how" checked={mode === value} onChange={() => setMode(value)} /> {label}
                  </label>
                ))}
              </fieldset>
              {mode === "ok" ? (
                <Field label="Condition (optional)">
                  <select style={inputStyle} value={condition} onChange={(e) => setCondition(e.target.value)}>
                    <option value="">Leave as it was</option>
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              ) : (
                <Field label={`Note about the ${mode} copy`} hint="A replacement fee is billed to the borrower. Settings decide the amount.">
                  <input style={inputStyle} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              )}
              {lost && hasFine(loan) ? (
                <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "0 0 8px" }}>No overdue fine is charged for a lost book: the replacement fee covers it.</p>
              ) : null}
              {waiving && !lost ? (
                <Field label="Reason for waiving the fine *">
                  <input style={inputStyle} value={waiveReason} maxLength={500} autoFocus onChange={(e) => setWaiveReason(e.target.value)} />
                </Field>
              ) : null}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {lost ? (
                  <Btn variant="danger" disabled={busy} onClick={() => submit("return")}>
                    {busy ? "Saving..." : "Record as lost"}
                  </Btn>
                ) : (
                  actions.map((action) =>
                    action === "waive" ? (
                      <Btn
                        key={action}
                        disabled={busy}
                        onClick={() => {
                          if (!waiving) {
                            setWaiving(true);
                            return;
                          }
                          void submit("waive");
                        }}
                      >
                        {waiving ? "Confirm waive and return" : "Waive and return"}
                      </Btn>
                    ) : (
                      <Btn key={action} variant="primary" disabled={busy} onClick={() => submit(action)}>
                        {busy ? "Saving..." : action === "collect" ? `Collect ${loan.accrued_fine} and return` : mode === "damaged" ? "Return as damaged" : "Return"}
                      </Btn>
                    ),
                  )
                )}
              </div>
              {hasFine(loan) && !canWaive && !lost ? <p style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 0 }}>Waiving a fine needs the waive permission.</p> : null}
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>You can look up loans but not return books.</p>
          )}
        </section>
      ) : null}

      {notice ? <OverdueNotice memberId={notice.member} memberName={notice.member_name} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}

"use client";

import { RefObject, useEffect, useState } from "react";
import { getLibrarySettings, lookupOpenLoans, renewLoan } from "@/hooks/useLibraryApi";
import type { DueNote, Loan } from "@/types/library";
import { Btn, Pill } from "../catalogue/ui";
import { dueNoteText, knownRenewBlock, refusalMessage } from "./deskHelpers";
import { DeskSearch, SuggestionList, SuggestionRow } from "./DeskSearch";
import { LoanSummary, stateTone } from "./ReturnTab";
import { resolveNow, useSuggest } from "./useSuggest";

interface Props {
  can: (code: string) => boolean;
  searchRef: RefObject<HTMLInputElement>;
  notify: (text: string, tone?: "ok" | "danger") => void;
  onActed: () => void;
}

const fetchLoans = (q: string, signal: AbortSignal) => lookupOpenLoans(q, { silent401: true, signal });

export function RenewTab({ can, searchRef, notify, onActed }: Props) {
  const canRenew = can("library.book_issues.renew");
  const [query, setQuery] = useState("");
  const [loan, setLoan] = useState<Loan | null>(null);
  const suggest = useSuggest(query, fetchLoans);
  const [problem, setProblem] = useState("");
  const [renewed, setRenewed] = useState<{ title: string; due: DueNote; count: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [maxRenewals, setMaxRenewals] = useState<number | null>(null);

  useEffect(() => {
    // Only for the "x of y renewals" line. Without settings access the line just shows the count.
    getLibrarySettings({ silent401: true })
      .then((s) => setMaxRenewals(s.max_renewals))
      .catch(() => setMaxRenewals(null));
  }, []);

  const choose = (picked: Loan) => {
    setLoan(picked);
    setQuery("");
    setProblem("");
    setRenewed(null);
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

  const renew = async () => {
    if (!loan) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await renewLoan(loan.id);
      setRenewed({ title: loan.book_title, due: result.due, count: result.loan.renew_count });
      setLoan(result.loan);
      notify(`Renewed ${loan.book_title}`);
      onActed();
    } catch (err) {
      // The exact refusal (cap, waiting hold, overdue, already closed) is the answer: show it as it is.
      setProblem(refusalMessage(err, "Could not renew this loan."));
      suggest.refresh();
    } finally {
      setBusy(false);
    }
  };

  const block = loan ? knownRenewBlock(loan) : null;
  const atCap = loan && maxRenewals !== null && loan.renew_count >= maxRenewals;

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
        label="Find a loan to renew"
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
                <Pill tone={stateTone(row)}>{row.renew_count} renewal(s)</Pill>
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

      {renewed ? (
        <section style={{ background: "var(--ok-soft)", borderRadius: 12, padding: 14, marginBottom: 12 }} aria-label="Renewed">
          <strong style={{ color: "var(--ok)" }}>Renewed {renewed.title}</strong>
          <div style={{ fontSize: 13, color: "var(--ink-1)", marginTop: 4 }}>
            {dueNoteText(renewed.due)} Renewal {renewed.count}{maxRenewals !== null ? ` of ${maxRenewals}` : ""}.
          </div>
        </section>
      ) : null}

      {loan ? (
        <section style={{ border: "1px solid var(--bd)", borderRadius: 12, padding: 14, background: "var(--bg-1)" }} aria-label="Loan to renew">
          <LoanSummary loan={loan} />
          <p style={{ fontSize: 13, color: "var(--ink-2)", margin: "10px 0 0" }}>
            Renewals used: <strong>{loan.renew_count}{maxRenewals !== null ? ` of ${maxRenewals}` : ""}</strong>
          </p>
          {block ? <p role="alert" style={{ fontSize: 13, color: "var(--danger)", margin: "6px 0 0" }}>{block}</p> : null}
          {atCap && !block ? <p role="alert" style={{ fontSize: 13, color: "var(--danger)", margin: "6px 0 0" }}>Renewal limit reached ({maxRenewals} renewals).</p> : null}
          {canRenew ? (
            <div style={{ marginTop: 10 }}>
              <Btn variant="primary" onClick={renew} disabled={busy || Boolean(block) || Boolean(atCap)}>
                {busy ? "Renewing..." : "Renew"}
              </Btn>
            </div>
          ) : (
            <p style={{ fontSize: 12, color: "var(--ink-3)" }}>You can look up loans but not renew them.</p>
          )}
        </section>
      ) : null}
    </div>
  );
}

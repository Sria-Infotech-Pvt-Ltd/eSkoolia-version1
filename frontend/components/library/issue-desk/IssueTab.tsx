"use client";

import { RefObject, useCallback, useEffect, useMemo, useState } from "react";
import { bulkIssue, getMemberDues, issueBook, listEligibleMembers, listSchoolClasses, lookupBooks } from "@/hooks/useLibraryApi";
import type { BookLookupRow, BulkIssueResult, CopyBrief, EligibleMember, IssueResult, SchoolClassOption } from "@/types/library";
import { Btn, inputStyle, Pill, SkeletonRows, StateBox } from "../catalogue/ui";
import { blockReasonText, dueNoteText, refusalMessage } from "./deskHelpers";
import { DeskSearch, SuggestionList, SuggestionRow } from "./DeskSearch";
import { HoldsPanel } from "./HoldsPanel";
import { resolveNow, useSuggest } from "./useSuggest";

interface Props {
  can: (code: string) => boolean;
  searchRef: RefObject<HTMLInputElement>;
  notify: (text: string, tone?: "ok" | "danger") => void;
  /** Called after anything changed at the desk (refreshes the log). */
  onActed: () => void;
}

interface Target {
  book: BookLookupRow;
  copy: CopyBrief | null;
}

const fetchBooks = (q: string, signal: AbortSignal) => lookupBooks(q, 10, { silent401: true, signal });

export function IssueTab({ can, searchRef, notify, onActed }: Props) {
  const canIssue = can("library.book_issues.issue");
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const suggest = useSuggest(query, fetchBooks);

  const [classes, setClasses] = useState<SchoolClassOption[]>([]);
  const [group, setGroup] = useState("");
  const [roster, setRoster] = useState<EligibleMember[] | null>(null);
  const [rosterError, setRosterError] = useState("");
  const [rosterTick, setRosterTick] = useState(0);
  const [filter, setFilter] = useState("");
  const [member, setMember] = useState<EligibleMember | null>(null);
  const [amountDue, setAmountDue] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState<(IssueResult & { title: string; who: string }) | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPick, setBulkPick] = useState<Set<number>>(new Set());
  const [bulkResult, setBulkResult] = useState<BulkIssueResult | null>(null);

  useEffect(() => {
    listSchoolClasses({ silent401: true }).then(setClasses).catch(() => setClasses([]));
  }, []);

  const classId = group.startsWith("class:") ? Number(group.slice(6)) : null;

  useEffect(() => {
    if (!group) {
      setRoster(null);
      return;
    }
    let cancelled = false;
    setRosterError("");
    listEligibleMembers(
      {
        ...(classId ? { school_class: classId } : { member_type: group.slice(12) as "teacher" | "staff" }),
        ...(target ? { book: target.book.id } : {}),
        page_size: 500,
      },
      { silent401: true },
    )
      .then((page) => !cancelled && setRoster(page.results))
      .catch((err) => !cancelled && setRosterError(refusalMessage(err, "Could not load the roster.")));
    return () => {
      cancelled = true;
    };
  }, [group, classId, target, rosterTick]);

  // A blocked member is still selectable so the librarian can see why; the amount owed comes from the dues endpoint.
  useEffect(() => {
    setAmountDue(null);
    if (!member || member.reason !== "suspended") return;
    let cancelled = false;
    getMemberDues(member.id, { silent401: true })
      .then((dues) => !cancelled && setAmountDue((Number(dues.overdue_fines) + Number(dues.replacement_fees)).toFixed(2)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [member]);

  const pickBook = useCallback(
    (book: BookLookupRow) => {
      setTarget({ book, copy: book.matched_copy });
      setQuery("");
      setDone(null);
      setProblem("");
      setBulkResult(null);
    },
    [],
  );

  const onSubmit = async (value: string) => {
    // A scanner's Enter: resolve now instead of waiting for the debounce.
    try {
      const rows = await resolveNow(fetchBooks, value);
      if (rows.length === 1 || rows[0]?.matched_copy) pickBook(rows[0]);
      else if (rows.length === 0) setProblem("Nothing matches that code or title.");
    } catch {
      setProblem("Search is unavailable. Try again in a moment.");
    }
  };

  const refocus = () => setTimeout(() => searchRef.current?.focus(), 0);

  const issue = async () => {
    if (!target || !member) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await issueBook({ member: member.id, ...(target.copy ? { copy: target.copy.id } : { book: target.book.id }) });
      setDone({ ...result, title: target.book.title, who: member.display_name });
      notify(`Issued ${target.book.title} to ${member.display_name}`);
      setTarget(null);
      setMember(null);
      setRosterTick((n) => n + 1);
      onActed();
      refocus();
    } catch (err) {
      // 409 means the copy or the member changed under us: say why, and refresh the roster and suggestions.
      setProblem(refusalMessage(err, "Could not issue this book."));
      setRosterTick((n) => n + 1);
      suggest.refresh();
    } finally {
      setBusy(false);
    }
  };

  const eligibleRoster = useMemo(() => (roster ?? []).filter((m) => m.eligible), [roster]);
  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return (roster ?? []).filter((m) => !text || m.display_name.toLowerCase().includes(text) || m.card_no.toLowerCase().includes(text));
  }, [roster, filter]);

  const openBulk = () => {
    const limit = target?.book.copies_available ?? 0;
    setBulkPick(new Set(eligibleRoster.slice(0, limit).map((m) => m.id)));
    setBulkResult(null);
    setBulkOpen(true);
  };

  const runBulk = async () => {
    if (!target || !classId) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await bulkIssue({ book: target.book.id, school_class: classId, member_ids: [...bulkPick] });
      setBulkResult(result);
      notify(`Issued ${result.issued.length} book(s)`);
      setRosterTick((n) => n + 1);
      onActed();
    } catch (err) {
      setProblem(refusalMessage(err, "Could not issue to the class."));
    } finally {
      setBusy(false);
    }
  };

  const nameOf = (id: number) => roster?.find((m) => m.id === id)?.display_name ?? `Member ${id}`;
  const noCopies = target !== null && target.book.copies_available === 0;
  const blocked = member && !member.eligible ? blockReasonText(member.reason, { amountDue, limit: member.borrowing_limit, activeLoans: member.active_loans }) : "";

  return (
    <div>
      <DeskSearch
        value={query}
        onChange={(value) => {
          setQuery(value);
          setProblem("");
        }}
        onSubmit={onSubmit}
        inputRef={searchRef}
        label="Find a book"
        placeholder="Scan or type a copy code, title or author"
        loading={suggest.loading}
      >
        {suggest.error ? <p role="alert" style={{ fontSize: 12, color: "var(--danger)", margin: 0 }}>{suggest.error}</p> : null}
        {suggest.items.length ? (
          <SuggestionList>
            {suggest.items.map((book) => (
              <SuggestionRow key={book.id} onPick={() => pickBook(book)}>
                <span>
                  <strong>{book.title}</strong>
                  <span style={{ color: "var(--ink-3)" }}>
                    {book.author ? ` · ${book.author}` : ""} · {book.accession_code}
                    {book.matched_copy ? ` · copy ${book.matched_copy.code}` : ""}
                  </span>
                </span>
                {book.is_reference_only ? <Pill>Reference only</Pill> : book.copies_available > 0 ? <Pill tone="ok">{book.copies_available} available</Pill> : <Pill tone="danger">All issued</Pill>}
              </SuggestionRow>
            ))}
          </SuggestionList>
        ) : query.trim().length >= 2 && !suggest.loading && !suggest.error ? (
          <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>No titles match.</p>
        ) : null}
      </DeskSearch>

      {problem ? (
        <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "9px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {problem}
        </div>
      ) : null}

      {done ? (
        <section style={{ background: "var(--ok-soft)", borderRadius: 12, padding: 14, marginBottom: 12 }} aria-label="Issued">
          <strong style={{ color: "var(--ok)" }}>
            Issued {done.title} to {done.who}
          </strong>
          <div style={{ fontSize: 13, color: "var(--ink-1)", marginTop: 4 }}>
            Copy <code style={{ fontFamily: "var(--font-mono)" }}>{done.loan.copy_code}</code>. {dueNoteText(done.due)}
          </div>
        </section>
      ) : null}

      {target ? (
        <section style={{ border: "1px solid var(--bd)", borderRadius: 12, padding: 14, marginBottom: 12, background: "var(--bg-1)" }} aria-label="Selected book">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: "var(--ink-1)" }}>{target.book.title}</div>
              <div style={{ fontSize: 12, color: "var(--ink-3)" }}>
                {target.book.author ? `${target.book.author} · ` : ""}
                <span style={{ fontFamily: "var(--font-mono)" }}>{target.copy ? target.copy.code : target.book.accession_code}</span>
              </div>
            </div>
            <Btn small variant="ghost" onClick={() => { setTarget(null); setMember(null); refocus(); }}>
              Clear
            </Btn>
          </div>
          <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
            {target.book.is_reference_only ? <Pill tone="warn">Reference only: cannot be issued</Pill> : null}
            {target.copy && target.copy.status !== "available" ? <Pill tone="danger">This copy is {target.copy.status}</Pill> : null}
            <Pill tone={target.book.copies_available ? "ok" : "danger"}>{target.book.copies_available} of {target.book.copies_total} available</Pill>
          </div>
        </section>
      ) : null}

      {noCopies && target ? (
        <HoldsPanel
          bookId={target.book.id}
          bookTitle={target.book.title}
          member={member ? { id: member.id, name: member.display_name } : null}
          can={can}
          notify={notify}
          onChanged={onActed}
        />
      ) : null}

      <section style={{ marginTop: 14 }} aria-label="Who is borrowing">
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", display: "block", marginBottom: 4 }}>
          Who is borrowing?
          <select aria-label="Class or member group" style={{ ...inputStyle, marginTop: 4 }} value={group} onChange={(e) => { setGroup(e.target.value); setMember(null); setFilter(""); setBulkOpen(false); }}>
            <option value="">Choose a class, teachers or staff</option>
            {classes.map((c) => (
              <option key={c.id} value={`class:${c.id}`}>
                {c.name}
              </option>
            ))}
            <option value="member_type:teacher">Teachers</option>
            <option value="member_type:staff">Staff</option>
          </select>
        </label>
        {group ? (
          <>
            <input aria-label="Filter members" style={{ ...inputStyle, margin: "8px 0" }} placeholder="Filter by name or card" value={filter} onChange={(e) => setFilter(e.target.value)} />
            {!roster && !rosterError ? <SkeletonRows rows={4} columns={2} /> : null}
            {rosterError ? <StateBox tone="danger" title={rosterError}><Btn small onClick={() => setRosterTick((n) => n + 1)}>Retry</Btn></StateBox> : null}
            {roster && roster.length === 0 ? <StateBox title="No members here">Nobody in this group is registered as a library member yet.</StateBox> : null}
            {roster && roster.length ? (
              <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--bd)", borderRadius: 10 }}>
                {shown.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={member?.id === m.id}
                    onClick={() => setMember(m)}
                    style={{
                      display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 12px", border: "none",
                      borderBottom: "1px solid var(--bd)", cursor: "pointer", textAlign: "left", fontSize: 13, color: "var(--ink-1)",
                      background: member?.id === m.id ? "var(--pu-soft)" : "var(--bg-1)", opacity: m.eligible ? 1 : 0.75,
                    }}
                  >
                    <span>
                      <strong>{m.display_name}</strong>
                      <span style={{ color: "var(--ink-3)" }}> {m.card_no}{m.section ? ` · ${m.section}` : ""}</span>
                    </span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{m.active_loans} of {m.borrowing_limit}</span>
                      {m.eligible ? <Pill tone="ok">OK</Pill> : <Pill tone="danger">{m.reason === "suspended" ? "Suspended" : m.reason === "limit_reached" ? "At limit" : "Blocked"}</Pill>}
                    </span>
                  </button>
                ))}
                {shown.length === 0 ? <div style={{ padding: 12, fontSize: 13, color: "var(--ink-3)" }}>No member matches that filter.</div> : null}
              </div>
            ) : null}
          </>
        ) : null}
      </section>

      {member ? (
        <section style={{ marginTop: 12, padding: 14, borderRadius: 12, background: member.eligible ? "var(--bg-2)" : "var(--danger-soft)" }} aria-label="Confirm">
          <div style={{ fontSize: 13, color: "var(--ink-1)" }}>
            <strong>{member.display_name}</strong> ({member.card_no}) has {member.active_loans} of {member.borrowing_limit} books out.
          </div>
          {blocked ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginTop: 4 }}>{blocked}</div> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {canIssue ? (
              <Btn variant="primary" onClick={issue} disabled={busy || !target || !member.eligible || target.book.is_reference_only || noCopies}>
                {busy ? "Issuing..." : target ? `Issue to ${member.display_name}` : "Find a book first"}
              </Btn>
            ) : (
              <span style={{ fontSize: 12, color: "var(--ink-3)" }}>You can look up members but not issue books.</span>
            )}
            {canIssue && classId && target && !noCopies && !target.book.is_reference_only ? (
              <Btn onClick={openBulk} disabled={busy}>
                Issue to the whole class
              </Btn>
            ) : null}
          </div>
        </section>
      ) : canIssue && classId && target && !noCopies && !target.book.is_reference_only && roster ? (
        <div style={{ marginTop: 12 }}>
          <Btn onClick={openBulk} disabled={busy}>
            Issue to the whole class
          </Btn>
        </div>
      ) : null}

      {bulkOpen && target && classId ? (
        <section style={{ marginTop: 12, padding: 14, border: "1px solid var(--bd-2)", borderRadius: 12, background: "var(--bg-1)" }} aria-label="Bulk issue">
          <h3 style={{ margin: "0 0 4px", fontSize: 14, color: "var(--ink-1)" }}>Issue {target.book.title} to the class</h3>
          <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "0 0 8px" }}>
            Ticked members get a copy until the {target.book.copies_available} available copies run out. The server checks every member again.
          </p>
          {bulkResult ? (
            <div>
              <p style={{ fontSize: 13, color: "var(--ok)", margin: "0 0 6px" }}>Issued {bulkResult.issued.length}.</p>
              {bulkResult.skipped.length ? (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--danger)" }}>
                  {bulkResult.skipped.map((s) => (
                    <li key={s.member}>
                      {nameOf(s.member)}: {blockReasonText(s.reason)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div style={{ marginTop: 10 }}><Btn onClick={() => setBulkOpen(false)}>Close</Btn></div>
            </div>
          ) : (
            <>
              <div style={{ maxHeight: 220, overflowY: "auto" }}>
                {(roster ?? []).map((m) => (
                  <label key={m.id} style={{ display: "flex", gap: 8, padding: "4px 0", fontSize: 13, color: m.eligible ? "var(--ink-1)" : "var(--ink-3)" }}>
                    <input
                      type="checkbox"
                      disabled={!m.eligible}
                      checked={bulkPick.has(m.id)}
                      onChange={(e) => setBulkPick((prev) => { const next = new Set(prev); if (e.target.checked) next.add(m.id); else next.delete(m.id); return next; })}
                    />
                    <span>
                      {m.display_name}
                      {!m.eligible ? <span> ({blockReasonText(m.reason, { limit: m.borrowing_limit, activeLoans: m.active_loans })})</span> : null}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <Btn variant="primary" onClick={runBulk} disabled={busy || bulkPick.size === 0}>
                  {busy ? "Issuing..." : `Issue to ${bulkPick.size} member(s)`}
                </Btn>
                <Btn onClick={() => setBulkOpen(false)} disabled={busy}>Cancel</Btn>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

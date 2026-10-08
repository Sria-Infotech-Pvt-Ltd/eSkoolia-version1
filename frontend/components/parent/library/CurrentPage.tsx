"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParentChild } from "@/contexts/ParentChildContext";
import { usePortalNotifications } from "@/hooks/usePortalNotifications";
import { fetchChildLibraryCurrent, type LibraryCurrent } from "@/lib/api/parent";
import { card, ChildSwitch, EmptyState, ErrorState, Frame, Pill, Skeletons } from "./shared";
import {
  allowanceText,
  atLimit,
  dueText,
  formatMoney,
  hasFine,
  nextSlotText,
  REGISTRATION_TEXT,
  suspensionText,
} from "./parentLibraryHelpers";

/** Library: Current and Due. What the child has out, what is owed, and when the class next visits. */
export default function ParentLibraryCurrentPage() {
  const { selectedChild, loading: ctxLoading } = useParentChild();
  const childId = selectedChild?.id ?? null;
  const [data, setData] = useState<LibraryCurrent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);

  /** `quiet` is a push-triggered refresh: silent401, no skeleton, and a failure keeps what is on screen. */
  const load = useCallback(async (quiet = false) => {
    if (childId === null) return;
    const ticket = ++latest.current;
    if (!quiet) {
      setLoading(true);
      setError("");
      setData(null);
    }
    try {
      const result = await fetchChildLibraryCurrent(childId, quiet);
      if (ticket === latest.current) setData(result);
    } catch (err) {
      if (ticket === latest.current && !quiet) setError((err as { message?: string })?.message || "Could not load the library page.");
    } finally {
      if (ticket === latest.current && !quiet) setLoading(false);
    }
  }, [childId]);

  useEffect(() => {
    void load();
  }, [load]);

  usePortalNotifications(
    useCallback((n) => {
      if (n.kind === "library") void load(true);
    }, [load]),
  );

  const firstName = selectedChild?.name.split(" ")[0] ?? "your child";
  const busy = ctxLoading || loading;

  return (
    <Frame title="Library" accent="Current and Due" subtitle={`Books ${firstName} has borrowed, what is owed, and the next library period.`}>
      <ChildSwitch />
      {busy ? (
        <Skeletons />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : !selectedChild ? (
        <EmptyState title="No child linked to your account yet">Ask the school office to link your child to your account.</EmptyState>
      ) : data === null ? null : !data.registered ? (
        <>
          <NextPeriod text={nextSlotText(data.next_slot)} />
          <EmptyState title={`${firstName} is not registered with the library yet`}>
            The librarian registers each pupil and gives a library card. Once that is done, borrowed books will appear here.
          </EmptyState>
        </>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <NextPeriod text={nextSlotText(data.next_slot)} />

          {data.suspended ? (
            <div role="alert" style={{ background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 12, padding: "12px 16px", fontSize: 13, fontWeight: 600 }}>
              {suspensionText(data)}
            </div>
          ) : null}

          <div style={{ ...card, display: "flex", gap: 26, flexWrap: "wrap", alignItems: "center" }}>
            <Figure label="Borrowed" value={allowanceText(data.open_loans, data.loan_limit)} tone={atLimit(data.open_loans, data.loan_limit) ? "warn" : undefined} />
            <Figure label="Library card" value={data.card_no} mono />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", marginBottom: 4 }}>REGISTRATION</div>
              {data.registration.status ? (
                <Pill tone={REGISTRATION_TEXT[data.registration.status].tone}>
                  {REGISTRATION_TEXT[data.registration.status].label}
                  {data.registration.status === "unpaid" ? `: ${formatMoney(data.registration.amount)}` : ""}
                </Pill>
              ) : null}
            </div>
            {data.is_active === false ? <Pill tone="warn">Library card is switched off</Pill> : null}
          </div>

          {hasFine(data.replacement_fees.total) ? (
            <section style={card} aria-label="Replacement fees">
              <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "var(--ink-1)" }}>Replacement fees to pay</h2>
              {data.replacement_fees.items.map((fee, index) => (
                <div key={index} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13, color: "var(--ink-1)", padding: "4px 0" }}>
                  <span>{fee.book_title || "A lost or damaged book"}</span>
                  <strong style={{ color: "var(--warn)" }}>{formatMoney(fee.amount)}</strong>
                </div>
              ))}
              <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--ink-3)" }}>Please pay at the library office.</p>
            </section>
          ) : null}

          <section aria-label="Books borrowed">
            <h2 style={{ margin: "0 0 10px", fontSize: 15, color: "var(--ink-1)" }}>Books borrowed</h2>
            {data.loans.length === 0 ? (
              <EmptyState title={`${firstName} has no books out`}>Borrowed books and their due dates will appear here.</EmptyState>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {data.loans.map((loan) => {
                  const late = loan.state === "overdue";
                  return (
                    <article
                      key={loan.id}
                      style={{ ...card, borderColor: late ? "var(--warn)" : "var(--bd)", background: late ? "var(--warn-soft)" : "var(--bg-1)" }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--ink-1)" }}>{loan.book_title}</div>
                          {loan.author ? <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{loan.author}</div> : null}
                          <div style={{ fontSize: 11, color: "var(--ink-3)", fontFamily: "var(--font-mono)", marginTop: 2 }}>{loan.copy_code}</div>
                        </div>
                        <Pill tone={late ? "warn" : loan.state === "due_today" ? "warn" : "ok"}>{dueText(loan)}</Pill>
                      </div>
                      {hasFine(loan.accrued_fine) ? (
                        <div style={{ marginTop: 8, fontSize: 13, color: "var(--warn)", fontWeight: 600 }}>Fine so far: {formatMoney(loan.accrued_fine)}</div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </Frame>
  );
}

function NextPeriod({ text }: { text: string }) {
  return (
    <div style={{ ...card, background: "var(--pu-soft)", borderColor: "transparent" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--pu-deep)", marginBottom: 2 }}>NEXT LIBRARY PERIOD</div>
      <div style={{ fontSize: 14, color: "var(--ink-1)" }}>{text}</div>
    </div>
  );
}

function Figure({ label, value, tone, mono }: { label: string; value: string; tone?: "warn"; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)", marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 16, fontWeight: 600, color: tone === "warn" ? "var(--warn)" : "var(--ink-1)", fontFamily: mono ? "var(--font-mono)" : undefined }}>{value}</div>
    </div>
  );
}

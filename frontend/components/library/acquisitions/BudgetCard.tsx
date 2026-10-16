"use client";

import { useEffect, useState } from "react";
import { getAcquisitionsSummary, LibraryApiError, setBudget } from "@/hooks/useLibraryApi";
import type { AcquisitionsSummary } from "@/types/library";
import { Btn, Field, inputStyle, Modal, Pill, SkeletonRows, StateBox } from "../catalogue/ui";
import { refusalMessage } from "../issue-desk/deskHelpers";
import { formatMoney, isOverBudget, isValidAmount, spentPercent } from "./acquisitionsHelpers";
import { firstError, FormAlert } from "./parts";

/** The library budget for the current academic year: budget, committed, paid and what is left. */
export function BudgetCard({ canManage, refreshKey, onSaved }: { canManage: boolean; refreshKey: number; onSaved: (message: string) => void }) {
  const [summary, setSummary] = useState<AcquisitionsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [missingYear, setMissingYear] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError("");
    getAcquisitionsSummary(undefined, { silent401: true })
      .then((data) => {
        if (cancelled) return;
        setSummary(data);
        setMissingYear(false);
      })
      .catch((err) => {
        if (cancelled) return;
        if ((err as { status?: number }).status === 404) setMissingYear(true);
        else setError(refusalMessage(err, "Could not load the budget."));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tick]);

  if (loading) return <SkeletonRows rows={2} columns={4} />;
  if (missingYear) {
    return <StateBox title="No current academic year">Set a current academic year in the school setup, then come back to set the library budget.</StateBox>;
  }
  if (error || !summary) {
    return (
      <StateBox tone="danger" title="Could not load the budget">
        {error} <Btn small onClick={() => { setLoading(true); setTick((n) => n + 1); }}>Retry</Btn>
      </StateBox>
    );
  }

  const percent = spentPercent(summary);
  const over = isOverBudget(summary);
  const figures: [string, string, boolean?][] = [
    ["Budget", summary.has_budget ? formatMoney(summary.budget) : "Not set"],
    ["Committed", formatMoney(summary.committed)],
    ["Paid", formatMoney(summary.paid)],
    ["Remaining", formatMoney(summary.remaining), over],
  ];

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ fontWeight: 600, color: "var(--ink-1)" }}>
          Annual budget <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>{summary.academic_year_name}</span>
        </div>
        {canManage ? <Btn small onClick={() => setEditing(true)}>{summary.has_budget ? "Change budget" : "Set budget"}</Btn> : null}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
        {figures.map(([label, value, bad]) => (
          <div key={label}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-3)" }}>{label.toUpperCase()}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: bad ? "var(--danger)" : "var(--ink-1)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
          </div>
        ))}
      </div>
      <div
        role="progressbar"
        aria-label="Budget committed"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        style={{ height: 8, borderRadius: 999, background: "var(--bg-3)", marginTop: 14, overflow: "hidden" }}
      >
        <div style={{ width: `${percent}%`, height: "100%", background: over || percent >= 90 ? "var(--danger)" : "var(--pu)" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
        {summary.has_budget ? `${percent}% committed` : "Set a budget to track spending."}
        {over ? <Pill tone="danger">Over budget</Pill> : null}
      </div>
      <p style={{ fontSize: 11, color: "var(--ink-3)", margin: "8px 0 0" }}>Committed counts every purchase order that is not cancelled. Paid counts those marked paid.</p>
      {editing ? (
        <BudgetModal
          summary={summary}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setTick((n) => n + 1);
            onSaved("Budget saved");
          }}
        />
      ) : null}
    </div>
  );
}

function BudgetModal({ summary, onClose, onSaved }: { summary: AcquisitionsSummary; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(summary.has_budget ? summary.budget : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [fields, setFields] = useState<Record<string, string[]> | undefined>();
  const valid = isValidAmount(amount);

  const save = async () => {
    setBusy(true);
    setProblem("");
    setFields(undefined);
    try {
      await setBudget(summary.academic_year, amount.trim());
      onSaved();
    } catch (err) {
      setFields(err instanceof LibraryApiError ? err.fieldErrors : undefined);
      setProblem(refusalMessage(err, "Could not save the budget."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Budget for ${summary.academic_year_name}`}
      onClose={onClose}
      width={420}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={busy || !valid}>{busy ? "Saving..." : "Save budget"}</Btn>
        </>
      }
    >
      <FormAlert text={problem} />
      <Field label="Amount" error={firstError(fields, "amount") ?? (amount && !valid ? "Enter an amount such as 50000 or 50000.50." : undefined)}>
        <input style={inputStyle} inputMode="decimal" value={amount} autoFocus onChange={(e) => setAmount(e.target.value)} />
      </Field>
    </Modal>
  );
}

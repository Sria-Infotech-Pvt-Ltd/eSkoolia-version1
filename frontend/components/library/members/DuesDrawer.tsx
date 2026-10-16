"use client";

import { useCallback, useEffect, useState } from "react";
import { collectCharge, deleteMember, getMember, getMemberDues, updateMember, waiveCharge } from "@/hooks/useLibraryApi";
import type { MemberDetail, MemberDuesDetail } from "@/types/library";
import { Btn, ConfirmDialog, describeError, Field, inputStyle, Pill, SkeletonRows, StateBox } from "../catalogue/ui";
import { MEMBER_TYPE_LABEL, REGISTRATION_PILL, STANDING_PILL } from "./memberHelpers";

interface Props {
  memberId: number;
  can: (code: string) => boolean;
  onClose: () => void;
  onChanged: () => void;
  notify: (text: string, tone?: "ok" | "danger") => void;
}

const CHARGE_LABEL = { registration: "Registration fee", overdue_fine: "Overdue fine", replacement: "Replacement fee" } as const;

export function DuesDrawer({ memberId, can, onClose, onChanged, notify }: Props) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [dues, setDues] = useState<MemberDuesDetail | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiving, setWaiving] = useState<{ id: number; label: string } | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [detail, summary] = await Promise.all([getMember(memberId), getMemberDues(memberId)]);
      setMember(detail);
      setDues(summary);
    } catch (err) {
      setError(describeError(err, "Could not load this member."));
    }
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      notify(done);
      await load();
      onChanged();
    } catch (err) {
      // 409: another desk changed this charge first. Say so and show the current state.
      notify(describeError(err), "danger");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const confirmWaive = async () => {
    if (!waiving) return;
    if (!reason.trim()) {
      setReasonError("A reason is required.");
      return;
    }
    const target = waiving;
    setWaiving(null);
    await run(() => waiveCharge(target.id, reason.trim()), "Charge waived");
    setReason("");
  };

  const confirmDelete = async () => {
    if (!member) return;
    setBusy(true);
    setRemoveError("");
    try {
      await deleteMember(member.id);
      notify("Member deleted");
      onChanged();
      onClose();
    } catch (err) {
      setRemoveError(describeError(err, "Could not delete this member."));
    } finally {
      setBusy(false);
    }
  };

  const standing = member ? STANDING_PILL[member.standing] : null;
  const registration = member ? REGISTRATION_PILL[member.registration_status] : null;

  return (
    <>
      <div
        role="dialog"
        aria-label="Member dues"
        style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: "min(440px, 100vw)", background: "var(--bg-1)", boxShadow: "var(--sh-bot)", borderLeft: "1px solid var(--bd)", zIndex: 1000, overflowY: "auto", padding: 20 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: "var(--ink-1)" }}>{member ? member.display_name : "Member"}</h2>
          <Btn variant="ghost" small onClick={onClose}>
            Close
          </Btn>
        </div>
        {error ? <StateBox tone="danger" title="Could not load this member">{error} <Btn small onClick={load}>Retry</Btn></StateBox> : null}
        {!member && !error ? <SkeletonRows rows={5} columns={2} /> : null}
        {member && dues && standing && registration ? (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 13, color: "var(--ink-2)" }}>
              <Pill tone="brand">{MEMBER_TYPE_LABEL[member.member_type]}</Pill>
              <Pill tone={standing.tone}>{standing.label}</Pill>
              {!member.is_active ? <Pill>Inactive</Pill> : null}
              <span style={{ fontFamily: "var(--font-mono)" }}>{member.card_no}</span>
              {member.school_class ? <span>{member.school_class}{member.section ? ` ${member.section}` : ""}</span> : null}
            </div>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--ink-2)" }}>
              {member.active_loans} of {member.borrowing_limit} books out.
            </p>

            <h3 style={{ margin: "0 0 6px", fontSize: 13, color: "var(--ink-3)" }}>DUES</h3>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "4px 10px", margin: "0 0 8px", fontSize: 13 }}>
              <dt>Overdue fines</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>{dues.overdue_fines}</dd>
              <dt>Replacement fees</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>{dues.replacement_fees}</dd>
              <dt>
                Registration fee <Pill tone={registration.tone}>{registration.label}</Pill>
              </dt>
              <dd style={{ margin: 0, textAlign: "right" }}>{dues.registration_due}</dd>
              <dt style={{ fontWeight: 700 }}>Total owed</dt>
              <dd style={{ margin: 0, textAlign: "right", fontWeight: 700 }}>{dues.total}</dd>
            </dl>
            {dues.suspended ? (
              <p style={{ fontSize: 12, color: "var(--danger)", margin: "0 0 10px" }}>Borrowing is blocked until the fines and replacement fees are settled. An unpaid registration fee does not block borrowing.</p>
            ) : null}

            {dues.pending_charges.length ? (
              <>
                <h3 style={{ margin: "10px 0 6px", fontSize: 13, color: "var(--ink-3)" }}>PENDING CHARGES</h3>
                {dues.pending_charges.map((charge) => (
                  <div key={charge.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--bd)", fontSize: 13 }}>
                    <span>
                      {CHARGE_LABEL[charge.charge_type]}: <strong>{charge.amount}</strong>
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      {can("library.charges.collect") ? (
                        <Btn small variant="primary" disabled={busy} onClick={() => run(() => collectCharge(charge.id), "Collected. Receipt recorded.")}>
                          Collect
                        </Btn>
                      ) : null}{" "}
                      {can("library.charges.waive") ? (
                        <Btn small disabled={busy} onClick={() => { setReason(""); setReasonError(""); setWaiving({ id: charge.id, label: CHARGE_LABEL[charge.charge_type] }); }}>
                          Waive
                        </Btn>
                      ) : null}
                    </span>
                  </div>
                ))}
              </>
            ) : null}

            <h3 style={{ margin: "14px 0 6px", fontSize: 13, color: "var(--ink-3)" }}>BOOKS OUT</h3>
            {member.open_loans.length === 0 ? <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>No books out.</p> : null}
            {member.open_loans.map((loan) => (
              <div key={loan.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid var(--bd)", fontSize: 13 }}>
                <span>
                  {loan.title}
                  <span style={{ color: "var(--ink-3)" }}> due {loan.due_date}</span>
                </span>
                {loan.days_overdue > 0 ? <Pill tone="danger">{loan.days_overdue}d late, fine {loan.accrued_fine}</Pill> : <Pill tone="ok">On time</Pill>}
              </div>
            ))}

            {can("library.library_members.update") || can("library.library_members.delete") ? (
              <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                {can("library.library_members.update") ? (
                  <Btn disabled={busy} onClick={() => run(() => updateMember(member.id, { is_active: !member.is_active }), member.is_active ? "Member deactivated" : "Member reactivated")}>
                    {member.is_active ? "Deactivate" : "Reactivate"}
                  </Btn>
                ) : null}
                {can("library.library_members.delete") ? (
                  <Btn variant="danger" disabled={busy} onClick={() => { setRemoveError(""); setRemoving(true); }}>
                    Delete
                  </Btn>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {waiving ? (
        <ConfirmDialog title="Waive charge" message={`Waive this ${waiving.label.toLowerCase()}? The reason is kept on the charge and in the activity log.`} confirmLabel="Waive" onConfirm={confirmWaive} onCancel={() => setWaiving(null)}>
          <Field label="Reason *" error={reasonError}>
            <input style={inputStyle} value={reason} maxLength={500} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(""); }} />
          </Field>
        </ConfirmDialog>
      ) : null}
      {removing ? (
        <ConfirmDialog title="Delete member" message="Delete this member? A member with loans or charges cannot be deleted. Deactivate them instead." confirmLabel="Delete" busy={busy} onConfirm={confirmDelete} onCancel={() => setRemoving(false)}>
          {removeError ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{removeError}</div> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

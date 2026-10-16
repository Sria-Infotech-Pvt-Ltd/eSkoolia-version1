"use client";

import { useEffect, useState } from "react";
import { createMember, listMemberCandidates } from "@/hooks/useLibraryApi";
import type { MemberCandidate, MemberType } from "@/types/library";
import { Btn, describeError, Field, fieldMessages, inputStyle, Modal, Pill, SkeletonRows } from "../catalogue/ui";
import { MEMBER_TYPE_LABEL, registerFormError, toMemberInput, type RegisterForm } from "./memberHelpers";

interface Props {
  canCollect: boolean;
  onClose: () => void;
  onRegistered: (name: string) => void;
}

const TYPES: MemberType[] = ["student", "teacher", "staff"];

export function RegisterMemberModal({ canCollect, onClose, onRegistered }: Props) {
  const [type, setType] = useState<MemberType>("student");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [candidates, setCandidates] = useState<MemberCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [chosen, setChosen] = useState<MemberCandidate | null>(null);
  const [fee, setFee] = useState("");
  const [cardNo, setCardNo] = useState("");
  const [collectNow, setCollectNow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(query), 250);
    return () => clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    listMemberCandidates(type, debounced.trim(), { silent401: true })
      .then((rows) => !cancelled && setCandidates(rows))
      .catch((err) => !cancelled && setLoadError(describeError(err, "Could not load people.")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [type, debounced, refresh]);

  const switchType = (next: MemberType) => {
    setType(next);
    setChosen(null);
    setFee("");
    setErrors({});
    setBanner("");
  };

  const choose = (candidate: MemberCandidate) => {
    setChosen(candidate);
    setFee(candidate.suggested_fee);
    setErrors({});
  };

  const submit = async () => {
    const form: RegisterForm = { type, personId: chosen?.id ?? null, fee, cardNo, collectNow };
    const problem = registerFormError(form);
    if (problem) {
      setBanner(problem);
      return;
    }
    setSaving(true);
    setBanner("");
    setErrors({});
    try {
      await createMember(toMemberInput(form));
      onRegistered(chosen?.name ?? "Member");
    } catch (err) {
      const fields = fieldMessages(err);
      setErrors(fields);
      // The list may have changed under us (someone else registered this person): refresh it.
      if (fields.student || fields.staff) setRefresh((n) => n + 1);
      setBanner(Object.keys(fields).length ? "" : describeError(err, "Could not register this member."));
    } finally {
      setSaving(false);
    }
  };

  const zeroFee = chosen !== null && fee.trim() !== "" && Number(fee) === 0;

  return (
    <Modal
      title="Register member"
      onClose={onClose}
      width={680}
      footer={
        <>
          <Btn onClick={onClose} disabled={saving}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={submit} disabled={saving || !chosen}>
            {saving ? "Registering..." : "Register"}
          </Btn>
        </>
      }
    >
      <div role="tablist" aria-label="Member type" style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {TYPES.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={type === t}
            onClick={() => switchType(t)}
            style={{
              padding: "6px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 600,
              border: "1px solid var(--bd-3)",
              background: type === t ? "var(--pu)" : "var(--bg-1)",
              color: type === t ? "var(--bg-1)" : "var(--ink-1)",
            }}
          >
            {MEMBER_TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      {banner ? (
        <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>
          {banner}
        </div>
      ) : null}
      {!chosen ? (
        <>
          <input
            aria-label="Search people"
            style={inputStyle}
            placeholder={type === "student" ? "Search by name or admission number" : "Search by name or staff number"}
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div style={{ marginTop: 10, maxHeight: 280, overflowY: "auto", border: "1px solid var(--bd)", borderRadius: 8 }}>
            {loading ? <SkeletonRows rows={4} columns={2} /> : null}
            {loadError ? <div role="alert" style={{ padding: 14, color: "var(--danger)", fontSize: 13 }}>{loadError}</div> : null}
            {!loading && !loadError && candidates.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", color: "var(--ink-3)", fontSize: 13 }}>
                No {MEMBER_TYPE_LABEL[type].toLowerCase()}s to register. Everyone matching is already a member.
              </div>
            ) : null}
            {!loading
              ? candidates.map((candidate) => (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => choose(candidate)}
                    style={{ display: "flex", width: "100%", justifyContent: "space-between", padding: "9px 12px", border: "none", borderBottom: "1px solid var(--bd)", background: "var(--bg-1)", cursor: "pointer", textAlign: "left", color: "var(--ink-1)" }}
                  >
                    <span>
                      <strong style={{ fontSize: 13 }}>{candidate.name}</strong>
                      <span style={{ marginLeft: 8, fontSize: 12, color: "var(--ink-3)" }}>
                        {candidate.identifier}
                        {candidate.school_class ? ` · ${candidate.school_class}${candidate.section ? ` ${candidate.section}` : ""}` : ""}
                      </span>
                    </span>
                    {type === "student" ? <Pill tone="brand">Fee {candidate.suggested_fee}</Pill> : null}
                  </button>
                ))
              : null}
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", background: "var(--bg-2)", borderRadius: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>
              <strong>{chosen.name}</strong> <span style={{ color: "var(--ink-3)" }}>{chosen.identifier}</span>
            </span>
            <Btn small variant="ghost" onClick={() => setChosen(null)}>
              Change
            </Btn>
          </div>
          {errors.student || errors.staff || errors.member_type ? (
            <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 8 }}>
              {errors.student ?? errors.staff ?? errors.member_type}
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Registration fee" error={errors.registration_fee_amount} hint={zeroFee ? "A fee of 0 is recorded as waived." : "Pre-filled from the school's fee rules. You can edit it."}>
              <input style={inputStyle} value={fee} inputMode="decimal" onChange={(e) => setFee(e.target.value)} />
            </Field>
            <Field label="Card number" error={errors.card_no} hint="Leave blank to generate one.">
              <input style={inputStyle} value={cardNo} maxLength={40} onChange={(e) => setCardNo(e.target.value)} />
            </Field>
          </div>
          {canCollect && !zeroFee ? (
            <label style={{ fontSize: 13, color: "var(--ink-1)" }}>
              <input type="checkbox" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} /> Fee collected now (records a receipt)
            </label>
          ) : null}
        </>
      )}
    </Modal>
  );
}

"use client";

import { useState } from "react";
import { createReport, getCopyByCode } from "@/hooks/useLibraryApi";
import type { BookCopy, ReportType } from "@/types/library";
import { Btn, Field, inputStyle, Modal, Pill } from "../catalogue/ui";
import { refusalMessage } from "../issue-desk/deskHelpers";

interface Props {
  canFindCopy: boolean;
  onClose: () => void;
  onCreated: (message: string) => void;
}

/** Report a copy lost or damaged on the shelf. A copy that is out on loan is reported through the Return tab. */
export function ReportCopyModal({ canFindCopy, onClose, onCreated }: Props) {
  const [code, setCode] = useState("");
  const [copy, setCopy] = useState<BookCopy | null>(null);
  const [type, setType] = useState<ReportType>("lost");
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const find = async () => {
    setProblem("");
    setCopy(null);
    try {
      setCopy(await getCopyByCode(code.trim()));
    } catch (err) {
      setProblem(refusalMessage(err, "No copy has that code."));
    }
  };

  const save = async () => {
    if (!copy) return;
    setBusy(true);
    setProblem("");
    try {
      const row = await createReport({ copy: copy.id, report_type: type, notes: notes.trim() });
      onCreated(row.resolution === "pending" ? `Reported ${copy.code} as ${type}` : "Report saved");
    } catch (err) {
      setProblem(refusalMessage(err, "Could not save the report."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Report a lost or damaged copy"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={busy || !copy}>
            {busy ? "Saving..." : "Save report"}
          </Btn>
        </>
      }
    >
      {problem ? <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{problem}</div> : null}
      {canFindCopy ? (
        <Field label="Copy code" hint="For example LIB-FIC-0001/C1. Scan it or type it, then press Enter.">
          <input
            style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
            value={code}
            autoFocus
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void find();
              }
            }}
          />
        </Field>
      ) : (
        <p style={{ fontSize: 13, color: "var(--ink-3)" }}>Looking up a copy needs the copies view permission.</p>
      )}
      {copy ? (
        <>
          <div style={{ padding: "8px 12px", background: "var(--bg-2)", borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
            <strong>{copy.book_title}</strong> <Pill>{copy.status}</Pill>
          </div>
          <div style={{ marginBottom: 10 }}>
            {(["lost", "damaged"] as const).map((t) => (
              <label key={t} style={{ marginRight: 14, fontSize: 13, color: "var(--ink-1)" }}>
                <input type="radio" name="kind" checked={type === t} onChange={() => setType(t)} /> {t === "lost" ? "Lost" : "Damaged"}
              </label>
            ))}
          </div>
          <Field label="Note">
            <input style={inputStyle} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <p style={{ fontSize: 12, color: "var(--ink-3)", margin: 0 }}>No one is billed for a report made here. To bill a borrower, return their loan with the lost or damaged option.</p>
        </>
      ) : null}
    </Modal>
  );
}

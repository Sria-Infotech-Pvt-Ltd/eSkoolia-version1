"use client";

import { useEffect, useState } from "react";
import { listLoans } from "@/hooks/useLibraryApi";
import { useDocumentBranding } from "@/hooks/useDocumentBranding";
import type { Loan } from "@/types/library";
import { Btn, Modal, SkeletonRows, StateBox, tdStyle, thStyle } from "../catalogue/ui";
import { formatDate, refusalMessage } from "./deskHelpers";
import { DOCUMENT_PRINT_CSS } from "./printStyles";

interface Props {
  memberId: number;
  memberName: string;
  onClose: () => void;
}

/** Printable notice listing a member's overdue books with the fine accrued so far. */
export function OverdueNotice({ memberId, memberName, onClose }: Props) {
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [error, setError] = useState("");
  // The branding hook needs a document type; the notice uses only the school header image.
  const { headerImageDataUrl } = useDocumentBranding("student_verification");

  useEffect(() => {
    let cancelled = false;
    listLoans({ member: memberId, state: "overdue", page_size: 100, ordering: "due_date" })
      .then((page) => !cancelled && setLoans(page.results))
      .catch((err) => !cancelled && setError(refusalMessage(err, "Could not load the overdue books.")));
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  const total = (loans ?? []).reduce((sum, loan) => sum + Number(loan.accrued_fine), 0).toFixed(2);

  return (
    <Modal
      title="Overdue notice"
      onClose={onClose}
      width={760}
      footer={
        <>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" disabled={!loans || loans.length === 0} onClick={() => window.print()}>
            Print
          </Btn>
        </>
      }
    >
      <style>{DOCUMENT_PRINT_CSS}</style>
      {!loans && !error ? <SkeletonRows rows={3} columns={4} /> : null}
      {error ? <StateBox tone="danger" title="Could not load the notice">{error}</StateBox> : null}
      {loans && loans.length === 0 ? <StateBox title="Nothing is overdue for this member" /> : null}
      {loans && loans.length ? (
        <div className="lib-print-sheet" style={{ color: "var(--ink-1)", background: "var(--bg-1)", padding: 8 }}>
          {headerImageDataUrl ? (
            // Data URL from the school's document branding; next/image cannot optimise it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerImageDataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 80, display: "block", marginBottom: 10 }} />
          ) : null}
          <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Overdue library books</h2>
          <p style={{ margin: "0 0 12px", fontSize: 13 }}>
            To {memberName}{loans[0].member_card_no ? ` (card ${loans[0].member_card_no})` : ""}
            {loans[0].school_class ? `, ${loans[0].school_class}${loans[0].section ? ` ${loans[0].section}` : ""}` : ""}. The books below are past their due date. Please return them to the library as soon as possible.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Title</th>
                <th style={thStyle}>Copy</th>
                <th style={thStyle}>Due</th>
                <th style={thStyle}>Days late</th>
                <th style={thStyle}>Fine so far</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => (
                <tr key={loan.id}>
                  <td style={tdStyle}>{loan.book_title}</td>
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}>{loan.copy_code}</td>
                  <td style={tdStyle}>{formatDate(loan.due_date)}</td>
                  <td style={tdStyle}>{loan.days_overdue}</td>
                  <td style={tdStyle}>{loan.accrued_fine}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: "10px 0 0", fontSize: 14, fontWeight: 700 }}>Total fine so far: {total}</p>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-3)" }}>The fine grows each day until the books are returned.</p>
        </div>
      ) : null}
    </Modal>
  );
}

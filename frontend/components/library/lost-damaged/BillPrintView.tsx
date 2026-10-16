"use client";

import { useEffect, useState } from "react";
import { getReportBill } from "@/hooks/useLibraryApi";
import { useDocumentBranding } from "@/hooks/useDocumentBranding";
import type { ReportBill } from "@/types/library";
import { Btn, Modal, SkeletonRows, StateBox } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { DOCUMENT_PRINT_CSS } from "../issue-desk/printStyles";

const STATUS_TEXT: Record<string, string> = {
  pending: "Unpaid",
  paid: "Paid",
  waived: "Waived",
  written_off: "Written off",
  none: "No fee",
};

/** Printable replacement bill for one lost or damaged copy. */
export function BillPrintView({ reportId, onClose }: { reportId: number; onClose: () => void }) {
  const [bill, setBill] = useState<ReportBill | null>(null);
  const [error, setError] = useState("");
  // The branding hook needs a document type; the bill uses only the school header image.
  const { headerImageDataUrl } = useDocumentBranding("student_verification");

  useEffect(() => {
    let cancelled = false;
    getReportBill(reportId)
      .then((data) => !cancelled && setBill(data))
      .catch((err) => !cancelled && setError(refusalMessage(err, "Could not load the bill.")));
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  return (
    <Modal
      title="Replacement bill"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" disabled={!bill} onClick={() => window.print()}>
            Print
          </Btn>
        </>
      }
    >
      <style>{DOCUMENT_PRINT_CSS}</style>
      {!bill && !error ? <SkeletonRows rows={4} columns={2} /> : null}
      {error ? <StateBox tone="danger" title="Could not load the bill">{error}</StateBox> : null}
      {bill ? (
        <div className="lib-print-sheet" style={{ color: "var(--ink-1)", background: "var(--bg-1)", padding: 8 }}>
          {headerImageDataUrl ? (
            // Data URL from the school's document branding; next/image cannot optimise it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerImageDataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 80, display: "block", marginBottom: 10 }} />
          ) : null}
          <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Library replacement bill</h2>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-3)" }}>Bill no. {bill.report_id} · {formatDate(bill.reported_on)}</p>
          <dl style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: "6px 12px", margin: 0, fontSize: 14 }}>
            <dt>Billed to</dt>
            <dd style={{ margin: 0 }}>{bill.member_name ? `${bill.member_name} (card ${bill.card_no})` : "Not billed to a member"}</dd>
            <dt>Book</dt>
            <dd style={{ margin: 0 }}>{bill.title}</dd>
            <dt>Copy</dt>
            <dd style={{ margin: 0, fontFamily: "var(--font-mono)" }}>{bill.copy_code}</dd>
            <dt>Reason</dt>
            <dd style={{ margin: 0 }}>{bill.report_type === "lost" ? "Lost" : "Damaged"}{bill.notes ? `: ${bill.notes}` : ""}</dd>
            <dt>Replacement cost</dt>
            <dd style={{ margin: 0, fontWeight: 700 }}>{bill.replacement_cost}</dd>
            <dt>Status</dt>
            <dd style={{ margin: 0 }}>
              {STATUS_TEXT[bill.charge_status] ?? bill.charge_status}
              {bill.receipt_no ? ` (receipt ${bill.receipt_no})` : ""}
            </dd>
          </dl>
          <p style={{ margin: "14px 0 0", fontSize: 12, color: "var(--ink-3)" }}>Please pay this amount at the library office. Quote the bill number.</p>
        </div>
      ) : null}
    </Modal>
  );
}

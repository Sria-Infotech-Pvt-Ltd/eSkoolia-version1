"use client";

import { useEffect, useState } from "react";
import { getDonationReceipt } from "@/hooks/useLibraryApi";
import { useDocumentBranding } from "@/hooks/useDocumentBranding";
import type { DonationReceipt } from "@/types/library";
import { Btn, Modal, SkeletonRows, StateBox } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { DOCUMENT_PRINT_CSS } from "../issue-desk/printStyles";
import { DONOR_TYPE_LABEL, formatMoney } from "./acquisitionsHelpers";

/** Printable acknowledgement for one donation. The donor's contact is left off the paper on purpose. */
export function ReceiptPrintView({ donationId, onClose }: { donationId: number; onClose: () => void }) {
  const [receipt, setReceipt] = useState<DonationReceipt | null>(null);
  const [error, setError] = useState("");
  // The branding hook needs a document type; the receipt uses only the school header image.
  const { headerImageDataUrl } = useDocumentBranding("student_verification");

  useEffect(() => {
    let cancelled = false;
    getDonationReceipt(donationId)
      .then((data) => !cancelled && setReceipt(data))
      .catch((err) => !cancelled && setError(refusalMessage(err, "Could not load the receipt.")));
    return () => {
      cancelled = true;
    };
  }, [donationId]);

  return (
    <Modal
      title="Donation receipt"
      onClose={onClose}
      width={640}
      footer={
        <>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" disabled={!receipt} onClick={() => window.print()}>Print</Btn>
        </>
      }
    >
      <style>{DOCUMENT_PRINT_CSS}</style>
      {!receipt && !error ? <SkeletonRows rows={4} columns={2} /> : null}
      {error ? <StateBox tone="danger" title="Could not load the receipt">{error}</StateBox> : null}
      {receipt ? (
        <div className="lib-print-sheet" style={{ color: "var(--ink-1)", background: "var(--bg-1)", padding: 8 }}>
          {headerImageDataUrl ? (
            // Data URL from the school's document branding; next/image cannot optimise it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={headerImageDataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 80, display: "block", marginBottom: 10 }} />
          ) : null}
          <h2 style={{ margin: "0 0 4px", fontSize: 18 }}>Library donation receipt</h2>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--ink-3)" }}>Receipt no. {receipt.receipt_no} · {formatDate(receipt.donation_date)}</p>
          <dl style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: "6px 12px", margin: 0, fontSize: 14 }}>
            <dt>Received from</dt>
            <dd style={{ margin: 0 }}>{receipt.donor_name} ({DONOR_TYPE_LABEL[receipt.donor_type]})</dd>
            <dt>Number of books</dt>
            <dd style={{ margin: 0 }}>{receipt.books_count}</dd>
            <dt>Estimated value</dt>
            <dd style={{ margin: 0, fontWeight: 700 }}>{formatMoney(receipt.estimated_value)}</dd>
            {receipt.notes ? (
              <>
                <dt>Notes</dt>
                <dd style={{ margin: 0 }}>{receipt.notes}</dd>
              </>
            ) : null}
          </dl>
          <p style={{ margin: "14px 0 0", fontSize: 13 }}>
            {receipt.school_name ? `${receipt.school_name} thanks you` : "Thank you"} for this generous gift to the library.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

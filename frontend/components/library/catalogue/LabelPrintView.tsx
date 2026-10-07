"use client";

import { useEffect, useState } from "react";
import { getBookLabels } from "@/hooks/useLibraryApi";
import { useDocumentBranding } from "@/hooks/useDocumentBranding";
import type { BookLabels } from "@/types/library";
import { code39Bars, isEncodable } from "./code39";
import { Btn, describeError, Modal, SkeletonRows, StateBox } from "./ui";

interface Props {
  bookId: number;
  copyId?: number;
  onClose: () => void;
}

/** Scannable Code 39 barcode as inline SVG. Falls back to plain text for a code Code 39 cannot carry. */
export function Barcode({ value }: { value: string }) {
  if (!isEncodable(value)) return null;
  const { bars, width } = code39Bars(value);
  const quiet = 10;
  return (
    <svg
      role="img"
      aria-label={`Barcode ${value}`}
      viewBox={`0 0 ${width + quiet * 2} 40`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 34, display: "block" }}
    >
      {bars.map((bar) => (
        <rect key={bar.x} x={bar.x + quiet} y={0} width={bar.width} height={40} fill="currentColor" />
      ))}
    </svg>
  );
}

// Everything except the label sheet is hidden while printing.
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .lib-label-sheet, .lib-label-sheet * { visibility: visible !important; }
  .lib-label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  .lib-label { break-inside: avoid; }
  .lib-no-print { display: none !important; }
}
`;

export function LabelPrintView({ bookId, copyId, onClose }: Props) {
  const [labels, setLabels] = useState<BookLabels | null>(null);
  const [error, setError] = useState("");
  // The branding hook needs a document type; labels only use the school header image, not the declaration text.
  const { headerImageDataUrl } = useDocumentBranding("student_verification");

  useEffect(() => {
    let cancelled = false;
    getBookLabels(bookId, { copyId })
      .then((data) => !cancelled && setLabels(data))
      .catch((err) => !cancelled && setError(describeError(err, "Could not load the labels.")));
    return () => {
      cancelled = true;
    };
  }, [bookId, copyId]);

  return (
    <Modal
      title="Copy labels"
      onClose={onClose}
      width={860}
      footer={
        <>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" disabled={!labels || labels.copies.length === 0} onClick={() => window.print()}>
            Print
          </Btn>
        </>
      }
    >
      <style>{PRINT_CSS}</style>
      {!labels && !error ? <SkeletonRows rows={3} columns={3} /> : null}
      {error ? <StateBox tone="danger" title="Could not load the labels">{error}</StateBox> : null}
      {labels && labels.copies.length === 0 ? <StateBox title="No copies to label" /> : null}
      {labels && labels.copies.length ? (
        <>
          <p className="lib-no-print" style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-2)" }}>
            {labels.copies.length} label(s). Withdrawn copies are left out.
          </p>
          <div className="lib-label-sheet" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10, color: "var(--ink-1)" }}>
            {labels.copies.map((copy) => (
              <div key={copy.id} className="lib-label" style={{ border: "1px dashed var(--bd-3)", borderRadius: 6, padding: 8, background: "var(--bg-1)" }}>
                {headerImageDataUrl ? (
                  // Data URL from the school's document branding; next/image cannot optimise it.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={headerImageDataUrl} alt="" style={{ maxWidth: "100%", maxHeight: 28, display: "block", marginBottom: 4 }} />
                ) : null}
                <div style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, marginBottom: 4 }}>{labels.title_line}</div>
                <Barcode value={copy.code} />
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "center", marginTop: 2 }}>{copy.code}</div>
                <div style={{ fontSize: 10, display: "flex", justifyContent: "space-between", marginTop: 2 }}>
                  <span>{labels.call_number || labels.accession_code}</span>
                  <span>{labels.rack ? `Rack ${labels.rack}` : ""}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Modal>
  );
}

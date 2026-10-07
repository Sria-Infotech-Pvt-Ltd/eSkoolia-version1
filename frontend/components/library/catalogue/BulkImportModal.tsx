"use client";

import { useMemo, useState } from "react";
import { commitBulkImport, LibraryApiError, previewBulkImport } from "@/hooks/useLibraryApi";
import type { BulkImportPreview, BulkImportResult } from "@/types/library";
import { MAX_BULK_ROWS, parseBulkText } from "./bulkParse";
import { Btn, describeError, Modal, Pill, tdStyle, thStyle } from "./ui";

interface Props {
  onClose: () => void;
  onImported: () => void;
}

const EXAMPLE = "Matilda, Roald Dahl, Fiction, 3, 199.50\nAtlas of the World, , Reference, 1, 850";

function newBatchId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

export function BulkImportModal({ onClose, onImported }: Props) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<BulkImportPreview | null>(null);
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // One id per previewed text: a retry after a dropped response reuses it, so the server applies the batch once.
  const [batchId, setBatchId] = useState(newBatchId);
  const rows = useMemo(() => parseBulkText(text), [text]);
  const tooMany = rows.length > MAX_BULK_ROWS;

  const edit = (value: string) => {
    setText(value);
    setPreview(null);
    setBatchId(newBatchId());
  };

  const runPreview = async () => {
    setBusy(true);
    setError("");
    try {
      setPreview(await previewBulkImport(rows));
    } catch (err) {
      setError(describeError(err, "Could not check the rows."));
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    setBusy(true);
    setError("");
    try {
      const out = await commitBulkImport(rows, batchId);
      setResult(out);
      onImported();
    } catch (err) {
      const conflict = err instanceof LibraryApiError && err.status === 409;
      setError(describeError(err, conflict ? "The import conflicted with newer data. Check the preview again." : "Could not import the rows."));
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <Modal title="Import complete" onClose={onClose} footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
        <p style={{ margin: "0 0 8px", color: "var(--ink-1)" }}>
          {result.replayed ? "This import was already applied. Nothing new was added." : `Added ${result.created.length} title(s).`}
        </p>
        {result.skipped.length ? (
          <>
            <p style={{ margin: "8px 0 4px", fontSize: 13, color: "var(--ink-2)" }}>{result.skipped.length} row(s) were skipped:</p>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--danger)" }}>
              {result.skipped.map((s) => (
                <li key={s.row}>
                  Row {s.row}: {s.error}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Modal>
    );
  }

  return (
    <Modal
      title="Bulk import"
      onClose={onClose}
      width={820}
      footer={
        <>
          <Btn onClick={runPreview} disabled={busy || rows.length === 0 || tooMany}>
            {busy && !preview ? "Checking..." : "Preview"}
          </Btn>
          <Btn variant="primary" onClick={runCommit} disabled={busy || !preview || preview.valid_count === 0}>
            {busy && preview ? "Adding..." : `Add ${preview ? preview.valid_count : 0} books`}
          </Btn>
        </>
      }
    >
      <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ink-2)" }}>
        One title per line: <strong>Title, Author, Category, Copies, Cost</strong>. Separate with commas or tabs (paste straight from a spreadsheet). The category must match an
        existing category name. Copies default to 1 and cost to 0. Up to {MAX_BULK_ROWS} rows.
      </p>
      <textarea
        aria-label="Rows to import"
        value={text}
        placeholder={EXAMPLE}
        onChange={(e) => edit(e.target.value)}
        style={{ width: "100%", minHeight: 130, border: "1px solid var(--bd-2)", borderRadius: 8, padding: 8, fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg-1)", color: "var(--ink-1)" }}
      />
      <div style={{ fontSize: 12, color: tooMany ? "var(--danger)" : "var(--ink-3)", margin: "4px 0 10px" }}>
        {rows.length} row(s) read{tooMany ? `. The limit is ${MAX_BULK_ROWS}: split the list.` : "."}
      </div>
      {error ? <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{error}</div> : null}
      {preview ? (
        <>
          <div style={{ marginBottom: 8, display: "flex", gap: 8 }}>
            <Pill tone="ok">{preview.valid_count} valid</Pill>
            <Pill tone={preview.invalid_count ? "danger" : "neutral"}>{preview.invalid_count} invalid</Pill>
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", border: "1px solid var(--bd)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Author</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Copies</th>
                  <th style={thStyle}>Cost</th>
                  <th style={thStyle}>Check</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td style={tdStyle}>{row.row}</td>
                    <td style={tdStyle}>{row.title || "-"}</td>
                    <td style={tdStyle}>{row.author || "-"}</td>
                    <td style={tdStyle}>{row.category || "-"}</td>
                    <td style={tdStyle}>{row.copies}</td>
                    <td style={tdStyle}>{row.cost}</td>
                    <td style={tdStyle}>{row.valid ? <Pill tone="ok">OK</Pill> : <span style={{ color: "var(--danger)", fontSize: 12 }}>{row.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Modal>
  );
}

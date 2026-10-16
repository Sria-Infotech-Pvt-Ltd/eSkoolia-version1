"use client";

import { useCallback, useEffect, useState } from "react";
import { addCopies, listBookCopies, updateCopy, withdrawCopy } from "@/hooks/useLibraryApi";
import type { Book, BookCopy, CopyCondition, CopyStatus } from "@/types/library";
import { Btn, ConfirmDialog, describeError, Field, inputStyle, Modal, Pill, SkeletonRows, StateBox, tdStyle, thStyle } from "./ui";

interface Props {
  book: Book;
  can: (code: string) => boolean;
  onClose: () => void;
  onChanged: () => void;
  onPrintLabels: (bookId: number, copyId?: number) => void;
  notify: (text: string, tone?: "ok" | "danger") => void;
}

const CONDITIONS: CopyCondition[] = ["new", "good", "fair", "worn", "damaged"];
const PAGE_SIZE = 50;

export function statusTone(status: CopyStatus): "ok" | "info" | "danger" | "warn" | "neutral" {
  return { available: "ok", issued: "info", lost: "danger", damaged: "warn", withdrawn: "neutral" }[status] as "ok";
}

export function CopiesRegisterModal({ book, can, onClose, onChanged, onPrintLabels, notify }: Props) {
  const canUpdate = can("library.book_copies.update");
  const canWithdraw = can("library.book_copies.withdraw");
  const canAdd = can("library.books.update");
  const [rows, setRows] = useState<BookCopy[]>([]);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [withdrawing, setWithdrawing] = useState<BookCopy | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState("1");
  const [moreCondition, setMoreCondition] = useState<CopyCondition>("new");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listBookCopies(book.id, { page, page_size: PAGE_SIZE });
      setRows(data.results);
      setCount(data.count);
    } catch (err) {
      setError(describeError(err, "Could not load the copies."));
    } finally {
      setLoading(false);
    }
  }, [book.id, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeCondition = async (copy: BookCopy, condition: CopyCondition) => {
    try {
      await updateCopy(copy.id, { condition });
      setRows((prev) => prev.map((r) => (r.id === copy.id ? { ...r, condition } : r)));
    } catch (err) {
      notify(describeError(err), "danger");
    }
  };

  const confirmWithdraw = async () => {
    if (!withdrawing) return;
    if (!reason.trim()) {
      setReasonError("Give a reason for the register.");
      return;
    }
    setBusy(true);
    try {
      await withdrawCopy(withdrawing.id, reason.trim());
      notify(`Copy ${withdrawing.code} withdrawn`);
      setWithdrawing(null);
      setReason("");
      await load();
      onChanged();
    } catch (err) {
      // 409: the copy changed while the dialog was open. Say so and refresh the list.
      setReasonError(describeError(err, "Could not withdraw this copy."));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const n = Number(more);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      notify("Enter a number of copies from 1 to 500.", "danger");
      return;
    }
    setBusy(true);
    try {
      const out = await addCopies(book.id, { count: n, condition: moreCondition });
      notify(`Added ${out.added.length} cop${out.added.length === 1 ? "y" : "ies"}`);
      await load();
      onChanged();
    } catch (err) {
      notify(describeError(err), "danger");
    } finally {
      setBusy(false);
    }
  };

  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <>
      <Modal
        title={`Copies: ${book.title}`}
        onClose={onClose}
        width={820}
        footer={
          <>
            <Btn onClick={() => onPrintLabels(book.id)}>Print labels</Btn>
            <Btn variant="primary" onClick={onClose}>
              Close
            </Btn>
          </>
        }
      >
        <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-2)" }}>
          <code style={{ fontFamily: "var(--font-mono)" }}>{book.accession_code}</code>: {count} cop{count === 1 ? "y" : "ies"} on the register.
        </p>
        {loading ? <SkeletonRows rows={4} columns={5} /> : null}
        {error ? (
          <StateBox tone="danger" title="Could not load the copies">
            {error} <Btn small onClick={load}>Retry</Btn>
          </StateBox>
        ) : null}
        {!loading && !error && rows.length === 0 ? <StateBox title="No copies on the register" /> : null}
        {!loading && !error && rows.length ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Condition</th>
                <th style={thStyle}>Last verified</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {rows.map((copy) => (
                <tr key={copy.id}>
                  <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}>{copy.code}</td>
                  <td style={tdStyle}>
                    <Pill tone={statusTone(copy.status)}>{copy.status}</Pill>
                    {copy.status === "withdrawn" && copy.withdrawn_reason ? (
                      <span style={{ marginLeft: 6, fontSize: 11, color: "var(--ink-3)" }}>{copy.withdrawn_reason}</span>
                    ) : null}
                  </td>
                  <td style={tdStyle}>
                    {canUpdate && copy.status !== "withdrawn" ? (
                      <select aria-label={`Condition of ${copy.code}`} style={{ ...inputStyle, width: 110, height: 30 }} value={copy.condition} onChange={(e) => changeCondition(copy, e.target.value as CopyCondition)}>
                        {CONDITIONS.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    ) : (
                      copy.condition
                    )}
                  </td>
                  <td style={tdStyle}>{copy.last_verified_on ?? "Never"}</td>
                  <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                    <Btn small variant="ghost" onClick={() => onPrintLabels(book.id, copy.id)}>
                      Label
                    </Btn>
                    {canWithdraw && copy.status === "available" ? (
                      <Btn small variant="ghost" onClick={() => { setReason(""); setReasonError(""); setWithdrawing(copy); }}>
                        Withdraw
                      </Btn>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {pages > 1 ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, fontSize: 13 }}>
            <Btn small disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Btn>
            <span>Page {page} of {pages}</span>
            <Btn small disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Btn>
          </div>
        ) : null}
        {canAdd ? (
          <div style={{ marginTop: 16, padding: 12, background: "var(--bg-2)", borderRadius: 10, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ width: 90 }}>
              <Field label="Add copies">
                <input style={inputStyle} value={more} inputMode="numeric" onChange={(e) => setMore(e.target.value)} />
              </Field>
            </div>
            <div style={{ width: 130 }}>
              <Field label="Condition">
                <select style={inputStyle} value={moreCondition} onChange={(e) => setMoreCondition(e.target.value as CopyCondition)}>
                  {CONDITIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div style={{ marginBottom: 12 }}>
              <Btn variant="primary" onClick={add} disabled={busy}>
                Add
              </Btn>
            </div>
          </div>
        ) : null}
      </Modal>
      {withdrawing ? (
        <ConfirmDialog
          title="Withdraw copy"
          message={`Withdraw ${withdrawing.code} from circulation? This is recorded in the activity log and cannot be undone here.`}
          confirmLabel="Withdraw"
          busy={busy}
          onConfirm={confirmWithdraw}
          onCancel={() => setWithdrawing(null)}
        >
          <Field label="Reason *" error={reasonError}>
            <input style={inputStyle} value={reason} maxLength={500} autoFocus onChange={(e) => { setReason(e.target.value); setReasonError(""); }} />
          </Field>
        </ConfirmDialog>
      ) : null}
    </>
  );
}

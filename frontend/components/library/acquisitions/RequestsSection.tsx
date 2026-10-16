"use client";

import { useState } from "react";
import { LibraryApiError, listBookRequests, reviewBookRequest } from "@/hooks/useLibraryApi";
import type { BookRequest, BookRequestReviewInput, BookRequestStatus } from "@/types/library";
import { Btn, Field, inputStyle, Modal, Pill, SkeletonRows, StateBox, tdStyle, thStyle } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { REQUEST_NEXT, REQUEST_STATUS_LABEL } from "./acquisitionsHelpers";
import { cardStyle, firstError, FormAlert, Pager, SectionHeader } from "./parts";
import { useSectionList } from "./useSectionList";

const TONE: Record<BookRequestStatus, "warn" | "ok" | "danger" | "info" | "neutral"> = {
  pending: "warn",
  approved: "ok",
  rejected: "danger",
  ordered: "info",
  fulfilled: "neutral",
};

const ACTION_LABEL: Record<Exclude<BookRequestStatus, "pending">, string> = {
  approved: "Approve",
  rejected: "Reject",
  ordered: "Mark ordered",
  fulfilled: "Mark fulfilled",
};

interface Props {
  can: (code: string) => boolean;
  onChanged: (message: string, tone?: "ok" | "danger") => void;
}

/** Teacher requests for new titles. Teachers send them from the portal; the library reviews them here. */
export function RequestsSection({ can, onChanged }: Props) {
  const canView = can("library.book_requests.view");
  const [status, setStatus] = useState<BookRequestStatus | "">("pending");
  const [reviewing, setReviewing] = useState<{ row: BookRequest; next: Exclude<BookRequestStatus, "pending"> } | null>(null);
  const list = useSectionList(
    "library-book-requests",
    canView,
    (page, pageSize) => listBookRequests({ page, page_size: pageSize, status: status || undefined }),
    status,
    "Could not load the requests.",
  );

  if (!canView) return null;

  return (
    <section aria-label="Teacher requests">
      <SectionHeader
        title="Teacher requests"
        hint="Titles teachers asked the library to buy. A request only moves forward; the teacher is told each time."
        actions={
          <select aria-label="Request status" style={{ ...inputStyle, width: 150 }} value={status} onChange={(e) => { setStatus(e.target.value as BookRequestStatus | ""); list.setPage(1); }}>
            <option value="">All requests</option>
            {(Object.keys(REQUEST_STATUS_LABEL) as BookRequestStatus[]).map((s) => (
              <option key={s} value={s}>{REQUEST_STATUS_LABEL[s]}</option>
            ))}
          </select>
        }
      />
      {list.error ? (
        <StateBox tone="danger" title="Could not load the requests">
          {list.error} <Btn small onClick={list.load}>Retry</Btn>
        </StateBox>
      ) : (
        <div style={cardStyle}>
          {list.loading ? (
            <SkeletonRows rows={4} columns={6} />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Requested by</th>
                  <th style={thStyle}>Class</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Review</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => {
                  const moves = REQUEST_NEXT[row.status];
                  return (
                    <tr key={row.id}>
                      <td style={{ ...tdStyle, minWidth: 200 }}>
                        <div style={{ fontWeight: 600 }}>{row.title}</div>
                        {row.notes ? <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{row.notes}</div> : null}
                      </td>
                      <td style={tdStyle}>{row.requested_by_name}</td>
                      <td style={tdStyle}>{[row.class_name, row.section_name].filter(Boolean).join(" ") || <span style={{ color: "var(--ink-3)" }}>Any</span>}</td>
                      <td style={tdStyle}>{formatDate(row.created_at)}</td>
                      <td style={tdStyle}><Pill tone={TONE[row.status]}>{REQUEST_STATUS_LABEL[row.status]}</Pill></td>
                      <td style={{ ...tdStyle, fontSize: 12, color: "var(--ink-2)", minWidth: 160 }}>
                        {row.reviewed_at ? `${row.reviewed_by_name || "Library"}, ${formatDate(row.reviewed_at)}` : <span style={{ color: "var(--ink-3)" }}>Not reviewed</span>}
                        {row.review_note ? <div>{row.review_note}</div> : null}
                        {row.linked_book_title ? <div>Catalogue: {row.linked_book_title}</div> : null}
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                        {can("library.book_requests.review")
                          ? moves.map((next) => (
                              <Btn key={next} small variant="ghost" onClick={() => setReviewing({ row, next })}>{ACTION_LABEL[next]}</Btn>
                            ))
                          : null}
                      </td>
                    </tr>
                  );
                })}
                {list.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>
                      {status === "pending" ? "No requests are waiting for review." : status ? "No request has this status." : "No teacher has asked for a book yet."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      )}
      {!list.error ? <Pager count={list.count} page={list.page} pageSize={list.pageSize} loading={list.loading} noun="request" onPage={list.setPage} onPageSize={list.setPageSize} /> : null}

      {reviewing ? (
        <ReviewModal
          row={reviewing.row}
          next={reviewing.next}
          onClose={() => setReviewing(null)}
          onDone={async (message) => {
            setReviewing(null);
            onChanged(message);
            await list.load();
          }}
          onStale={async (message) => {
            // Someone else already moved it: show why and the current state.
            setReviewing(null);
            onChanged(message, "danger");
            await list.load();
          }}
        />
      ) : null}
    </section>
  );
}

function ReviewModal({
  row, next, onClose, onDone, onStale,
}: {
  row: BookRequest;
  next: Exclude<BookRequestStatus, "pending">;
  onClose: () => void;
  onDone: (message: string) => void;
  onStale: (message: string) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [fields, setFields] = useState<Record<string, string[]> | undefined>();

  const save = async () => {
    setBusy(true);
    setProblem("");
    setFields(undefined);
    const body: BookRequestReviewInput = { status: next, note: note.trim() };
    try {
      await reviewBookRequest(row.id, body);
      onDone(`Request marked ${REQUEST_STATUS_LABEL[next].toLowerCase()}. The teacher has been told.`);
    } catch (err) {
      if (err instanceof LibraryApiError && err.code === "library_invalid_state_transition") {
        onStale(refusalMessage(err));
        return;
      }
      setFields(err instanceof LibraryApiError ? err.fieldErrors : undefined);
      setProblem(refusalMessage(err, "Could not save the review."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`${ACTION_LABEL[next]}: ${row.title}`}
      onClose={onClose}
      width={480}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant={next === "rejected" ? "danger" : "primary"} onClick={save} disabled={busy}>{busy ? "Saving..." : ACTION_LABEL[next]}</Btn>
        </>
      }
    >
      <FormAlert text={problem} />
      <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 0 }}>
        {row.requested_by_name} will get a notification. This cannot be undone: a request only moves forward.
      </p>
      <Field label="Note to the teacher (optional)" error={firstError(fields, "note")}>
        <input style={inputStyle} value={note} maxLength={1000} autoFocus onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Modal>
  );
}

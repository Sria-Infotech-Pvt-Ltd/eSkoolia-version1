"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortalNotifications } from "@/hooks/usePortalNotifications";
import {
  createLibraryBookRequest,
  fetchLibraryBookRequests,
  libraryErrorMessage,
  searchLibraryBooks,
  type LibraryBookRequestItem,
  type LibraryBookSearchRow,
} from "@/lib/api/teacher";
import { formatDate } from "@/components/library/issue-desk/deskHelpers";
import { Button, card, EmptyBox, ErrorBox, input, LoadingBlock, Notice, Page, Pill } from "./shared";
import { availabilityText, cleanTitle, REQUEST_STATUS } from "./teacherLibraryHelpers";

const SEARCH_DELAY_MS = 300;

/** Recommend a Book: check the catalogue, send a request, and follow what the library decided. */
export function RecommendPage() {
  const [requests, setRequests] = useState<LibraryBookRequestItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [found, setFound] = useState<LibraryBookSearchRow[]>([]);
  const [searched, setSearched] = useState("");
  const latest = useRef(0);

  const load = useCallback(async (quiet = false) => {
    const ticket = ++latest.current;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await fetchLibraryBookRequests(quiet);
      if (ticket === latest.current) setRequests(result.results);
    } catch (err) {
      if (ticket === latest.current && !quiet) setError(libraryErrorMessage(err, "Could not load your requests."));
    } finally {
      if (ticket === latest.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The librarian's review arrives as a push: refresh quietly so the status changes without a reload.
  usePortalNotifications(
    useCallback((n) => {
      if (n.kind === "library") void load(true);
    }, [load]),
  );

  // Check the catalogue while the teacher types a title.
  useEffect(() => {
    const term = cleanTitle(title);
    if (term.length < 2) {
      setFound([]);
      setSearched("");
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchLibraryBooks(term)
        .then((result) => {
          if (cancelled) return;
          setFound(result.results);
          setSearched(term);
        })
        .catch(() => !cancelled && setFound([]));
    }, SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [title]);

  const submit = async () => {
    const clean = cleanTitle(title);
    if (!clean) return;
    setSaving(true);
    setMessage(null);
    try {
      await createLibraryBookRequest({ title: clean, notes: notes.trim() });
      setTitle("");
      setNotes("");
      setFound([]);
      setMessage({ tone: "ok", text: "Your request was sent to the library." });
      await load(true);
    } catch (err) {
      setMessage({ tone: "danger", text: libraryErrorMessage(err, "Could not send your request.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page title="Library: Recommend a Book" subtitle="Ask the library to buy a book for your class">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

      <section style={{ ...card, marginBottom: 18 }} aria-label="New request">
        <h2 style={{ margin: "0 0 10px", fontSize: 16, color: "var(--ink-1)" }}>New request</h2>
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 10 }}>
          Book title
          <input style={{ ...input, marginTop: 4 }} value={title} maxLength={255} placeholder="Title, and the author if you know it" onChange={(e) => setTitle(e.target.value)} />
        </label>
        {searched ? (
          found.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "var(--ink-3)", margin: "0 0 10px" }}>The library does not seem to have a book like this yet.</p>
          ) : (
            <div style={{ background: "var(--bg-2)", borderRadius: 10, padding: "8px 12px", marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)", marginBottom: 4 }}>Already in the library</div>
              {found.map((book) => (
                <div key={book.id} style={{ fontSize: 13, color: "var(--ink-1)", padding: "3px 0" }}>
                  <strong>{book.title}</strong>
                  {book.author ? <span style={{ color: "var(--ink-3)" }}> by {book.author}</span> : null}
                  <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{availabilityText(book.available_copies, book.total_copies, book.reference_only)}</div>
                </div>
              ))}
            </div>
          )
        ) : null}
        <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 12 }}>
          Why this book (optional)
          <textarea
            style={{ ...input, marginTop: 4, height: 72, padding: 10, resize: "vertical", fontFamily: "inherit" }}
            value={notes}
            maxLength={1000}
            placeholder="For example: for the Grade 4 reading hour"
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <Button variant="primary" onClick={submit} disabled={saving || !cleanTitle(title)}>{saving ? "Sending..." : "Send request"}</Button>
      </section>

      <h2 style={{ margin: "0 0 10px", fontSize: 16, color: "var(--ink-1)" }}>Your requests</h2>
      {loading ? (
        <LoadingBlock rows={3} />
      ) : error || requests === null ? (
        <ErrorBox message={error || "Could not load your requests."} onRetry={() => void load()} />
      ) : requests.length === 0 ? (
        <EmptyBox title="You have not asked for a book yet">Your requests and the library&apos;s answers will appear here.</EmptyBox>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {requests.map((request) => {
            const state = REQUEST_STATUS[request.status];
            return (
              <article key={request.id} style={card}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <strong style={{ color: "var(--ink-1)" }}>{request.title}</strong>
                  <Pill tone={state.tone}>{state.label}</Pill>
                </div>
                <div style={{ fontSize: 12, color: "var(--ink-3)", margin: "2px 0" }}>Sent {formatDate(request.created_at)}</div>
                {request.notes ? <div style={{ fontSize: 13, color: "var(--ink-2)" }}>{request.notes}</div> : null}
                {request.review_note ? (
                  <div style={{ fontSize: 13, color: "var(--ink-1)", background: "var(--bg-2)", borderRadius: 8, padding: "6px 10px", marginTop: 6 }}>
                    Library: {request.review_note}
                  </div>
                ) : null}
                {request.linked_book_title ? <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>In the catalogue as {request.linked_book_title}</div> : null}
              </article>
            );
          })}
        </div>
      )}
    </Page>
  );
}

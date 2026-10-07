"use client";

import { useCallback, useEffect, useState } from "react";
import { cancelHold, listHolds, placeHold } from "@/hooks/useLibraryApi";
import type { Hold } from "@/types/library";
import { Btn, Pill, SkeletonRows, StateBox } from "../catalogue/ui";
import { refusalMessage } from "./deskHelpers";

interface Props {
  bookId: number;
  bookTitle: string;
  /** The member picked in the issue tab, if any, so a hold can be placed for them. */
  member: { id: number; name: string } | null;
  can: (code: string) => boolean;
  notify: (text: string, tone?: "ok" | "danger") => void;
  onChanged: () => void;
  /** Overrides the default heading, which says no copy is on the shelf. */
  heading?: string;
}

/** Shown in the issue tab when a title has no copy on the shelf: who is waiting, and a way to join the queue. */
export function HoldsPanel({ bookId, bookTitle, member, can, notify, onChanged, heading }: Props) {
  const canView = can("library.holds.view");
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canView) return;
    setError("");
    try {
      setHolds((await listHolds({ book: bookId, status: "waiting", page_size: 50 }, { silent401: true })).results);
    } catch (err) {
      setError(refusalMessage(err, "Could not load the queue."));
    }
  }, [bookId, canView]);

  useEffect(() => {
    setHolds(null);
    void load();
  }, [load]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      notify(done);
      await load();
      onChanged();
    } catch (err) {
      notify(refusalMessage(err), "danger");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ background: "var(--warn-soft)", borderRadius: 12, padding: 14, marginTop: 12 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 14, color: "var(--warn)" }}>{heading ?? `No copy of ${bookTitle} is on the shelf`}</h3>
      {can("library.holds.create") ? (
        <div style={{ marginBottom: 8 }}>
          <Btn
            small
            variant="primary"
            disabled={busy || !member}
            onClick={() => member && run(() => placeHold({ book: bookId, member: member.id }), `${member.name} is on the waiting list`)}
          >
            {member ? `Reserve for ${member.name}` : "Pick a member to reserve it"}
          </Btn>
        </div>
      ) : null}
      {!canView ? <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>You can reserve titles but not see the queue.</p> : null}
      {canView && !holds && !error ? <SkeletonRows rows={2} columns={2} /> : null}
      {error ? <StateBox tone="danger" title={error}><Btn small onClick={load}>Retry</Btn></StateBox> : null}
      {holds && holds.length === 0 ? <p style={{ fontSize: 12, color: "var(--ink-2)", margin: 0 }}>Nobody is waiting yet.</p> : null}
      {holds?.map((hold, index) => (
        <div key={hold.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: 13, color: "var(--ink-1)" }}>
          <span>
            <Pill tone="brand">{index + 1}</Pill> {hold.member_name} <span style={{ color: "var(--ink-3)" }}>{hold.card_no}</span>
          </span>
          {can("library.holds.cancel") ? (
            <Btn small variant="ghost" disabled={busy} onClick={() => run(() => cancelHold(hold.id), "Hold cancelled")}>
              Cancel
            </Btn>
          ) : null}
        </div>
      ))}
    </section>
  );
}

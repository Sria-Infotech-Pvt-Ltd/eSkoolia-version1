"use client";

import { useState } from "react";
import { listMembers } from "@/hooks/useLibraryApi";
import type { Book, Member } from "@/types/library";
import { inputStyle, Modal, Btn, Pill } from "../catalogue/ui";
import { HoldsPanel } from "./HoldsPanel";
import { SuggestionList, SuggestionRow } from "./DeskSearch";
import { useSuggest } from "./useSuggest";

interface Props {
  book: Pick<Book, "id" | "title" | "copies_available" | "is_reference_only">;
  can: (code: string) => boolean;
  notify: (text: string, tone?: "ok" | "danger") => void;
  onClose: () => void;
}

const fetchMembers = async (q: string, signal: AbortSignal): Promise<Member[]> =>
  (await listMembers({ search: q, is_active: true, page_size: 8 }, { silent401: true, signal })).results;

/** Reserve action of the catalogue row: pick a member and join the queue for this title. */
export function ReserveModal({ book, can, notify, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [member, setMember] = useState<Member | null>(null);
  const suggest = useSuggest(query, fetchMembers);
  const canFind = can("library.library_members.view");

  return (
    <Modal title={`Reserve: ${book.title}`} onClose={onClose} width={560} footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
      {book.is_reference_only ? (
        <p role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>This is a reference-only title and cannot be reserved.</p>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 0 }}>
            {book.copies_available > 0
              ? `${book.copies_available} copy(ies) are on the shelf now. A hold is for a member who wants this title set aside when it next comes back.`
              : "All copies are out. The member is added to the waiting list."}
          </p>
          {canFind ? (
            member ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: "var(--bg-2)", borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
                <span>
                  <strong>{member.display_name}</strong> <span style={{ color: "var(--ink-3)" }}>{member.card_no}</span>
                </span>
                <Btn small variant="ghost" onClick={() => setMember(null)}>Change</Btn>
              </div>
            ) : (
              <>
                <input aria-label="Find a member" style={inputStyle} autoFocus placeholder="Search a member by name or card" value={query} onChange={(e) => setQuery(e.target.value)} />
                {suggest.error ? <p role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{suggest.error}</p> : null}
                {suggest.items.length ? (
                  <div style={{ marginTop: 8 }}>
                    <SuggestionList>
                      {suggest.items.map((m) => (
                        <SuggestionRow key={m.id} onPick={() => { setMember(m); setQuery(""); }}>
                          <span>
                            <strong>{m.display_name}</strong> <span style={{ color: "var(--ink-3)" }}>{m.card_no}</span>
                          </span>
                          {m.standing === "suspended" ? <Pill tone="danger">Suspended</Pill> : <Pill tone="ok">OK</Pill>}
                        </SuggestionRow>
                      ))}
                    </SuggestionList>
                  </div>
                ) : query.trim().length >= 2 && !suggest.loading && !suggest.error ? (
                  <p style={{ fontSize: 13, color: "var(--ink-3)" }}>No member matches.</p>
                ) : null}
              </>
            )
          ) : (
            <p style={{ fontSize: 13, color: "var(--ink-3)" }}>Finding a member needs the library members view permission.</p>
          )}
          <HoldsPanel
            bookId={book.id}
            bookTitle={book.title}
            member={member ? { id: member.id, name: member.display_name } : null}
            can={can}
            notify={notify}
            onChanged={() => undefined}
            heading="Waiting list"
          />
        </>
      )}
    </Modal>
  );
}

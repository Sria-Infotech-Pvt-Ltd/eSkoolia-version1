"use client";

import { useRef, useState } from "react";
import { undoReturn } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import type { Loan, ReturnResult } from "@/types/library";
import { SkeletonRows, StateBox, useToast } from "../catalogue/ui";
import { refusalMessage } from "./deskHelpers";
import { DeskLog } from "./DeskLog";
import { IssueTab } from "./IssueTab";
import { RenewTab } from "./RenewTab";
import { ReturnTab } from "./ReturnTab";
import { UndoToast } from "./UndoToast";

type Tab = "issue" | "return" | "renew";

const TABS: { key: Tab; label: string; code: string }[] = [
  { key: "issue", label: "Issue", code: "library.book_issues.issue" },
  { key: "return", label: "Return", code: "library.book_issues.return" },
  { key: "renew", label: "Renew", code: "library.book_issues.renew" },
];

export function IssueDeskPage() {
  const { me, can } = usePermissions();
  const [tab, setTab] = useState<Tab>("issue");
  const [logKey, setLogKey] = useState(0);
  const [undo, setUndo] = useState<{ loanId: number; title: string; expiresAt: string } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { show, node: toastNode } = useToast();

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={3} />
      </Shell>
    );
  }
  if (!can("library.book_issues.view")) {
    return (
      <Shell>
        <StateBox title="You do not have access to the issue desk">Ask an administrator to give your role the library book issues view permission.</StateBox>
      </Shell>
    );
  }

  const visible = TABS.filter((t) => can(t.code));
  const active = visible.find((t) => t.key === tab) ?? visible[0];
  const acted = () => setLogKey((n) => n + 1);

  const onReturned = (loan: Loan, result: ReturnResult) => {
    // Only a plain return can be undone; the server sends no deadline when a lost or damaged report was filed.
    setUndo(result.undo_expires_at ? { loanId: loan.id, title: loan.book_title, expiresAt: result.undo_expires_at } : null);
  };

  const runUndo = async () => {
    if (!undo) return;
    setUndoBusy(true);
    try {
      await undoReturn(undo.loanId);
      show(`Return of ${undo.title} undone`);
      setUndo(null);
      acted();
    } catch (err) {
      show(refusalMessage(err, "Could not undo this return."), "danger");
      setUndo(null);
    } finally {
      setUndoBusy(false);
    }
  };

  return (
    <Shell>
      {visible.length === 0 ? (
        <StateBox title="Nothing to do here">Your role can see the desk log but cannot issue, return or renew books.</StateBox>
      ) : (
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 520px", minWidth: 0 }}>
            <div role="tablist" aria-label="Desk" style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              {visible.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={active.key === t.key}
                  onClick={() => setTab(t.key)}
                  style={{
                    padding: "8px 20px", borderRadius: 999, cursor: "pointer", fontSize: 14, fontWeight: 600, border: "1px solid var(--bd-3)",
                    background: active.key === t.key ? "var(--pu)" : "var(--bg-1)", color: active.key === t.key ? "var(--bg-1)" : "var(--ink-1)",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* key: switching tabs gives the new tab a fresh search box that takes focus */}
            {active.key === "issue" ? <IssueTab key="issue" can={can} searchRef={searchRef} notify={show} onActed={acted} /> : null}
            {active.key === "return" ? <ReturnTab key="return" can={can} searchRef={searchRef} notify={show} onActed={acted} onReturned={onReturned} /> : null}
            {active.key === "renew" ? <RenewTab key="renew" can={can} searchRef={searchRef} notify={show} onActed={acted} /> : null}
          </div>
          <div style={{ flex: "0 0 320px", maxWidth: "100%" }}>
            <DeskLog refreshKey={logKey} />
          </div>
        </div>
      )}
      {undo ? <UndoToast key={undo.loanId} title={undo.title} expiresAt={undo.expiresAt} busy={undoBusy} onUndo={runUndo} onExpire={() => setUndo(null)} /> : null}
      {toastNode}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Issue desk</h1>
      <p style={{ margin: "4px 0 16px", fontSize: 13, color: "var(--ink-3)" }}>Issue, return and renew books. Scan a copy code or type to search.</p>
      {children}
    </div>
  );
}

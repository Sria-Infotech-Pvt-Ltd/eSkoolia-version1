"use client";

import { useEffect, useState } from "react";
import { Btn } from "../catalogue/ui";
import { formatCountdown, undoSecondsLeft } from "./deskHelpers";

interface Props {
  title: string;
  /** ISO time the server stops accepting an undo. */
  expiresAt: string;
  busy: boolean;
  onUndo: () => void;
  onExpire: () => void;
}

/** "Returned X. Undo (9:42)". Driven by the server's undo_expires_at, so it matches what the server will accept. */
export function UndoToast({ title, expiresAt, busy, onUndo, onExpire }: Props) {
  const [left, setLeft] = useState(() => undoSecondsLeft(expiresAt));

  useEffect(() => {
    const tick = () => {
      const seconds = undoSecondsLeft(expiresAt);
      setLeft(seconds);
      if (seconds <= 0) onExpire();
    };
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  if (left <= 0) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 1100, maxWidth: "min(480px, 92vw)",
        display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderRadius: 12, boxShadow: "var(--sh-3)",
        background: "var(--ink-1)", color: "var(--bg-1)", fontSize: 13,
      }}
    >
      <span>
        Returned <strong>{title}</strong>
      </span>
      <Btn small variant="secondary" disabled={busy} onClick={onUndo}>
        Undo ({formatCountdown(left)})
      </Btn>
    </div>
  );
}

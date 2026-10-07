"use client";

import { useCallback, useEffect, useState } from "react";
import { getDeskLog } from "@/hooks/useLibraryApi";
import type { DeskEventType, DeskLog as DeskLogData } from "@/types/library";
import { Btn, Pill, SkeletonRows, StateBox } from "../catalogue/ui";
import { formatTime } from "./deskHelpers";

const TONE: Record<DeskEventType, "ok" | "info" | "warn" | "danger"> = {
  issue: "info",
  return: "ok",
  renewal: "warn",
  lost: "danger",
  damaged: "danger",
};
const LABEL: Record<DeskEventType, string> = { issue: "Issued", return: "Returned", renewal: "Renewed", lost: "Lost", damaged: "Damaged" };
const POLL_MS = 30_000;

/** Today at the Desk. Refetches when `refreshKey` changes (after any desk action) and every 30 seconds while the tab is visible. */
export function DeskLog({ refreshKey }: { refreshKey: number }) {
  const [log, setLog] = useState<DeskLogData | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setLog(await getDeskLog({ silent401: true }));
      setError("");
    } catch {
      setError("The log could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  useEffect(() => {
    const handle = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(handle);
  }, [load]);

  return (
    <aside aria-label="Today at the desk" style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 14 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15, color: "var(--ink-1)" }}>Today at the Desk</h2>
      {log ? (
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 10 }}>
          {log.counts.issue} issued, {log.counts.return + log.counts.lost + log.counts.damaged} returned, {log.counts.renewal} renewed
        </div>
      ) : null}
      {!log && !error ? <SkeletonRows rows={5} columns={1} /> : null}
      {error ? (
        <StateBox tone="danger" title={error}>
          <Btn small onClick={load}>Retry</Btn>
        </StateBox>
      ) : null}
      {log && log.results.length === 0 ? <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 0 }}>Nothing has happened at the desk today.</p> : null}
      {log
        ? log.results.map((entry) => (
            <div key={entry.id} style={{ padding: "7px 0", borderBottom: "1px solid var(--bd)", fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 2 }}>
                <Pill tone={TONE[entry.event_type]}>{LABEL[entry.event_type]}</Pill>
                <span style={{ color: "var(--ink-3)" }}>
                  {formatTime(entry.created_at)}
                  {entry.actor_name ? ` · ${entry.actor_name}` : ""}
                </span>
              </div>
              <div style={{ color: "var(--ink-1)" }}>{entry.summary}</div>
            </div>
          ))
        : null}
      {log && log.count > log.results.length ? (
        <p style={{ fontSize: 11, color: "var(--ink-3)", marginBottom: 0 }}>Showing the latest {log.results.length} of {log.count}.</p>
      ) : null}
    </aside>
  );
}

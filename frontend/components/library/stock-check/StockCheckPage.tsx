"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LibraryApiError, listStockAudits, startStockAudit } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import type { StockAudit } from "@/types/library";
import { Btn, Pill, SkeletonRows, StateBox, tdStyle, thStyle, useToast } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { AuditWorkspace } from "./AuditWorkspace";
import { RackPicker } from "./RackPicker";
import { progressPercent, scopeLabel } from "./stockHelpers";

const STATUS: Record<StockAudit["status"], { tone: "warn" | "ok" | "neutral"; label: string }> = {
  in_progress: { tone: "warn", label: "In progress" },
  completed: { tone: "ok", label: "Finished" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export function StockCheckPage() {
  const { me, can } = usePermissions();
  const [audits, setAudits] = useState<StockAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rack, setRack] = useState("");
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const { show, node: toastNode } = useToast();
  const latest = useRef(0);
  const canView = can("library.stock_audits.view");

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setError("");
    try {
      const page = await listStockAudits({ page_size: 50 });
      if (ticket === latest.current) setAudits(page.results);
    } catch (err) {
      if (ticket === latest.current) setError(refusalMessage(err, "Could not load the stock checks."));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (me && canView) void load();
  }, [me, canView, load]);

  const start = async () => {
    setStarting(true);
    try {
      const audit = await startStockAudit(rack);
      show(`Stock check started: ${audit.progress.total} copies to find.`);
      await load();
      setOpenId(audit.id);
    } catch (err) {
      const existing = audits.find((a) => a.status === "in_progress" && a.scope_rack === rack);
      if (err instanceof LibraryApiError && err.code === "library_audit_in_progress" && existing) {
        show(`${scopeLabel(existing)} already has a stock check open. Opening it.`, "danger");
        setOpenId(existing.id);
      } else {
        const field = err instanceof LibraryApiError ? err.fieldErrors?.rack?.[0] : undefined;
        show(field ?? refusalMessage(err, "Could not start the stock check."), "danger");
      }
    } finally {
      setStarting(false);
    }
  };

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={5} />
      </Shell>
    );
  }
  if (!canView) {
    return (
      <Shell>
        <StateBox title="You do not have access to stock checks">Ask an administrator to give your role the library stock audits view permission.</StateBox>
      </Shell>
    );
  }

  if (openId !== null) {
    return (
      <Shell>
        <AuditWorkspace
          auditId={openId}
          can={can}
          onBack={() => {
            setOpenId(null);
            void load();
          }}
          onChanged={(message, tone) => {
            if (message) show(message, tone ?? "ok");
            void load();
          }}
        />
        {toastNode}
      </Shell>
    );
  }

  const open = audits.filter((a) => a.status === "in_progress");

  return (
    <Shell>
      {can("library.stock_audits.run") ? (
        <section style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 16, marginBottom: 16 }} aria-label="Start a stock check">
          <h2 style={{ margin: "0 0 8px", fontSize: 15, color: "var(--ink-1)" }}>Start a stock check</h2>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--ink-3)" }}>Only copies on the shelf are checked. Issued, lost, damaged and withdrawn copies are left out.</p>
          <div style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
            <RackPicker value={rack} onChange={setRack} />
            <Btn variant="primary" onClick={start} disabled={starting}>{starting ? "Starting..." : "Start stock check"}</Btn>
          </div>
        </section>
      ) : null}

      {loading ? (
        <SkeletonRows rows={5} columns={6} />
      ) : error ? (
        <StateBox tone="danger" title="Could not load the stock checks">
          {error} <Btn small onClick={() => { setLoading(true); void load(); }}>Retry</Btn>
        </StateBox>
      ) : (
        <>
          {open.length > 0 ? (
            <div style={{ marginBottom: 14 }} aria-label="Open stock checks">
              {open.map((audit) => (
                <div key={audit.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "var(--warn-soft)", color: "var(--warn)", borderRadius: 10, padding: "10px 14px", marginBottom: 6, fontSize: 13 }}>
                  <span><strong>{scopeLabel(audit)}</strong> is open: {audit.progress.found} of {audit.progress.total} found ({progressPercent(audit.progress)}%)</span>
                  <Btn small onClick={() => setOpenId(audit.id)}>Continue</Btn>
                </div>
              ))}
            </div>
          ) : null}
          <div style={{ overflowX: "auto", background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: "4px 8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Scope</th>
                  <th style={thStyle}>Started</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Found</th>
                  <th style={thStyle}>Missing</th>
                  <th style={thStyle}>Value at risk</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {audits.map((audit) => {
                  const state = STATUS[audit.status];
                  const done = audit.status === "completed";
                  return (
                    <tr key={audit.id}>
                      <td style={tdStyle}>{scopeLabel(audit)}</td>
                      <td style={tdStyle}>{formatDate(audit.started_at)}</td>
                      <td style={tdStyle}><Pill tone={state.tone}>{state.label}</Pill></td>
                      <td style={tdStyle}>{audit.progress.found} of {audit.progress.total}</td>
                      <td style={tdStyle}>{done ? audit.missing_count : <span style={{ color: "var(--ink-3)" }}>n/a</span>}</td>
                      <td style={tdStyle}>{done ? audit.value_at_risk : <span style={{ color: "var(--ink-3)" }}>n/a</span>}</td>
                      <td style={{ ...tdStyle, textAlign: "right" }}>
                        <Btn small variant="ghost" onClick={() => setOpenId(audit.id)}>{audit.status === "in_progress" ? "Continue" : "View"}</Btn>
                      </td>
                    </tr>
                  );
                })}
                {audits.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>No stock check has been run yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </>
      )}
      {toastNode}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Stock check</h1>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Walk the shelves, tick what you find, and see what is missing</p>
      </div>
      {children}
    </div>
  );
}


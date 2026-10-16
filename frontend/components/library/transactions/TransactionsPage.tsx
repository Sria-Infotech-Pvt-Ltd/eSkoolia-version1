"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { exportActivityLogs, listActivityLogs, listMembers } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistentPagination } from "@/hooks/usePersistentPagination";
import type { ActivityLogRow, Member } from "@/types/library";
import { Btn, inputStyle, Pill, SkeletonRows, StateBox, tdStyle, thStyle, useToast } from "../catalogue/ui";
import { refusalMessage } from "../issue-desk/deskHelpers";
import {
  EMPTY_FILTERS,
  EVENT_CHIPS,
  EVENT_TONE,
  eventLabel,
  exportMessage,
  formatTimestamp,
  hasFilters,
  rangeIsBackwards,
  toggleType,
  toLogParams,
  type LogFilters,
} from "./logsHelpers";

export function TransactionsPage() {
  const { me, can } = usePermissions();
  const { page, pageSize, setPage, setPageSize } = usePersistentPagination("library-transactions", 1, 50);
  const [filters, setFilters] = useState<LogFilters>(EMPTY_FILTERS);
  const [memberName, setMemberName] = useState("");
  const [rows, setRows] = useState<ActivityLogRow[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  const { show, node: toastNode } = useToast();
  const latest = useRef(0);
  const canView = can("library.activity_logs.view");
  const backwards = rangeIsBackwards(filters.from, filters.to);
  const filterKey = JSON.stringify(filters);

  const load = useCallback(async () => {
    if (backwards) {
      setLoading(false);
      return;
    }
    const ticket = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const data = await listActivityLogs({ ...toLogParams(filters), page, page_size: pageSize });
      if (ticket !== latest.current) return;
      setRows(data.results);
      setCount(data.count);
    } catch (err) {
      if (ticket !== latest.current) return;
      if ((err as { status?: number }).status === 404 && page > 1) {
        setPage(1);
        return;
      }
      setError(refusalMessage(err, "Could not load the activity log."));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, page, pageSize, backwards]);

  useEffect(() => {
    if (me && canView) void load();
  }, [me, canView, load]);

  const change = (next: Partial<LogFilters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(1);
  };

  const runExport = async () => {
    setExporting(true);
    try {
      show(exportMessage(await exportActivityLogs(toLogParams(filters))));
      await load(); // the export wrote its own row
    } catch (err) {
      show(refusalMessage(err, "Could not export the log."), "danger");
    } finally {
      setExporting(false);
    }
  };

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={8} columns={4} />
      </Shell>
    );
  }
  if (!canView) {
    return (
      <Shell>
        <StateBox title="You do not have access to the activity log">Ask an administrator to give your role the library activity log view permission.</StateBox>
      </Shell>
    );
  }

  const pages = Math.max(1, Math.ceil(count / pageSize));

  return (
    <Shell
      actions={
        can("library.activity_logs.export") ? (
          <Btn variant="primary" onClick={runExport} disabled={exporting || backwards}>{exporting ? "Exporting..." : "Export CSV"}</Btn>
        ) : null
      }
    >
      <div role="group" aria-label="Event types" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <Chip active={filters.types.length === 0} onClick={() => change({ types: [] })}>All</Chip>
        {EVENT_CHIPS.map((type) => (
          <Chip key={type} active={filters.types.includes(type)} onClick={() => change({ types: toggleType(filters.types, type) })}>{eventLabel(type)}</Chip>
        ))}
      </div>

      <div role="group" aria-label="Filters" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "end", marginBottom: 14 }}>
        <label style={labelText}>
          From
          <input type="date" style={{ ...inputStyle, width: 160 }} value={filters.from} max={filters.to || undefined} onChange={(e) => change({ from: e.target.value })} />
        </label>
        <label style={labelText}>
          To
          <input type="date" style={{ ...inputStyle, width: 160 }} value={filters.to} min={filters.from || undefined} onChange={(e) => change({ to: e.target.value })} />
        </label>
        <label style={labelText}>
          Search details
          <input style={{ ...inputStyle, width: 200 }} value={filters.search} maxLength={100} placeholder="Words in the details" onChange={(e) => change({ search: e.target.value })} />
        </label>
        <MemberFilter
          memberName={memberName}
          active={filters.member !== null}
          onPick={(member) => {
            setMemberName(member ? `${member.display_name} (${member.card_no})` : "");
            change({ member: member ? member.id : null });
          }}
        />
        {hasFilters(filters) ? <Btn small variant="ghost" onClick={() => { setFilters(EMPTY_FILTERS); setMemberName(""); setPage(1); }}>Clear filters</Btn> : null}
      </div>
      {backwards ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13, marginBottom: 10 }}>The end date is before the start date.</div> : null}

      {error ? (
        <StateBox tone="danger" title="Could not load the activity log">
          {error} <Btn small onClick={load}>Retry</Btn>
        </StateBox>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: "4px 8px" }}>
          {loading ? (
            <SkeletonRows rows={8} columns={4} />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Details</th>
                  <th style={thStyle}>Staff</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ ...tdStyle, whiteSpace: "nowrap", color: "var(--ink-2)" }}>{formatTimestamp(row.created_at)}</td>
                    <td style={tdStyle}><Pill tone={EVENT_TONE[row.event_type] ?? "neutral"}>{eventLabel(row.event_type)}</Pill></td>
                    <td style={{ ...tdStyle, minWidth: 280 }}>{row.summary}</td>
                    <td style={tdStyle}>{row.actor_name || <span style={{ color: "var(--ink-3)" }}>System</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>
                      {hasFilters(filters) ? (
                        <>
                          Nothing matches these filters.{" "}
                          <Btn small variant="ghost" onClick={() => { setFilters(EMPTY_FILTERS); setMemberName(""); setPage(1); }}>Show everything</Btn>
                        </>
                      ) : (
                        "Nothing has happened in the library yet."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!error && count > 0 ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--ink-2)", flexWrap: "wrap" }}>
          <span>{count.toLocaleString("en-US")} event{count === 1 ? "" : "s"}</span>
          <Btn small disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>Previous</Btn>
          <span>Page {page} of {pages}</span>
          <Btn small disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>Next</Btn>
          <label>
            Per page{" "}
            <select aria-label="Page size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ ...inputStyle, width: 70, height: 30, display: "inline-block" }}>
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      {toastNode}
    </Shell>
  );
}

const labelText = { display: "grid", gap: 3, fontSize: 12, fontWeight: 600, color: "var(--ink-2)" } as const;

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        height: 28, padding: "0 12px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer",
        border: `1px solid ${active ? "var(--pu)" : "var(--bd-3)"}`,
        background: active ? "var(--pu-soft)" : "var(--bg-1)",
        color: active ? "var(--pu-deep)" : "var(--ink-2)",
      }}
    >
      {children}
    </button>
  );
}

/** Find a member by name or card number and filter the log to them. */
function MemberFilter({ memberName, active, onPick }: { memberName: string; active: boolean; onPick: (member: Member | null) => void }) {
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<Member[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const find = async () => {
    const search = text.trim();
    if (!search) return;
    setBusy(true);
    setMessage("");
    try {
      const page = await listMembers({ search, page_size: 8 }, { silent401: true });
      setMatches(page.results);
      if (page.results.length === 0) setMessage("No member matches.");
    } catch (err) {
      setMessage(refusalMessage(err, "Could not search members."));
    } finally {
      setBusy(false);
    }
  };

  if (active) {
    return (
      <div style={labelText}>
        Member
        <span style={{ display: "flex", gap: 6, alignItems: "center", height: 36, fontSize: 13, color: "var(--ink-1)" }}>
          {memberName}
          <Btn small variant="ghost" onClick={() => { onPick(null); setMatches([]); setText(""); }}>Remove</Btn>
        </span>
      </div>
    );
  }
  return (
    <div style={labelText}>
      Member
      <span style={{ display: "flex", gap: 6 }}>
        <input
          aria-label="Find member"
          style={{ ...inputStyle, width: 180 }}
          placeholder="Name or card number"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void find();
            }
          }}
        />
        <Btn onClick={find} disabled={busy || !text.trim()}>Find</Btn>
        {matches.length > 0 ? (
          <select
            aria-label="Choose member"
            style={{ ...inputStyle, width: 220 }}
            value=""
            onChange={(e) => {
              const member = matches.find((m) => String(m.id) === e.target.value);
              if (member) {
                onPick(member);
                setMatches([]);
              }
            }}
          >
            <option value="">Choose a member</option>
            {matches.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name} ({m.card_no})</option>
            ))}
          </select>
        ) : null}
      </span>
      {message ? <span style={{ fontSize: 11, color: "var(--ink-3)", fontWeight: 400 }}>{message}</span> : null}
    </div>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Transactions and logs</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Everything that changed in the library, newest first. Rows cannot be edited or deleted.</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{actions}</div>
      </div>
      {children}
    </div>
  );
}

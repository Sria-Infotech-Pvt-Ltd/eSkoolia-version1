"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listMembers } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistentPagination } from "@/hooks/usePersistentPagination";
import type { Member, MemberListParams, MemberType, RegistrationStatus, Standing } from "@/types/library";
import { Btn, describeError, inputStyle, Pill, SkeletonRows, StateBox, tdStyle, thStyle, useToast } from "../catalogue/ui";
import { DuesDrawer } from "./DuesDrawer";
import { MEMBER_TYPE_LABEL, REGISTRATION_PILL, STANDING_PILL } from "./memberHelpers";
import { RegisterMemberModal } from "./RegisterMemberModal";

type RoleChip = "" | MemberType;

const CHIPS: { value: RoleChip; label: string }[] = [
  { value: "", label: "All" },
  { value: "student", label: "Students" },
  { value: "teacher", label: "Teachers" },
  { value: "staff", label: "Staff" },
];

export function MembersPage() {
  const { me, can } = usePermissions();
  const { page, pageSize, setPage, setPageSize } = usePersistentPagination("library-members", 1, 25);
  const [chip, setChip] = useState<RoleChip>("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [standing, setStanding] = useState<Standing | "">("");
  const [registration, setRegistration] = useState<RegistrationStatus | "">("");
  const [rows, setRows] = useState<Member[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [registering, setRegistering] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const { show, node: toastNode } = useToast();
  const latest = useRef(0);
  const canView = can("library.library_members.view");

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError("");
    const params: MemberListParams = {
      page,
      page_size: pageSize,
      search: debounced.trim() || undefined,
      member_type: chip || undefined,
      standing: standing || undefined,
      registration: registration || undefined,
    };
    try {
      const data = await listMembers(params);
      if (ticket !== latest.current) return;
      setRows(data.results);
      setCount(data.count);
    } catch (err) {
      if (ticket !== latest.current) return;
      if ((err as { status?: number }).status === 404 && page > 1) {
        setPage(1);
        return;
      }
      setError(describeError(err, "Could not load the members."));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chip, debounced, standing, registration, page, pageSize]);

  useEffect(() => {
    if (me && canView) void load();
  }, [me, canView, load]);

  const reset = () => setPage(1);

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={6} />
      </Shell>
    );
  }
  if (!canView) {
    return (
      <Shell>
        <StateBox title="You do not have access to library members">Ask an administrator to give your role the library members view permission.</StateBox>
      </Shell>
    );
  }

  const pages = Math.max(1, Math.ceil(count / pageSize));
  const filtered = Boolean(debounced || chip || standing || registration);

  return (
    <Shell
      actions={
        can("library.library_members.create") ? (
          <Btn variant="primary" onClick={() => setRegistering(true)}>
            Register member
          </Btn>
        ) : null
      }
    >
      <div role="group" aria-label="Member type" style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={chip === c.value}
            onClick={() => { setChip(c.value); reset(); }}
            style={{
              padding: "5px 14px", borderRadius: 999, cursor: "pointer", fontSize: 13, fontWeight: 600, border: "1px solid var(--bd-3)",
              background: chip === c.value ? "var(--pu)" : "var(--bg-1)", color: chip === c.value ? "var(--bg-1)" : "var(--ink-1)",
            }}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div role="search" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 14 }}>
        <input aria-label="Search members" style={inputStyle} placeholder="Search name or card number" value={search} onChange={(e) => { setSearch(e.target.value); reset(); }} />
        <select aria-label="Standing" style={inputStyle} value={standing} onChange={(e) => { setStanding(e.target.value as Standing | ""); reset(); }}>
          <option value="">Any standing</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
        <select aria-label="Registration fee" style={inputStyle} value={registration} onChange={(e) => { setRegistration(e.target.value as RegistrationStatus | ""); reset(); }}>
          <option value="">Any registration fee</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="waived">Waived</option>
        </select>
      </div>

      {error ? (
        <StateBox tone="danger" title="Could not load the members">
          {error} <Btn small onClick={load}>Retry</Btn>
        </StateBox>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: "4px 8px" }}>
          {loading ? (
            <SkeletonRows rows={8} columns={7} />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Member</th>
                  <th style={thStyle}>Class</th>
                  <th style={thStyle}>Card</th>
                  <th style={thStyle}>Books out</th>
                  <th style={thStyle}>Registration fee</th>
                  <th style={thStyle}>Total dues</th>
                  <th style={thStyle}>Standing</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((member) => {
                  const reg = REGISTRATION_PILL[member.registration_status];
                  const stand = STANDING_PILL[member.standing];
                  return (
                    <tr key={member.id} onClick={() => setOpenId(member.id)} style={{ cursor: "pointer" }} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpenId(member.id)}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>
                          {member.display_name}
                          {!member.is_active ? <span style={{ marginLeft: 6 }}><Pill>Inactive</Pill></span> : null}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{MEMBER_TYPE_LABEL[member.member_type]}</div>
                      </td>
                      <td style={tdStyle}>{member.school_class ? `${member.school_class}${member.section ? ` ${member.section}` : ""}` : "-"}</td>
                      <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontSize: 12 }}>{member.card_no}</td>
                      <td style={tdStyle}>
                        {member.active_loans} of {member.borrowing_limit}
                      </td>
                      <td style={tdStyle}>
                        <Pill tone={reg.tone}>{reg.label}</Pill>
                      </td>
                      <td style={tdStyle}>{member.total_dues}</td>
                      <td style={tdStyle}>
                        <Pill tone={stand.tone}>{stand.label}</Pill>
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>
                      {filtered ? (
                        <>
                          No members match this filter.{" "}
                          <Btn small variant="ghost" onClick={() => { setChip(""); setSearch(""); setStanding(""); setRegistration(""); reset(); }}>
                            Clear filters
                          </Btn>
                        </>
                      ) : (
                        "No library members yet. Register the first one."
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
          <span>{count} member{count === 1 ? "" : "s"}</span>
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

      {registering ? (
        <RegisterMemberModal
          canCollect={can("library.charges.collect")}
          onClose={() => setRegistering(false)}
          onRegistered={(name) => {
            setRegistering(false);
            show(`${name} registered`);
            void load();
          }}
        />
      ) : null}
      {openId !== null ? <DuesDrawer memberId={openId} can={can} onClose={() => setOpenId(null)} onChanged={() => void load()} notify={show} /> : null}
      {toastNode}
    </Shell>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Library members</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Students, teachers and staff who can borrow, with their fees and standing</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{actions}</div>
      </div>
      {children}
    </div>
  );
}

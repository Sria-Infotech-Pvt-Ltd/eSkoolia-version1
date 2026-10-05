"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiRequestWithRefresh } from "@/lib/api-auth";
import { TopToast } from "@/components/common/TopToast";
import { buildPaginationQuery, extractListData, extractPaginationMeta, type ListApiResponse } from "@/lib/pagination";
import { ConfirmationModal } from "@/components/common/ConfirmationModal";
import { usePersistentPagination } from "@/hooks/usePersistentPagination";

type PortalType = 'admin' | 'teacher' | 'parent' | 'student' | 'custom';

type RoleItem = {
  id: number;
  name: string;
  is_system: boolean;
  is_active: boolean;
  portal_type: PortalType;
  created_at: string;
};

const PORTAL_OPTIONS: { value: PortalType; label: string; description: string }[] = [
  { value: 'admin',   label: 'Admin Console',   description: 'School admin / management staff' },
  { value: 'teacher', label: 'Teacher Portal',  description: 'Teachers and class teachers' },
  { value: 'parent',  label: 'Parent Portal',   description: 'Parents and guardians' },
  { value: 'student', label: 'Student Portal',  description: 'Enrolled students' },
  { value: 'custom',  label: 'Custom',          description: 'Configurable access via permissions' },
];

const PORTAL_BADGE: Record<PortalType, { label: string; bg: string; color: string }> = {
  admin:   { label: 'Admin',   bg: '#EEF2FF', color: '#4338CA' },
  teacher: { label: 'Teacher', bg: '#EEEAFF', color: '#6D4AFF' },
  parent:  { label: 'Parent',  bg: '#FFF1F2', color: '#BE123C' },
  student: { label: 'Student', bg: '#E0F2FE', color: '#0369A1' },
  custom:  { label: 'Custom',  bg: '#F1F5F9', color: '#475569' },
};

/** Deterministic background colour per role name — no hardcoding */
function getRoleColor(name: string): string {
  const palette = [
    "#F3E8FF", "#EFF6FF", "#DCFCE7", "#FEF9C3",
    "#EEEAFF", "#FEF3C7", "#E0F2FE", "#FCE7F3", "#FEF2F2", "#D1FAE5",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

type PanelMode = "add" | "edit" | null;

/** At most 4 columns (as before), dropping to fewer when the editor panel narrows the
 *  card area — prevents the grid overflowing its container and painting over the panel. */
const ROLE_GRID_COLUMNS = "repeat(auto-fill, minmax(max(200px, calc((100% - 32px) / 4)), 1fr))";

export function RoleManagementPanel() {
  const router = useRouter();
  const { page, pageSize, setPage, setPageSize } = usePersistentPagination("roles.list", 1, 10);
  const [roles, setRoles] = useState<RoleItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [deleteCandidate, setDeleteCandidate] = useState<RoleItem | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const [roleName, setRoleName] = useState("");
  const [editingRoleId, setEditingRoleId] = useState<number | null>(null);
  const [editingRoleIsActive, setEditingRoleIsActive] = useState(true);
  const [editingPortalType, setEditingPortalType] = useState<PortalType>('admin');
  const [search, setSearch] = useState("");

  const [panelMode, setPanelMode] = useState<PanelMode>(null);
  const [showInactive, setShowInactive] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const loadRoles = async (targetPage = page, targetPageSize = pageSize) => {
    setLoading(true);
    setError("");
    try {
      const query = buildPaginationQuery(targetPage, targetPageSize, { search: search.trim() || undefined });
      const qs = `${query}&minimal=1&show_inactive=1`;
      const data = await apiRequestWithRefresh<ListApiResponse<RoleItem>>(`/api/v1/access-control/roles/?${qs}`);
      const items = extractListData(data);
      const meta = extractPaginationMeta(data);
      setRoles(items);
      setTotalCount(meta?.count ?? items.length);
    } catch {
      setError("Unable to load role list.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handle = window.setTimeout(() => { void loadRoles(); }, 250);
    return () => window.clearTimeout(handle);
  }, [page, pageSize, search, showInactive]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const resetForm = () => {
    setEditingRoleId(null);
    setRoleName("");
    setEditingRoleIsActive(true);
    setEditingPortalType('admin');
    setFieldError("");
  };

  const closePanel = () => {
    setPanelMode(null);
    resetForm();
    setError("");
    setSuccess("");
  };

  const openAddPanel = () => {
    resetForm();
    setPanelMode("add");
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const openEditPanel = (row: RoleItem) => {
    setEditingRoleId(row.id);
    setRoleName(row.name);
    setEditingRoleIsActive(row.is_active);
    setEditingPortalType((row.portal_type as PortalType) || 'admin');
    setFieldError("");
    setSuccess("");
    setPanelMode("edit");
    setTimeout(() => nameInputRef.current?.focus(), 50);
  };

  const isValidRoleName = (value: string) => /^[A-Za-z ]+$/.test(value);
  /** True when 3+ of the same letter appear consecutively (e.g. "www", "Staffff") */
  const hasRepeatedChars = (value: string) => /(.)(\1){2,}/i.test(value);
  const MAX_NAME = 30;

  const toggleActive = async (role: RoleItem) => {
    try {
      setError("");
      await apiRequestWithRefresh(`/api/v1/access-control/roles/${role.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !role.is_active }),
      });
      setRoles((prev) => prev.map((r) => r.id === role.id ? { ...r, is_active: !role.is_active } : r));
      setSuccess(role.is_active ? `"${role.name}" deactivated.` : `"${role.name}" activated.`);
    } catch {
      setError("Unable to update role status.");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const normalized = roleName.trim();
    if (!normalized) {
      setFieldError("Role name is required.");
      return;
    }
    if (normalized.length > MAX_NAME) {
      setFieldError(`Role name cannot exceed ${MAX_NAME} characters.`);
      return;
    }
    if (!isValidRoleName(normalized)) {
      setFieldError("Only letters and spaces are allowed. No numbers or special characters.");
      return;
    }
    if (hasRepeatedChars(normalized)) {
      setFieldError("Avoid repeating the same letter more than twice (e.g. \"wwwwww\")");
      return;
    }
    try {
      setSaving(true);
      setError("");
      setSuccess("");
      setFieldError("");
      const isUpdate = editingRoleId !== null;
      const res = await apiRequestWithRefresh<{ id?: number; data?: { id: number } }>(`/api/v1/access-control/roles/${isUpdate ? `${editingRoleId}/` : ""}`, {
        method: isUpdate ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isUpdate
            ? { name: normalized, is_active: editingRoleIsActive, portal_type: editingPortalType }
            : { name: normalized, portal_type: editingPortalType }
        ),
      });
      setSuccess(isUpdate ? `"${normalized}" updated.` : `"${normalized}" created.`);
      closePanel();
      if (!isUpdate) {
        const newId = (res as { data?: { id: number } }).data?.id ?? (res as { id?: number }).id;
        if (newId) {
          router.push(`/roles/assign-permission?roleId=${newId}`);
          return;
        }
      }
      await loadRoles(page, pageSize);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to save role.";
      setError(message);
      if (message.toLowerCase().includes("name")) setFieldError(message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      setDeletingId(id);
      setError("");
      setSuccess("");
      await apiRequestWithRefresh(`/api/v1/access-control/roles/${id}/`, { method: "DELETE" });
      if (editingRoleId === id) resetForm();
      setSuccess("Role deleted.");
      const nextRoles = roles.filter((row) => row.id !== id);
      const nextPage = nextRoles.length === 0 && page > 1 ? page - 1 : page;
      if (nextPage !== page) setPage(nextPage);
      await loadRoles(nextPage, pageSize);
    } catch {
      setError("Unable to delete role.");
    } finally {
      setDeletingId(null);
      setDeleteCandidate(null);
    }
  };

  return (
    <section style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 40px" }}>

      {/* ── Page header ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--ink-1)" }}>
            Role{" "}
            <em style={{ color: "var(--pu)", fontStyle: "italic", fontWeight: 300 }}>Permission</em>
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--ink-3)" }}>
            Define roles and control which pages each role can access
          </p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          {/* Show inactive toggle */}
          <button
            type="button"
            onClick={() => { setShowInactive((v) => !v); setPage(1); }}
            style={{
              height: 36, padding: "0 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${showInactive ? "var(--pu)" : "var(--bd)"}`,
              background: showInactive ? "var(--pu-soft)" : "var(--bg-1)",
              color: showInactive ? "var(--pu)" : "var(--ink-3)",
            }}
          >
            {showInactive ? "● Showing all" : "○ Active only"}
          </button>
          {/* Search */}
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--ink-3)", pointerEvents: "none" }}>🔍</span>
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search roles…"
              style={{
                paddingLeft: 30, paddingRight: 12, height: 36,
                border: "1px solid var(--bd)", borderRadius: 8,
                fontSize: 12, color: "var(--ink-1)", background: "var(--bg-1)",
                outline: "none", width: 200,
              }}
              onFocus={(e) => (e.target.style.borderColor = "var(--pu)")}
              onBlur={(e) => (e.target.style.borderColor = "var(--bd)")}
            />
          </div>
          <button
            type="button"
            onClick={openAddPanel}
            style={{
              height: 36, background: "var(--pu)", color: "#fff",
              border: "none", borderRadius: 8, padding: "0 16px",
              fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}
          >
            + New Role
          </button>
        </div>
      </div>

      {/* ── Toast notifications ── */}
      {error && <TopToast message={error} tone="error" onClose={() => setError("")} />}
      {success && <TopToast message={success} tone="success" onClose={() => setSuccess("")} />}

      {/* ── Split layout: cards + editor panel ── */}
      <div className="role-split" style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>

        {/* ── Role cards ── */}
        <div style={{
          flex: 1, minWidth: 0,
          background: "var(--bg-1)", border: "1px solid var(--bd)",
          borderRadius: 14, boxShadow: "var(--sh-2)", padding: 20,
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
            All Roles{!loading ? ` · ${totalCount} defined` : ""}
          </div>

          {loading ? (
            <div style={{ display: "grid", gridTemplateColumns: ROLE_GRID_COLUMNS, gap: 8 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ height: 54, borderRadius: 10, background: "var(--bg-2)", animation: "pulse 1.5s ease-in-out infinite" }} />
              ))}
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: ROLE_GRID_COLUMNS, gap: 8 }}>

              {roles.map((role) => {
                const isSelected = panelMode === "edit" && editingRoleId === role.id;
                const bgColor = getRoleColor(role.name);
                return (
                  <div
                    key={role.id}
                    style={{
                      border: `1.5px solid ${isSelected ? "var(--pu)" : "var(--bd)"}`,
                      borderRadius: 10, padding: "10px 108px 10px 12px",
                      background: isSelected ? "#FAFAFF" : "var(--bg-1)",
                      cursor: "pointer", position: "relative",
                      display: "flex", alignItems: "center", gap: 10,
                      transition: "border-color 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.borderColor = "#C4B5FD";
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.borderColor = "var(--bd)";
                    }}
                  >
                    {/* Inactive overlay badge */}
                    {!role.is_active && (
                      <span style={{
                        position: "absolute", top: 4, left: 4,
                        background: "#FEE2E2", color: "#DC2626",
                        fontSize: 9, fontWeight: 700, borderRadius: 4,
                        padding: "1px 5px", letterSpacing: "0.05em", textTransform: "uppercase",
                      }}>Inactive</span>
                    )}

                    {/* Icon: first letter, deterministic colour */}
                    <div style={{
                      width: 30, height: 30, borderRadius: 8, flexShrink: 0,
                      background: bgColor, opacity: role.is_active ? 1 : 0.45,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 700, color: "var(--ink-2)",
                    }}>
                      {role.name.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ flex: 1, minWidth: 0, opacity: role.is_active ? 1 : 0.55 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {role.name}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 3 }}>
                        {role.portal_type && PORTAL_BADGE[role.portal_type as PortalType] && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                            padding: "1px 5px", borderRadius: 4,
                            background: PORTAL_BADGE[role.portal_type as PortalType].bg,
                            color: PORTAL_BADGE[role.portal_type as PortalType].color,
                            textTransform: "uppercase",
                          }}>
                            {PORTAL_BADGE[role.portal_type as PortalType].label}
                          </span>
                        )}
                        <span style={{ fontSize: 10, color: "var(--ink-3)" }}>
                          {role.is_system ? "System" : "Custom"}
                        </span>
                      </div>
                    </div>

                    {/* Row actions */}
                    <div
                      className="role-row-actions"
                      style={{ position: "absolute", top: 6, right: 6, display: "flex", gap: 4 }}
                    >
                      <button
                        type="button"
                        title="Assign permissions"
                        onClick={(e) => { e.stopPropagation(); router.push(`/roles/assign-permission?roleId=${role.id}`); }}
                        style={{ width: 22, height: 22, borderRadius: 5, border: "none", background: "var(--pu-soft)", color: "var(--pu)", cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      >
                        🔑
                      </button>
                      <button
                        type="button"
                        title="Edit role"
                        onClick={(e) => { e.stopPropagation(); openEditPanel(role); }}
                        style={{ width: 22, height: 22, borderRadius: 5, border: "none", background: "var(--bg-2)", color: "var(--pu)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >✏</button>
                      <button
                        type="button"
                        title={role.is_active ? "Deactivate role" : "Activate role"}
                        onClick={(e) => { e.stopPropagation(); void toggleActive(role); }}
                        style={{ width: 22, height: 22, borderRadius: 5, border: "none", background: role.is_active ? "#FEF3C7" : "#DCFCE7", color: role.is_active ? "#92400E" : "#166534", cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
                      >{role.is_active ? "⏸" : "▶"}</button>
                      {!role.is_system && (
                        <button
                          type="button"
                          title="Delete role"
                          onClick={(e) => { e.stopPropagation(); setDeleteCandidate(role); }}
                          style={{ width: 22, height: 22, borderRadius: 5, border: "none", background: "#FEF2F2", color: "var(--err)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center" }}
                        >🗑</button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add New Role dashed card */}
              <div
                onClick={openAddPanel}
                style={{
                  border: "1.5px dashed var(--bd)", borderRadius: 10,
                  padding: "10px 12px", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: 10,
                  color: "var(--ink-3)", fontSize: 12, background: "transparent",
                  transition: "border-color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--pu)"; e.currentTarget.style.color = "var(--pu)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--bd)"; e.currentTarget.style.color = "var(--ink-3)"; }}
              >
                <div style={{ width: 30, height: 30, borderRadius: 8, border: "1.5px dashed var(--bd)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>+</div>
                Add New Role
              </div>

              {roles.length === 0 && !loading && (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "32px 24px", color: "var(--ink-3)", fontSize: 13 }}>
                  No roles found{search ? ` matching "${search}"` : ""}. Create your first role.
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 12, fontSize: 11, color: "var(--ink-2)", background: "var(--bg-2)", borderRadius: 8, padding: "8px 12px" }}>
            <strong style={{ color: "var(--ink-1)" }}>🔑 assign permissions</strong> · <strong style={{ color: "var(--ink-1)" }}>✏ edit</strong> · <strong style={{ color: "var(--ink-1)" }}>🗑 delete</strong>
          </div>

          {/* Pagination — only shown when there are multiple pages */}
          {totalPages > 1 && (
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: "var(--ink-3)" }}>
              <span>Showing {roles.length} of {totalCount}</span>
              <div style={{ display: "flex", gap: 6 }}>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPage(p)}
                    style={{
                      width: 28, height: 28, borderRadius: 6, border: "1px solid var(--bd)",
                      background: p === page ? "var(--pu)" : "var(--bg-1)",
                      color: p === page ? "#fff" : "var(--ink-2)",
                      cursor: "pointer", fontSize: 12, fontWeight: p === page ? 600 : 400,
                    }}
                  >{p}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Slide-in editor panel ── */}
        {panelMode !== null && (
          <div className="role-editor" style={{
            width: 290, flexShrink: 0,
            border: "1.5px solid var(--pu)", borderRadius: 10,
            background: "#FAFAFF", overflow: "hidden",
            boxShadow: "var(--sh-2)",
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 14px",
              background: panelMode === "add" ? "var(--pu-soft)" : "#EFF6FF",
              borderBottom: "1px solid #C4B5FD",
            }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--pu-deep)" }}>
                {panelMode === "add" ? "+ New Role" : "✏ Edit Role"}
              </span>
              <button
                type="button"
                onClick={closePanel}
                style={{ background: "none", border: "none", fontSize: 18, color: "var(--ink-3)", cursor: "pointer", lineHeight: 1 }}
              >×</button>
            </div>

            {/* Body */}
            <form onSubmit={submit}>
              <div style={{ padding: 14 }}>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>
                    Role Name *
                  </label>
                  <input
                    ref={nameInputRef}
                    value={roleName}
                    onChange={(e) => {
                      // Strip numbers and special characters as user types
                      const cleaned = e.target.value.replace(/[^A-Za-z ]/g, "").slice(0, MAX_NAME);
                      setRoleName(cleaned);
                      // Real-time repeated-char hint
                      if (hasRepeatedChars(cleaned)) {
                        setFieldError("Avoid repeating the same letter more than twice (e.g. \"wwwwww\")");
                      } else if (fieldError) {
                        setFieldError("");
                      }
                    }}
                    placeholder="e.g. Sports Coordinator"
                    maxLength={MAX_NAME}
                    style={{
                      width: "100%", padding: "8px 10px",
                      border: `1px solid ${fieldError ? "var(--err)" : "var(--bd)"}`,
                      borderRadius: 8, fontSize: 12, color: "var(--ink-1)",
                      background: "var(--bg-1)", outline: "none", fontFamily: "inherit",
                      boxShadow: fieldError ? "0 0 0 2px rgba(224,70,58,0.1)" : "none",
                    }}
                    onFocus={(e) => { if (!fieldError) e.target.style.borderColor = "var(--pu)"; e.target.style.boxShadow = "0 0 0 2px rgba(109,74,255,0.1)"; }}
                    onBlur={(e) => { if (!fieldError) e.target.style.borderColor = "var(--bd)"; e.target.style.boxShadow = "none"; }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                    {fieldError
                      ? <span style={{ fontSize: 11, color: "var(--err)" }}>{fieldError}</span>
                      : <span style={{ fontSize: 11, color: "var(--ink-3)" }}>Letters and spaces only</span>
                    }
                    <span style={{ fontSize: 11, color: roleName.length >= MAX_NAME ? "var(--err)" : "var(--ink-3)" }}>
                      {roleName.length}/{MAX_NAME}
                    </span>
                  </div>
                </div>

                {/* Portal type — always shown so admins make a deliberate choice */}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>
                    Portal <span style={{ color: "var(--err)", fontWeight: 400, letterSpacing: 0, textTransform: "none" }}>*</span>
                  </label>
                  <select
                    value={editingPortalType}
                    onChange={(e) => setEditingPortalType(e.target.value as PortalType)}
                    style={{
                      width: "100%", padding: "8px 10px",
                      border: "1px solid var(--bd)", borderRadius: 8,
                      fontSize: 12, color: "var(--ink-1)", background: "var(--bg-1)",
                      outline: "none", fontFamily: "inherit", cursor: "pointer",
                    }}
                    onFocus={(e) => (e.target.style.borderColor = "var(--pu)")}
                    onBlur={(e) => (e.target.style.borderColor = "var(--bd)")}
                  >
                    {PORTAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label} — {opt.description}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize: 10, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.4 }}>
                    Controls which portal users with this role are sent to after login.
                  </p>
                </div>

                {panelMode === "edit" && (
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ fontSize: 10, fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 5 }}>
                      Status
                    </label>
                    <button
                      type="button"
                      onClick={() => setEditingRoleIsActive((v) => !v)}
                      style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: "6px 12px", borderRadius: 8,
                        border: `1px solid ${editingRoleIsActive ? "#16a34a" : "#dc2626"}`,
                        background: editingRoleIsActive ? "#dcfce7" : "#fee2e2",
                        color: editingRoleIsActive ? "#166534" : "#dc2626",
                        fontSize: 12, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      {editingRoleIsActive ? "● Active" : "○ Inactive"}
                    </button>
                  </div>
                )}
                <div style={{ background: "var(--bg-2)", borderRadius: 8, padding: "8px 10px", fontSize: 11, color: "var(--ink-2)" }}>
                  {panelMode === "add"
                    ? <>Set the <strong style={{ color: "var(--ink-1)" }}>Portal</strong> above first — it cannot be inferred from the name. Then use 🔑 to assign permissions.</>
                    : "Changing portal type affects where existing users with this role are redirected after login."}
                </div>
              </div>

              {/* Footer */}
              <div style={{ display: "flex", gap: 8, padding: "12px 14px", borderTop: "1px solid var(--bd)", background: "var(--bg-1)" }}>
                <button
                  type="button"
                  onClick={closePanel}
                  style={{ flex: 1, padding: "7px 14px", borderRadius: 8, border: "1px solid var(--bd)", background: "var(--bg-1)", color: "var(--ink-2)", fontSize: 11, cursor: "pointer" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  style={{ flex: 1, padding: "7px 14px", borderRadius: 8, border: "none", background: saving ? "var(--ink-3)" : "var(--pu)", color: "#fff", fontSize: 11, fontWeight: 600, cursor: saving ? "not-allowed" : "pointer" }}
                >
                  {saving ? "Saving…" : panelMode === "add" ? "Create Role" : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        )}

      </div>

      {/* ── Delete confirmation modal (existing, untouched) ── */}
      <ConfirmationModal
        isOpen={deleteCandidate !== null}
        title="Delete Role"
        message={`Are you sure you want to delete "${deleteCandidate?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isConfirming={deletingId !== null}
        onConfirm={() => (deleteCandidate ? void remove(deleteCandidate.id) : undefined)}
        onCancel={() => setDeleteCandidate(null)}
      />

      <style jsx global>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        /* Narrow screens: stack the editor above the role cards instead of side-by-side */
        @media (max-width: 1024px) {
          .role-split { flex-direction: column; align-items: stretch !important; }
          .role-editor { width: 100% !important; order: -1; }
        }
      `}</style>
    </section>
  );
}

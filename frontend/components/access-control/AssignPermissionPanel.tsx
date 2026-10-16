"use client";

import { useEffect, useMemo, useState } from "react";
import { Manrope, Playfair_Display } from "next/font/google";
import { apiRequestWithRefresh } from "@/lib/api-auth";
import { TopToast } from "@/components/common/TopToast";

const playfairDisplay = Playfair_Display({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-playfair-display",
});
const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-manrope",
});

// ── Types ──────────────────────────────────────────────────────────────────────

interface PermissionNode { id: number; code: string; name: string; selected: boolean; }
interface ModuleNode { module: string; module_name: string; permissions: PermissionNode[]; }
interface PermissionTreeResponse { role: { id: number; name: string } | null; modules: ModuleNode[]; }
type PermAction = "view" | "add" | "edit" | "delete";
interface SubFeatureRow { key: string; label: string; view?: PermissionNode; add?: PermissionNode; edit?: PermissionNode; delete?: PermissionNode; }
type OperationLevel = "none" | "view" | "create_edit" | "full";
interface AssignPermissionPanelProps { roleId: number | string | null | undefined; onBack: () => void; }
interface RoleItem { id: number; name: string; description?: string; is_active?: boolean; is_system?: boolean; }

// ── Constants ──────────────────────────────────────────────────────────────────

const RISKY_MODULES = new Set(["fees", "accounts", "finance", "payroll", "hr", "salary", "admin_section", "access_control"]);
const LEVEL_LABELS: Record<OperationLevel, string> = { none: "", view: "View Only", create_edit: "Create & Edit", full: "Full Control" };

// ── Helpers ────────────────────────────────────────────────────────────────────

function prettyModuleName(module: string): string {
  const overrides: Record<string, string> = {
    academics: "Academics", fees: "Fees", hr: "HR", transport: "Transport",
    inventory: "Inventory", admissions: "Admissions", admin_section: "Administration",
    access_control: "Roles & Access", students: "Students", timetable: "Timetable",
    communication: "Communication", accounts: "Accounts", library: "Library",
    examination: "Examination", behaviour: "Behaviour", reports: "Reports",
    dashboard: "Dashboard", payroll: "Payroll", finance: "Finance",
  };
  return overrides[module] ?? module.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Permission code format: "module.feature.action" (e.g. "admin_section.admission_query.view")
// Last segment = action ("view" | "add" | "edit" | "delete" | "manage" | "read")
// Second-to-last segment = feature key (e.g. "admission_query")
function getActionFromCode(code: string): string {
  const parts = code.split(".");
  return parts[parts.length - 1] ?? "view";
}

function getFeatureKey(code: string): string {
  const parts = code.split(".");
  // 3+ parts: module.feature.action → return feature
  // 2 parts: module.action → return module (single-perm feature like "dashboard.view")
  // 1 part: return as-is
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) return parts[0];
  return parts[0];
}

function prettySubFeatureName(featureKey: string): string {
  return featureKey.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Real format: module.feature.action (last part = action, middle = feature label)
function groupPermsBySubFeature(permissions: PermissionNode[]): SubFeatureRow[] {
  const groups = new Map<string, Partial<Record<PermAction, PermissionNode>>>();

  for (const perm of permissions) {
    const rawAction = getActionFromCode(perm.code);
    const featureKey = getFeatureKey(perm.code);

    let action: PermAction;
    if (rawAction === "add" || rawAction === "create") action = "add";
    else if (rawAction === "edit" || rawAction === "change" || rawAction === "update") action = "edit";
    else if (rawAction === "delete" || rawAction === "remove" || rawAction === "destroy") action = "delete";
    else action = "view"; // "view", "manage", "read", etc.

    if (!groups.has(featureKey)) groups.set(featureKey, {});
    const entry = groups.get(featureKey);
    if (entry) entry[action] = perm;
  }

  return Array.from(groups.entries()).map(([key, acts]) => ({
    key,
    label: prettySubFeatureName(key),
    view: acts.view,
    add: acts.add,
    edit: acts.edit,
    delete: acts.delete,
  }));
}

function inferOperationLevel(permissions: PermissionNode[], ids: Set<number>): OperationLevel {
  const selected = permissions.filter((p) => ids.has(p.id));
  if (selected.length === 0) return "none";
  if (selected.some((p) => getActionFromCode(p.code) === "delete")) return "full";
  if (selected.some((p) => { const a = getActionFromCode(p.code); return a === "add" || a === "create" || a === "edit" || a === "change" || a === "update"; })) return "create_edit";
  return "view";
}

function applyOperationLevel(mod: ModuleNode, level: OperationLevel, prevIds: Set<number>, includeDelete = true): Set<number> {
  const next = new Set(prevIds);
  for (const p of mod.permissions) next.delete(p.id);
  if (level === "none") return next;
  const groups = groupPermsBySubFeature(mod.permissions);
  for (const row of groups) {
    if (level === "view") {
      if (row.view) next.add(row.view.id);
    } else if (level === "create_edit") {
      if (row.view) next.add(row.view.id);
      if (row.add)  next.add(row.add.id);
      if (row.edit) next.add(row.edit.id);
    } else {
      if (row.view) next.add(row.view.id);
      if (row.add)  next.add(row.add.id);
      if (row.edit) next.add(row.edit.id);
      if (includeDelete && row.delete) next.add(row.delete.id);
    }
  }
  return next;
}

// ── Style constants ────────────────────────────────────────────────────────────

const thStyle: React.CSSProperties = {
  padding: "8px 12px", textAlign: "center", fontWeight: 600,
  color: "#5B5E72", borderBottom: "2px solid #E8E8EE", background: "#F5F5FB",
  whiteSpace: "nowrap", fontSize: "12px", textTransform: "uppercase" as const, letterSpacing: "0.05em",
};
const tdStyle: React.CSSProperties = { padding: "10px 12px", textAlign: "center" };

// ── ModuleList ─────────────────────────────────────────────────────────────────

interface ModuleListProps {
  modules: ModuleNode[];
  enabledModules: Set<string>;
  activeModule: string | null;
  operationLevels: Record<string, OperationLevel>;
  selectedIds: Set<number>;
  roleData: { id: number; name: string } | null;
  allRoles: RoleItem[];
  showRoleSwitcher: boolean;
  showNewRoleForm: boolean;
  newRoleName: string;
  newRoleDesc: string;
  creatingRole: boolean;
  activeRoleId: number | string;
  onToggle: (moduleKey: string, mod: ModuleNode) => void;
  onSelect: (moduleKey: string) => void;
  onToggleRoleSwitcher: () => void;
  onToggleNewRoleForm: () => void;
  onSwitchRole: (id: number) => void;
  onNewRoleNameChange: (v: string) => void;
  onNewRoleDescChange: (v: string) => void;
  onCreateRole: () => void;
}

function ModuleList(props: ModuleListProps) {
  const {
    modules, enabledModules, activeModule, operationLevels, selectedIds,
    roleData, allRoles, showRoleSwitcher, showNewRoleForm, newRoleName, newRoleDesc,
    creatingRole, activeRoleId, onToggle, onSelect, onToggleRoleSwitcher,
    onToggleNewRoleForm, onSwitchRole, onNewRoleNameChange, onNewRoleDescChange, onCreateRole,
  } = props;

  return (
    <div style={{ width: "38%", minWidth: "240px", background: "#FFFFFF", border: "1px solid #E8E8EE", borderRadius: "14px", overflow: "hidden", flexShrink: 0 }}>

      {/* ── Role Card ── */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #E8E8EE", background: "linear-gradient(135deg, #EDE9FF 0%, #F5F5FB 100%)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: "10px", fontWeight: 700, color: "#6D4AFF", textTransform: "uppercase", letterSpacing: "0.07em" }}>ACTIVE ROLE</p>
            <p style={{ margin: "2px 0 0", fontWeight: 700, fontSize: "15px", color: "#15172A", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {roleData?.name ?? "…"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
            <button type="button" onClick={onToggleRoleSwitcher} title="Switch role" style={{
              padding: "4px 10px", borderRadius: "6px", border: "1.5px solid #C4BBFF",
              background: showRoleSwitcher ? "#6D4AFF" : "#fff", color: showRoleSwitcher ? "#fff" : "#6D4AFF",
              fontSize: "11px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
            }}>Switch ⇅</button>
            <button type="button" onClick={onToggleNewRoleForm} title="Create new role" style={{
              padding: "4px 10px", borderRadius: "6px", border: "1.5px solid #C4BBFF",
              background: showNewRoleForm ? "#6D4AFF" : "#fff", color: showNewRoleForm ? "#fff" : "#6D4AFF",
              fontSize: "11px", fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
            }}>＋ New</button>
          </div>
        </div>

        {/* Role switcher list */}
        {showRoleSwitcher && (
          <div style={{ marginTop: "10px", borderTop: "1px solid #D8D4FF", paddingTop: "10px", maxHeight: "180px", overflowY: "auto" }}>
            {allRoles.length === 0 && <p style={{ margin: 0, fontSize: "12px", color: "#9A9DB0" }}>No other roles found</p>}
            {allRoles.map((r) => (
              <div key={r.id} onClick={() => onSwitchRole(r.id)} style={{
                padding: "7px 10px", borderRadius: "7px", cursor: "pointer", marginBottom: "2px",
                background: r.id === Number(activeRoleId) ? "#EEEAFF" : "transparent",
                display: "flex", alignItems: "center", gap: "8px",
              }}>
                <span style={{ width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                  background: r.id === Number(activeRoleId) ? "#6D4AFF" : "#C4C4C4" }} />
                <span style={{ fontSize: "13px", fontWeight: r.id === Number(activeRoleId) ? 700 : 400, color: "#15172A" }}>{r.name}</span>
              </div>
            ))}
          </div>
        )}

        {showNewRoleForm && (
          <div style={{ marginTop: "10px", borderTop: "1px solid #D8D4FF", paddingTop: "10px" }}>
            <input type="text" placeholder="Role name *" value={newRoleName}
              onChange={(e) => onNewRoleNameChange(e.target.value.replace(/[^A-Za-z ]/g, ""))}
              style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1.5px solid #D8D4FF", fontSize: "13px", marginBottom: "6px", boxSizing: "border-box", outline: "none" }} />
            <select value={newRoleDesc} onChange={(e) => onNewRoleDescChange(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: "6px", border: "1.5px solid #D8D4FF", fontSize: "13px", marginBottom: "8px", boxSizing: "border-box", outline: "none", background: "#fff", cursor: "pointer" }}>
              <option value="admin">Admin Console</option>
              <option value="teacher">Teacher Portal</option>
              <option value="parent">Parent Portal</option>
              <option value="student">Student Portal</option>
              <option value="custom">Custom</option>
            </select>
            <div style={{ display: "flex", gap: "6px" }}>
              <button type="button" onClick={() => { onNewRoleNameChange(""); onNewRoleDescChange("admin"); onToggleNewRoleForm(); }}
                style={{ flex: 1, padding: "6px", borderRadius: "6px", border: "1px solid #D8D4FF", background: "#fff", color: "#5B5E72", fontSize: "12px", cursor: "pointer" }}>Cancel</button>
              <button type="button" onClick={onCreateRole} disabled={!newRoleName.trim() || creatingRole}
                style={{ flex: 2, padding: "6px", borderRadius: "6px", border: "none", background: !newRoleName.trim() || creatingRole ? "#C4BBFF" : "#6D4AFF", color: "#fff", fontSize: "12px", fontWeight: 600, cursor: !newRoleName.trim() || creatingRole ? "not-allowed" : "pointer" }}>
                {creatingRole ? "Creating…" : "Create & Configure"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Module Access header ── */}
      <div style={{ padding: "12px 18px", borderBottom: "1px solid #E8E8EE", background: "#F5F5FB" }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: "13px", color: "#15172A" }}>Module Access</p>
        <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9A9DB0" }}>Toggle to enable modules for this role</p>
      </div>

      {/* ── Module rows ── */}
      <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 440px)" }}>
        {modules.map((mod) => {
          const isEnabled = enabledModules.has(mod.module);
          const isActive = activeModule === mod.module;
          const level = operationLevels[mod.module] ?? "none";
          const permCount = mod.permissions.length;
          const selectedCount = mod.permissions.filter((p) => selectedIds.has(p.id)).length;
          const isRisky = RISKY_MODULES.has(mod.module);
          return (
            <div key={mod.module} onClick={() => isEnabled && onSelect(mod.module)} style={{
              display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px",
              borderBottom: "1px solid #E8E8EE",
              borderLeft: isActive ? "4px solid #6D4AFF" : "4px solid transparent",
              background: isActive ? "#EEEAFF" : isEnabled ? "#FFFFFF" : "#FAFAFB",
              cursor: isEnabled ? "pointer" : "default", transition: "background 0.15s",
            }}>
              <button role="switch" aria-checked={isEnabled} onClick={(e) => { e.stopPropagation(); onToggle(mod.module, mod); }} style={{
                width: "38px", height: "20px", borderRadius: "10px", border: "none",
                background: isEnabled ? "#6D4AFF" : "#E8E8EE", position: "relative",
                cursor: "pointer", flexShrink: 0, transition: "background 0.2s",
              }} aria-label={`${isEnabled ? "Disable" : "Enable"} ${prettyModuleName(mod.module)}`}>
                <span style={{ position: "absolute", top: "2px", left: isEnabled ? "20px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,.15)" }} />
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "13px", color: isEnabled ? "#15172A" : "#9A9DB0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {prettyModuleName(mod.module)}{isRisky && <span style={{ marginLeft: "5px", fontSize: "10px" }}>⚠️</span>}
                </p>
                {isEnabled && level !== "none" ? (
                  <p style={{ margin: "1px 0 0", fontSize: "11px", color: "#6D4AFF" }}>{LEVEL_LABELS[level]} · {selectedCount}/{permCount}</p>
                ) : (
                  <p style={{ margin: "1px 0 0", fontSize: "11px", color: "#C4C4C4" }}>{permCount} available</p>
                )}
              </div>
              {isEnabled && <span style={{ color: isActive ? "#6D4AFF" : "#C4C4C4", fontSize: "16px" }}>›</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── ModuleConfigPanel ──────────────────────────────────────────────────────────

interface ModuleConfigPanelProps {
  mod: ModuleNode;
  operationLevel: OperationLevel;
  selectedIds: Set<number>;
  onOperationChange: (mod: ModuleNode, level: OperationLevel) => void;
  onPermissionToggle: (permId: number, mod: ModuleNode) => void;
}

function ModuleConfigPanel({ mod, operationLevel, selectedIds, onOperationChange, onPermissionToggle }: ModuleConfigPanelProps) {
  const subFeatures = useMemo(() => groupPermsBySubFeature(mod.permissions), [mod.permissions]);

  const LEVEL_OPTIONS = [
    { value: "view" as OperationLevel, label: "View Only", description: "Can read data but not make changes" },
    { value: "create_edit" as OperationLevel, label: "Create & Edit", description: "Can add new records and edit existing ones" },
    { value: "full" as OperationLevel, label: "Full Control", description: "Can view, create, edit and delete" },
  ];

  return (
    <div style={{ flex: 1, background: "#FFFFFF", border: "1px solid #E8E8EE", borderRadius: "14px", overflow: "hidden", minWidth: 0 }}>
      <div style={{ padding: "14px 22px", borderBottom: "1px solid #E8E8EE", background: "#F5F5FB" }}>
        <p style={{ margin: 0, fontWeight: 700, fontSize: "15px", color: "#15172A" }}>{prettyModuleName(mod.module)}</p>
        <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9A9DB0" }}>{mod.permissions.length} permissions · Configure access level below</p>
      </div>

      <div style={{ padding: "18px 22px", borderBottom: "1px solid #E8E8EE" }}>
        <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: "10px", color: "#5B5E72", textTransform: "uppercase", letterSpacing: "0.07em" }}>Operation Level</p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {LEVEL_OPTIONS.map((opt) => {
            const isSelected = operationLevel === opt.value;
            return (
              <button key={opt.value} type="button" onClick={() => onOperationChange(mod, opt.value)} style={{
                padding: "10px 16px", borderRadius: "10px",
                border: `2px solid ${isSelected ? "#6D4AFF" : "#E8E8EE"}`,
                background: isSelected ? "#EEEAFF" : "#FAFAFB", cursor: "pointer",
                textAlign: "left", transition: "all 0.15s", minWidth: "150px",
              }}>
                <p style={{ margin: 0, fontWeight: 600, fontSize: "13px", color: isSelected ? "#6D4AFF" : "#15172A" }}>
                  {isSelected ? "● " : "○ "}{opt.label}
                </p>
                <p style={{ margin: "3px 0 0", fontSize: "11px", color: "#9A9DB0" }}>{opt.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ padding: "18px 22px" }}>
        <p style={{ margin: "0 0 10px", fontWeight: 700, fontSize: "10px", color: "#5B5E72", textTransform: "uppercase", letterSpacing: "0.07em" }}>Page-Level Access</p>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, textAlign: "left" }}>Feature / Page</th>
                <th style={thStyle}>View</th>
                <th style={thStyle}>Add</th>
                <th style={thStyle}>Edit</th>
                <th style={{ ...thStyle, color: "#dc2626" }}>Delete</th>
              </tr>
            </thead>
            <tbody>
              {subFeatures.map((row) => (
                <tr key={row.key} style={{ borderBottom: "1px solid #F0F0F6" }}>
                  <td style={{ padding: "9px 12px", color: "#15172A", fontWeight: 500 }}>{row.label}</td>
                  {(["view", "add", "edit", "delete"] as PermAction[]).map((action) => {
                    const perm = row[action];
                    if (!perm) return <td key={action} style={tdStyle}><span style={{ color: "#E8E8EE" }}>—</span></td>;
                    const isChecked = selectedIds.has(perm.id);
                    const isDeleteAction = action === "delete";
                    return (
                      <td key={action} style={tdStyle}>
                        <button type="button" onClick={() => onPermissionToggle(perm.id, mod)}
                          aria-label={`${isChecked ? "Remove" : "Grant"} ${action} on ${row.label}`}
                          style={{
                            width: "22px", height: "22px", borderRadius: "5px",
                            border: `2px solid ${isChecked ? (isDeleteAction ? "#dc2626" : "#6D4AFF") : "#E8E8EE"}`,
                            background: isChecked ? (isDeleteAction ? "#dc2626" : "#6D4AFF") : "#FAFAFB",
                            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                            margin: "0 auto", transition: "all 0.12s",
                          }}>
                          {isChecked && <svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {subFeatures.length === 0 && (
                <tr><td colSpan={5} style={{ padding: "20px", textAlign: "center", color: "#9A9DB0", fontSize: "13px" }}>No sub-features found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Modals ─────────────────────────────────────────────────────────────────────

function ModalOverlay({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(15,17,42,0.55)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "20px",
    }}>
      {children}
    </div>
  );
}

interface DeleteConfirmModalProps {
  perm: PermissionNode; featureLabel: string;
  onConfirm: () => void; onCancel: () => void;
}
function DeleteConfirmModal({ perm, featureLabel, onConfirm, onCancel }: DeleteConfirmModalProps) {
  return (
    <ModalOverlay>
      <div style={{ background: "#fff", borderRadius: "16px", padding: "28px", maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginBottom: "16px" }}>
          🗑
        </div>
        <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "16px", color: "#15172A" }}>Confirm Delete Permission</p>
        <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#5B5E72", lineHeight: 1.5 }}>
          You are about to grant <strong>delete</strong> access on <strong>&ldquo;{featureLabel}&rdquo;</strong>.
          Users with this role can <span style={{ color: "#dc2626", fontWeight: 600 }}>permanently delete records</span>. This cannot be undone.
        </p>
        <p style={{ margin: "0 0 20px", fontSize: "12px", color: "#9A9DB0" }}>Permission: <code style={{ background: "#F5F5FB", padding: "2px 5px", borderRadius: "4px" }}>{perm.code}</code></p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1.5px solid #E8E8EE", background: "#fff", color: "#5B5E72", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>Cancel</button>
          <button type="button" onClick={onConfirm} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>Grant Delete Access</button>
        </div>
      </div>
    </ModalOverlay>
  );
}

interface FullControlModalProps {
  moduleName: string; onIncludeDelete: () => void; onExcludeDelete: () => void; onCancel: () => void;
}
function FullControlModal({ moduleName, onIncludeDelete, onExcludeDelete, onCancel }: FullControlModalProps) {
  return (
    <ModalOverlay>
      <div style={{ background: "#fff", borderRadius: "16px", padding: "28px", maxWidth: "440px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "#EEEAFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", marginBottom: "16px" }}>
          🔒
        </div>
        <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "16px", color: "#15172A" }}>Full Control includes Delete</p>
        <p style={{ margin: "0 0 20px", fontSize: "13px", color: "#5B5E72", lineHeight: 1.5 }}>
          You selected <strong>Full Control</strong> for <strong>{moduleName}</strong>. This includes the ability to
          <span style={{ color: "#dc2626", fontWeight: 600 }}> permanently delete records</span>. Include delete permissions?
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button type="button" onClick={onIncludeDelete} style={{ padding: "11px", borderRadius: "8px", border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>Yes, Include Delete</button>
          <button type="button" onClick={onExcludeDelete} style={{ padding: "11px", borderRadius: "8px", border: "1.5px solid #6D4AFF", background: "#EEEAFF", color: "#6D4AFF", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>View + Add + Edit Only (no delete)</button>
          <button type="button" onClick={onCancel} style={{ padding: "11px", borderRadius: "8px", border: "1.5px solid #E8E8EE", background: "#fff", color: "#9A9DB0", fontWeight: 500, fontSize: "13px", cursor: "pointer" }}>Cancel</button>
        </div>
      </div>
    </ModalOverlay>
  );
}

interface RiskyConfirmModalProps {
  riskyList: string[]; onConfirm: () => void; onCancel: () => void;
}
function RiskyConfirmModal({ riskyList, onConfirm, onCancel }: RiskyConfirmModalProps) {
  return (
    <ModalOverlay>
      <div style={{ background: "#fff", borderRadius: "16px", padding: "28px", maxWidth: "440px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
        <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "#FFF7ED", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", marginBottom: "16px" }}>
          ⚠️
        </div>
        <p style={{ margin: "0 0 6px", fontWeight: 700, fontSize: "16px", color: "#15172A" }}>Sensitive Module Access</p>
        <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#5B5E72" }}>You are granting access to sensitive modules:</p>
        <div style={{ background: "#FFF7ED", borderRadius: "8px", padding: "12px 14px", marginBottom: "18px" }}>
          {riskyList.map((m) => (
            <p key={m} style={{ margin: "3px 0", fontSize: "13px", fontWeight: 600, color: "#92400E" }}>
              ⚠️ {prettyModuleName(m)}
            </p>
          ))}
        </div>
        <p style={{ margin: "0 0 20px", fontSize: "12px", color: "#9A9DB0" }}>These modules handle financial or sensitive data. Please confirm this is intentional.</p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "1.5px solid #E8E8EE", background: "#fff", color: "#5B5E72", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>Review Again</button>
          <button type="button" onClick={onConfirm} style={{ flex: 1, padding: "10px", borderRadius: "8px", border: "none", background: "#F59E0B", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>Yes, Save Anyway</button>
        </div>
      </div>
    </ModalOverlay>
  );
}

interface ReviewModalProps {
  modules: ModuleNode[]; enabledModules: Set<string>;
  operationLevels: Record<string, OperationLevel>;
  selectedIds: Set<number>;
  onConfirm: () => void; onCancel: () => void;
}
function ReviewModal({ modules, enabledModules, operationLevels, selectedIds, onConfirm, onCancel }: ReviewModalProps) {
  const enabled = modules.filter((m) => enabledModules.has(m.module));
  return (
    <ModalOverlay>
      <div style={{ background: "#fff", borderRadius: "16px", maxWidth: "560px", width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,.2)" }}>
        <div style={{ padding: "22px 24px", borderBottom: "1px solid #E8E8EE" }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: "17px", color: "#15172A" }}>Review Permissions</p>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#9A9DB0" }}>Please verify the access before saving. Changes apply immediately.</p>
        </div>
        <div style={{ overflowY: "auto", padding: "20px 24px", flex: 1 }}>
          {enabled.length === 0 && <p style={{ color: "#9A9DB0", fontSize: "13px" }}>No modules enabled. Nothing will be saved.</p>}
          {enabled.map((mod) => {
            const level = operationLevels[mod.module] ?? "none";
            const isRisky = RISKY_MODULES.has(mod.module);
            const subFeatures = groupPermsBySubFeature(mod.permissions);
            const grantedRows = subFeatures.filter((row) =>
              (["view", "add", "edit", "delete"] as PermAction[]).some((a) => row[a] && selectedIds.has(row[a]!.id))
            );
            return (
              <div key={mod.module} style={{ marginBottom: "18px", paddingBottom: "16px", borderBottom: "1px solid #F5F5FB" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: "14px", color: "#15172A" }}>{prettyModuleName(mod.module)}</p>
                  <span style={{ padding: "2px 8px", borderRadius: "20px", fontSize: "11px", fontWeight: 600, background: "#EEEAFF", color: "#6D4AFF" }}>{LEVEL_LABELS[level]}</span>
                  {isRisky && <span style={{ fontSize: "12px" }}>⚠️</span>}
                </div>
                {grantedRows.length === 0
                  ? <p style={{ fontSize: "12px", color: "#9A9DB0" }}>No specific permissions selected</p>
                  : <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                      <tbody>
                        {grantedRows.map((row) => {
                          const acts = (["view", "add", "edit", "delete"] as PermAction[])
                            .filter((a) => row[a] && selectedIds.has(row[a]!.id))
                            .map((a) => a.charAt(0).toUpperCase() + a.slice(1));
                          return (
                            <tr key={row.key} style={{ borderBottom: "1px solid #F5F5FB" }}>
                              <td style={{ padding: "4px 6px", color: "#5B5E72", fontWeight: 500, width: "55%" }}>{row.label}</td>
                              <td style={{ padding: "4px 6px" }}>
                                {acts.map((a) => (
                                  <span key={a} style={{ marginRight: "4px", padding: "1px 7px", borderRadius: "10px", fontSize: "11px", fontWeight: 600,
                                    background: a === "Delete" ? "#FEF2F2" : "#EEEAFF",
                                    color: a === "Delete" ? "#dc2626" : "#6D4AFF" }}>{a}</span>
                                ))}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                }
              </div>
            );
          })}
        </div>
        <div style={{ padding: "16px 24px", borderTop: "1px solid #E8E8EE", display: "flex", gap: "10px" }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: "11px", borderRadius: "8px", border: "1.5px solid #E8E8EE", background: "#fff", color: "#5B5E72", fontWeight: 600, fontSize: "13px", cursor: "pointer" }}>
            ← Edit More
          </button>
          <button type="button" onClick={onConfirm} style={{ flex: 2, padding: "11px", borderRadius: "8px", border: "none", background: "#5b4fcf", color: "#fff", fontWeight: 700, fontSize: "13px", cursor: "pointer" }}>
            Confirm &amp; Save
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Role CRUD Modals ───────────────────────────────────────────────────────────

function RoleFormModal({ title, icon, name, desc, nameError, isActive, onNameChange, onDescChange, onIsActiveChange, onConfirm, onCancel, confirmLabel, confirmDisabled }: {
  title: string; icon: string; name: string; desc: string; nameError?: string;
  isActive?: boolean; onIsActiveChange?: (v: boolean) => void;
  onNameChange: (v: string) => void; onDescChange: (v: string) => void;
  onConfirm: () => void; onCancel: () => void;
  confirmLabel: string; confirmDisabled: boolean;
}) {
  const MAX = 30;
  return (
    <ModalOverlay>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "480px", width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,.18)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px" }}>
          <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "#EEEAFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", flexShrink: 0 }}>{icon}</div>
          <div>
            <p style={{ margin: 0, fontWeight: 700, fontSize: "18px", color: "#15172A" }}>{title}</p>
            <p style={{ margin: "3px 0 0", fontSize: "13px", color: "#9A9DB0" }}>Letters and spaces only &mdash; no numbers or special characters</p>
          </div>
        </div>
        <label style={{ display: "block", marginBottom: "16px" }}>
          <span style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#5B5E72", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Role Name *</span>
          <input
            type="text" autoFocus placeholder="e.g. Class Teacher, Lab Assistant, Principal…"
            value={name}
            maxLength={MAX}
            onChange={(e) => {
              // Strip numbers and special characters as user types
              const cleaned = e.target.value.replace(/[^A-Za-z ]/g, "").slice(0, MAX);
              onNameChange(cleaned);
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !confirmDisabled) onConfirm(); }}
            style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: `1.5px solid ${nameError ? "#dc2626" : "#D8D4FF"}`, fontSize: "14px", outline: "none", boxSizing: "border-box" as const, color: "#15172A" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "4px" }}>
            {nameError
              ? <span style={{ fontSize: "12px", color: "#dc2626", fontWeight: 500 }}>{nameError}</span>
              : <span style={{ fontSize: "12px", color: "#9A9DB0" }}> </span>
            }
            <span style={{ fontSize: "12px", color: name.length >= MAX ? "#dc2626" : "#9A9DB0" }}>{name.length}/{MAX}</span>
          </div>
        </label>
        <label style={{ display: "block", marginBottom: "24px" }}>
          <span style={{ display: "block", fontSize: "12px", fontWeight: 700, color: "#5B5E72", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>Description</span>
          <input
            type="text" placeholder="e.g. Manages attendance and grades for their class"
            value={desc} onChange={(e) => onDescChange(e.target.value)}
            style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1.5px solid #E8E8EE", fontSize: "14px", outline: "none", boxSizing: "border-box" as const, color: "#15172A" }}
          />
        </label>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" onClick={onCancel} style={{ flex: 1, padding: "11px", borderRadius: "10px", border: "1.5px solid #E8E8EE", background: "#fff", color: "#5B5E72", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={confirmDisabled} style={{ flex: 2, padding: "11px", borderRadius: "10px", border: "none", background: confirmDisabled ? "#E8E8EE" : "#5b4fcf", color: confirmDisabled ? "#9A9DB0" : "#fff", fontWeight: 700, fontSize: "14px", cursor: confirmDisabled ? "not-allowed" : "pointer" }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

function DeleteRoleModal({ role, inProgress, onConfirm, onCancel }: { role: RoleItem; inProgress: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <ModalOverlay>
      <div style={{ background: "#fff", borderRadius: "20px", padding: "32px", maxWidth: "420px", width: "100%", boxShadow: "0 24px 64px rgba(0,0,0,.18)" }}>
        <div style={{ width: "48px", height: "48px", borderRadius: "14px", background: "#FEF2F2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", marginBottom: "20px" }}>🗑️</div>
        <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: "18px", color: "#15172A" }}>Delete Role?</p>
        <p style={{ margin: "0 0 6px", fontSize: "14px", color: "#5B5E72", lineHeight: 1.6 }}>
          You are about to delete <strong>&ldquo;{role.name}&rdquo;</strong>. All permission assignments for this role will be removed.
        </p>
        <p style={{ margin: "0 0 24px", fontSize: "13px", color: "#dc2626", fontWeight: 600 }}>This action cannot be undone.</p>
        <div style={{ display: "flex", gap: "10px" }}>
          <button type="button" onClick={onCancel} disabled={inProgress} style={{ flex: 1, padding: "11px", borderRadius: "10px", border: "1.5px solid #E8E8EE", background: "#fff", color: "#5B5E72", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}>Cancel</button>
          <button type="button" onClick={onConfirm} disabled={inProgress} style={{ flex: 1, padding: "11px", borderRadius: "10px", border: "none", background: "#dc2626", color: "#fff", fontWeight: 700, fontSize: "14px", cursor: inProgress ? "not-allowed" : "pointer", opacity: inProgress ? 0.7 : 1 }}>
            {inProgress ? "Deleting…" : "Yes, Delete"}
          </button>
        </div>
      </div>
    </ModalOverlay>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function AssignPermissionPanel({ roleId, onBack }: AssignPermissionPanelProps) {
  // Internal role override (for switching roles within the panel)
  const [activeRoleId, setActiveRoleId] = useState<number | string>(roleId ?? "");

  // API data
  const [modules, setModules] = useState<ModuleNode[]>([]);
  const [roleData, setRoleData] = useState<{ id: number; name: string } | null>(null);
  const [allRoles, setAllRoles] = useState<RoleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  // Permission selections
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [enabledModules, setEnabledModules] = useState<Set<string>>(new Set());
  const [operationLevels, setOperationLevels] = useState<Record<string, OperationLevel>>({});
  const [activeModule, setActiveModule] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Modal state
  const [pendingDeletePerm, setPendingDeletePerm] = useState<{ perm: PermissionNode; mod: ModuleNode; label: string } | null>(null);
  const [pendingFullControl, setPendingFullControl] = useState<ModuleNode | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [showRiskyConfirm, setShowRiskyConfirm] = useState(false);

  // Role panel state
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const [showNewRoleForm, setShowNewRoleForm] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  // reused as portal_type selector (description field does not exist on backend Role model)
  const [newRoleDesc, setNewRoleDesc] = useState("admin");
  const [newRoleNameError, setNewRoleNameError] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);

  // Role CRUD dialogs
  const [editingRole, setEditingRole] = useState<RoleItem | null>(null);
  const [editRoleName, setEditRoleName] = useState("");
  const [editRoleDesc, setEditRoleDesc] = useState("");
  const [editRoleIsActive, setEditRoleIsActive] = useState(true);
  const [editRoleNameError, setEditRoleNameError] = useState("");
  const [savingEditRole, setSavingEditRole] = useState(false);
  const [deletingRole, setDeletingRole] = useState<RoleItem | null>(null);
  const [deletingRoleInProgress, setDeletingRoleInProgress] = useState(false);
  const [hoveredRoleId, setHoveredRoleId] = useState<number | null>(null);
  const [togglingRoleId, setTogglingRoleId] = useState<number | null>(null);

  // ── Load all roles (for switcher) ───────────────────────────────────────────
  useEffect(() => {
    apiRequestWithRefresh<{ results?: RoleItem[]; data?: RoleItem[] } | RoleItem[]>(
      "/api/v1/access-control/roles/?page_size=200&minimal=1&show_inactive=1"
    )
      .then((res) => {
        const list = Array.isArray(res)
          ? res
          : (res as { results?: RoleItem[] }).results ?? (res as { data?: RoleItem[] }).data ?? [];
        setAllRoles(list);
      })
      .catch(() => {});
  }, []);

  // ── Load permission tree ────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeRoleId && activeRoleId !== 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setModules([]);
    setSelectedIds(new Set());
    setEnabledModules(new Set());
    setOperationLevels({});
    setActiveModule(null);

    async function load() {
      try {
        const res = await apiRequestWithRefresh<{ data?: PermissionTreeResponse } & Partial<PermissionTreeResponse>>(
          `/api/v1/access-control/roles/${activeRoleId}/permission-tree/`
        );
        if (cancelled) return;
        const data: PermissionTreeResponse =
          (res as { data?: PermissionTreeResponse }).data ?? (res as unknown as PermissionTreeResponse);
        const mods = data.modules ?? [];
        setModules(mods);
        setRoleData(data.role ?? null);
        const ids = new Set<number>();
        const enabled = new Set<string>();
        const levels: Record<string, OperationLevel> = {};
        for (const mod of mods) {
          if (mod.permissions.some((p) => p.selected)) {
            enabled.add(mod.module);
            mod.permissions.forEach((p) => { if (p.selected) ids.add(p.id); });
          }
        }
        for (const mod of mods) {
          if (enabled.has(mod.module)) levels[mod.module] = inferOperationLevel(mod.permissions, ids);
        }
        setSelectedIds(ids);
        setEnabledModules(enabled);
        setOperationLevels(levels);
        const first = mods.find((m) => enabled.has(m.module)) ?? (mods.length > 0 ? mods[0] : null);
        if (first) setActiveModule(first.module);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load permissions.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [activeRoleId]);

  // ── Role management ─────────────────────────────────────────────────────────
  function switchRole(id: number) {
    setActiveRoleId(id);
    setShowRoleSwitcher(false);
  }

  const ROLE_NAME_RE = /^[A-Za-z ]+$/;
  const REPEATED_CHARS_RE = /(.)(\1){2,}/i;  // 3+ consecutive identical letters

  async function createNewRole() {
    const trimmed = newRoleName.trim();
    if (!trimmed) {
      setNewRoleNameError("Role name is required.");
      return;
    }
    if (!ROLE_NAME_RE.test(trimmed)) {
      setNewRoleNameError("Only letters and spaces are allowed. No numbers or special characters.");
      return;
    }
    if (REPEATED_CHARS_RE.test(trimmed)) {
      setNewRoleNameError('Avoid repeating the same letter more than twice (e.g. "wwwwww")');
      return;
    }
    setNewRoleNameError("");
    setCreatingRole(true);
    try {
      const res = await apiRequestWithRefresh<{ id: number; name: string; portal_type?: string; data?: { id: number; name: string; portal_type?: string } }>(
        "/api/v1/access-control/roles/",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed, portal_type: newRoleDesc || "admin" }) }
      );
      const newRole = (res as { data?: { id: number; name: string } }).data ?? (res as { id: number; name: string });
      setAllRoles((prev) => [...prev, newRole]);
      setNewRoleName("");
      setNewRoleDesc("admin");
      setNewRoleNameError("");
      setShowNewRoleForm(false);
      setToast({ message: `Role "${newRole.name}" created successfully.`, tone: "success" });
      switchRole(newRole.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to create role.";
      // Show name-related errors inline in the form; others as toast.
      if (msg.toLowerCase().includes("name") || msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("deactivated")) {
        setNewRoleNameError(msg);
      } else {
        setToast({ message: msg, tone: "error" });
      }
    } finally {
      setCreatingRole(false);
    }
  }

  async function saveEditRole() {
    if (!editingRole) return;
    const trimmed = editRoleName.trim();
    if (!trimmed) {
      setEditRoleNameError("Role name is required.");
      return;
    }
    if (!ROLE_NAME_RE.test(trimmed)) {
      setEditRoleNameError("Only letters and spaces are allowed. No numbers or special characters.");
      return;
    }
    if (REPEATED_CHARS_RE.test(trimmed)) {
      setEditRoleNameError('Avoid repeating the same letter more than twice (e.g. "wwwwww")');
      return;
    }
    setEditRoleNameError("");
    setSavingEditRole(true);
    try {
      await apiRequestWithRefresh(
        `/api/v1/access-control/roles/${editingRole.id}/`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: trimmed, description: editRoleDesc.trim(), is_active: editRoleIsActive }) }
      );
      setAllRoles((prev) => prev.map((r) => r.id === editingRole.id ? { ...r, name: trimmed, description: editRoleDesc.trim(), is_active: editRoleIsActive } : r));
      if (roleData?.id === editingRole.id) setRoleData((prev) => prev ? { ...prev, name: trimmed } : prev);
      setToast({ message: `Role "${trimmed}" updated successfully.`, tone: "success" });
      setEditingRole(null);
      setEditRoleNameError("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update role.";
      // Show name-related errors inline in the form; others as toast.
      if (msg.toLowerCase().includes("name") || msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("deactivated")) {
        setEditRoleNameError(msg);
      } else {
        setToast({ message: msg, tone: "error" });
      }
    } finally {
      setSavingEditRole(false);
    }
  }

  async function confirmDeleteRole() {
    if (!deletingRole) return;
    setDeletingRoleInProgress(true);
    try {
      await apiRequestWithRefresh(`/api/v1/access-control/roles/${deletingRole.id}/`, { method: "DELETE" });
      setAllRoles((prev) => prev.filter((r) => r.id !== deletingRole.id));
      if (String(activeRoleId) === String(deletingRole.id)) { setActiveRoleId(""); setRoleData(null); }
      setToast({ message: `Role "${deletingRole.name}" deleted.`, tone: "success" });
      setDeletingRole(null);
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Failed to delete role.", tone: "error" });
    } finally {
      setDeletingRoleInProgress(false);
    }
  }

  async function toggleRoleActive(role: RoleItem) {
    setTogglingRoleId(role.id);
    const nextActive = !(role.is_active ?? true);
    try {
      await apiRequestWithRefresh(
        `/api/v1/access-control/roles/${role.id}/`,
        { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_active: nextActive }) }
      );
      setAllRoles((prev) => prev.map((r) => r.id === role.id ? { ...r, is_active: nextActive } : r));
      setToast({
        message: nextActive ? `"${role.name}" activated successfully.` : `"${role.name}" deactivated successfully.`,
        tone: "success",
      });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : "Failed to update role status.", tone: "error" });
    } finally {
      setTogglingRoleId(null);
    }
  }

  // ── Permission handlers ─────────────────────────────────────────────────────
  function toggleModule(moduleKey: string, mod: ModuleNode) {
    if (enabledModules.has(moduleKey)) {
      setEnabledModules((prev) => { const s = new Set(prev); s.delete(moduleKey); return s; });
      setSelectedIds((prev) => { const n = new Set(prev); mod.permissions.forEach((p) => n.delete(p.id)); return n; });
      setOperationLevels((prev) => ({ ...prev, [moduleKey]: "none" }));
    } else {
      setEnabledModules((prev) => new Set([...prev, moduleKey]));
      setSelectedIds((prev) => applyOperationLevel(mod, "view", prev));
      setOperationLevels((prev) => ({ ...prev, [moduleKey]: "view" }));
      setActiveModule(moduleKey);
    }
  }

  function handleOperationChange(mod: ModuleNode, level: OperationLevel) {
    if (level === "full") {
      const hasDelete = mod.permissions.some((p) => getActionFromCode(p.code) === "delete");
      if (hasDelete) { setPendingFullControl(mod); return; }
    }
    applyLevel(mod, level);
  }

  function applyLevel(mod: ModuleNode, level: OperationLevel, includeDelete = true) {
    const finalLevel = !includeDelete && level === "full" ? "create_edit" : level;
    setOperationLevels((prev) => ({ ...prev, [mod.module]: finalLevel }));
    setSelectedIds((prev) => applyOperationLevel(mod, level, prev, includeDelete));
  }

  function handlePermissionToggle(permId: number, mod: ModuleNode) {
    const perm = mod.permissions.find((p) => p.id === permId);
    if (!perm) return;
    const adding = !selectedIds.has(permId);
    if (adding && getActionFromCode(perm.code) === "delete") {
      const subFeatures = groupPermsBySubFeature(mod.permissions);
      const row = subFeatures.find((r) => r.delete?.id === permId);
      setPendingDeletePerm({ perm, mod, label: row?.label ?? perm.name });
      return;
    }
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(permId) ? next.delete(permId) : next.add(permId);
      const level = inferOperationLevel(mod.permissions, next);
      setOperationLevels((pl) => ({ ...pl, [mod.module]: level }));
      return next;
    });
  }

  // ── Save flow ───────────────────────────────────────────────────────────────
  function handleSaveClick() { setShowReview(true); }

  function handleReviewConfirm() {
    setShowReview(false);
    const risky = Array.from(enabledModules).filter((m) => RISKY_MODULES.has(m));
    if (risky.length > 0) { setShowRiskyConfirm(true); }
    else { void doSave(); }
  }

  async function doSave() {
    setShowRiskyConfirm(false);
    setSaving(true);
    setSaveSuccess(false);
    setError(null);
    try {
      await apiRequestWithRefresh(
        `/api/v1/access-control/roles/${activeRoleId}/assign-permissions/`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ permission_ids: Array.from(selectedIds) }) }
      );
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ── Computed ────────────────────────────────────────────────────────────────
  const totalPermissions = useMemo(() => modules.reduce((s, m) => s + m.permissions.length, 0), [modules]);
  const modulesEnabled = enabledModules.size;
  const totalModules = modules.length;
  const modulesConfigured = useMemo(
    () => Array.from(enabledModules).filter((k) => (operationLevels[k] ?? "none") !== "none").length,
    [enabledModules, operationLevels]
  );
  const activeMod = useMemo(() => modules.find((m) => m.module === activeModule) ?? null, [modules, activeModule]);
  const riskyEnabled = useMemo(() => Array.from(enabledModules).filter((m) => RISKY_MODULES.has(m)), [enabledModules]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className={`${manrope.variable} ${playfairDisplay.variable} assign-permission-panel`}>
      <main className="page">

        {/* Modals */}
        {pendingDeletePerm && (
          <DeleteConfirmModal
            perm={pendingDeletePerm.perm}
            featureLabel={pendingDeletePerm.label}
            onConfirm={() => {
              const { perm, mod } = pendingDeletePerm;
              setSelectedIds((prev) => {
                const next = new Set(prev); next.add(perm.id);
                setOperationLevels((pl) => ({ ...pl, [mod.module]: inferOperationLevel(mod.permissions, next) }));
                return next;
              });
              setPendingDeletePerm(null);
            }}
            onCancel={() => setPendingDeletePerm(null)}
          />
        )}
        {pendingFullControl && (
          <FullControlModal
            moduleName={prettyModuleName(pendingFullControl.module)}
            onIncludeDelete={() => { applyLevel(pendingFullControl, "full", true); setPendingFullControl(null); }}
            onExcludeDelete={() => { applyLevel(pendingFullControl, "full", false); setPendingFullControl(null); }}
            onCancel={() => setPendingFullControl(null)}
          />
        )}
        {showReview && (
          <ReviewModal
            modules={modules} enabledModules={enabledModules}
            operationLevels={operationLevels} selectedIds={selectedIds}
            onConfirm={handleReviewConfirm}
            onCancel={() => setShowReview(false)}
          />
        )}
        {showRiskyConfirm && (
          <RiskyConfirmModal
            riskyList={riskyEnabled}
            onConfirm={() => void doSave()}
            onCancel={() => setShowRiskyConfirm(false)}
          />
        )}
        {showNewRoleForm && (
          <RoleFormModal
            title="Create New Role" icon="✨"
            name={newRoleName} desc={newRoleDesc} nameError={newRoleNameError}
            onNameChange={(v) => {
              setNewRoleName(v);
              if (!v.trim()) { setNewRoleNameError(""); return; }
              if (REPEATED_CHARS_RE.test(v)) {
                setNewRoleNameError('Avoid repeating the same letter more than twice (e.g. "wwwwww")');
              } else if (newRoleNameError) {
                setNewRoleNameError("");
              }
            }}
            onDescChange={setNewRoleDesc}
            onConfirm={() => void createNewRole()}
            onCancel={() => { setShowNewRoleForm(false); setNewRoleName(""); setNewRoleDesc(""); setNewRoleNameError(""); }}
            confirmLabel={creatingRole ? "Creating…" : "Create & Configure →"}
            confirmDisabled={!newRoleName.trim() || creatingRole}
          />
        )}
        {editingRole && (
          <RoleFormModal
            title={`Edit Role`} icon="✏️"
            name={editRoleName} desc={editRoleDesc} nameError={editRoleNameError}
            isActive={editRoleIsActive} onIsActiveChange={setEditRoleIsActive}
            onNameChange={(v) => {
              setEditRoleName(v);
              if (!v.trim()) { setEditRoleNameError(""); return; }
              if (REPEATED_CHARS_RE.test(v)) {
                setEditRoleNameError('Avoid repeating the same letter more than twice (e.g. "wwwwww")');
              } else if (editRoleNameError) {
                setEditRoleNameError("");
              }
            }}
            onDescChange={setEditRoleDesc}
            onConfirm={() => void saveEditRole()}
            onCancel={() => { setEditingRole(null); setEditRoleNameError(""); }}
            confirmLabel={savingEditRole ? "Saving…" : "Save Changes"}
            confirmDisabled={!editRoleName.trim() || savingEditRole}
          />
        )}
        {deletingRole && (
          <DeleteRoleModal
            role={deletingRole} inProgress={deletingRoleInProgress}
            onConfirm={() => void confirmDeleteRole()}
            onCancel={() => setDeletingRole(null)}
          />
        )}

        {/* PAGE HEAD */}
        <div className="page-head">
          <div>
            <h1>
              Roles &amp;{" "}
              <em>Assign Permissions</em>
              {roleData && (
                <span style={{ fontFamily: "var(--font-playfair-display), Georgia, serif", fontStyle: "normal", fontWeight: 600, color: "#15172A", fontSize: "26px" }}>
                  {" "}&mdash; {roleData.name}
                </span>
              )}
            </h1>
          </div>
          <div className="actions">
            {activeRoleId && saveSuccess && (
              <span style={{ background: "#22C55E", color: "#fff", borderRadius: "20px", padding: "6px 16px", fontSize: "13px", fontWeight: 600 }}>
                &#10003; Saved
              </span>
            )}
            {activeRoleId && (
              <button type="button" className="btn btn-primary" onClick={handleSaveClick} disabled={saving}>
                {saving ? "Saving…" : "Save Permissions"}
              </button>
            )}
          </div>
        </div>

        {error && <div role="alert" className="flash error">{error}</div>}
        {toast && <TopToast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}

        {/* NO ROLE SELECTED — inline role picker */}
        {!activeRoleId ? (
          <div style={{ marginTop: "20px" }}>
            <p style={{ margin: "0 0 16px", fontSize: "13px", color: "#9A9DB0" }}>Select a role to configure its permissions, or create a new one.</p>
            {allRoles.length === 0 ? (
              <div style={{ textAlign: "center", padding: "48px", color: "#9A9DB0", fontSize: "14px" }}>Loading roles…</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
                {allRoles.map((r) => (
                  <div key={r.id}
                    style={{
                      position: "relative",
                      background: r.is_active === false ? "#F9F9FC" : "#fff",
                      border: `1.5px solid ${r.is_active === false ? "#ECEEF5" : "#E8E8EE"}`,
                      borderRadius: "12px", padding: "18px 20px 14px",
                      transition: "all 0.15s", display: "flex", flexDirection: "column", gap: "6px",
                      opacity: r.is_active === false ? 0.65 : 1,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "#6D4AFF"; (e.currentTarget as HTMLDivElement).style.background = "#FAFAFF"; (e.currentTarget as HTMLDivElement).style.opacity = "1"; setHoveredRoleId(r.id); }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = r.is_active === false ? "#ECEEF5" : "#E8E8EE"; (e.currentTarget as HTMLDivElement).style.background = r.is_active === false ? "#F9F9FC" : "#fff"; (e.currentTarget as HTMLDivElement).style.opacity = r.is_active === false ? "0.65" : "1"; setHoveredRoleId(null); }}>
                    {/* Action buttons — visible only on hover */}
                    <div style={{ position: "absolute", top: "10px", right: "10px", display: "flex", gap: "4px", opacity: hoveredRoleId === r.id ? 1 : 0, transition: "opacity 0.15s", pointerEvents: hoveredRoleId === r.id ? "auto" : "none" }}>
                      <button type="button" title="Edit role"
                        onClick={(e) => { e.stopPropagation(); setEditRoleName(r.name); setEditRoleDesc(r.description ?? ""); setEditRoleIsActive(r.is_active ?? true); setEditingRole(r); }}
                        style={{ width: "26px", height: "26px", borderRadius: "6px", border: "1px solid #E8E8EE", background: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", color: "#6D4AFF", zIndex: 1 }}>
                        ✏️
                      </button>
                      <button type="button" title="Delete role"
                        onClick={(e) => { e.stopPropagation(); setDeletingRole(r); }}
                        style={{ width: "26px", height: "26px", borderRadius: "6px", border: "1px solid #FEE2E2", background: "#FFF5F5", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", zIndex: 1 }}>
                        🗑️
                      </button>
                    </div>
                    {/* Clickable body */}
                    <button type="button" onClick={() => switchRole(r.id)}
                      style={{ background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", paddingRight: "52px" }}>
                        <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: r.is_active === false ? "#9CA3AF" : "#6D4AFF", flexShrink: 0, transition: "background 0.2s" }} />
                        <span style={{ fontWeight: 700, fontSize: "14px", color: "#15172A" }}>{r.name}</span>
                      </span>
                      {r.description && <span style={{ fontSize: "12px", color: "#9A9DB0", paddingLeft: "16px" }}>{r.description}</span>}
                      <span style={{ fontSize: "12px", color: "#6D4AFF", fontWeight: 600, paddingLeft: "16px", marginTop: "4px" }}>Configure permissions →</span>
                    </button>
                    {/* ── Active / Inactive toggle ── */}
                    <div
                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: "10px", borderTop: "1px solid #F0F0F5" }}
                      onClick={(e) => e.stopPropagation()}>
                      <span style={{ fontSize: "11px", fontWeight: 600, color: r.is_active === false ? "#9CA3AF" : "#16a34a", letterSpacing: "0.02em" }}>
                        {r.is_active === false ? "Inactive" : "Active"}
                      </span>
                      <button
                        type="button"
                        disabled={r.is_system === true || togglingRoleId === r.id}
                        onClick={(e) => { e.stopPropagation(); void toggleRoleActive(r); }}
                        title={r.is_system ? "System roles cannot be deactivated" : (r.is_active === false ? "Activate role" : "Deactivate role")}
                        style={{
                          position: "relative", width: "36px", height: "20px", borderRadius: "10px",
                          background: r.is_active === false ? "#D1D5DB" : "#16a34a",
                          border: "none", padding: 0,
                          cursor: r.is_system ? "not-allowed" : togglingRoleId === r.id ? "wait" : "pointer",
                          transition: "background 0.25s",
                          opacity: togglingRoleId === r.id ? 0.55 : r.is_system ? 0.35 : 1,
                          flexShrink: 0,
                        }}
                      >
                        <span style={{
                          position: "absolute", top: "2px",
                          left: r.is_active === false ? "2px" : "18px",
                          width: "16px", height: "16px", borderRadius: "50%",
                          background: "#fff", transition: "left 0.25s",
                          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                          display: "block",
                        }} />
                      </button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setShowNewRoleForm(true)} style={{
                  background: "#F5F3FF", border: "1.5px dashed #C4BBFF", borderRadius: "12px",
                  padding: "18px 20px", textAlign: "left", cursor: "pointer", transition: "all 0.15s",
                  display: "flex", flexDirection: "column", gap: "6px",
                }}>
                  <span style={{ fontWeight: 700, fontSize: "14px", color: "#6D4AFF" }}>＋ Create New Role</span>
                  <span style={{ fontSize: "12px", color: "#9A9DB0" }}>Set up a role then configure its permissions</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
        {/* STATS */}
        <div className="stats-grid">
          <article className="stat-card">
            <p className="stat-label">Modules Enabled</p>
            <p className="stat-value">{modulesEnabled}<span style={{ fontSize: "16px", color: "#72758b" }}> / {totalModules}</span></p>
            <p className="stat-hint">modules active for this role</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Permissions Assigned</p>
            <p className="stat-value">{selectedIds.size}</p>
            <p className="stat-hint">out of {totalPermissions} total</p>
          </article>
          <article className="stat-card">
            <p className="stat-label">Fully Configured</p>
            <p className="stat-value">{modulesConfigured}</p>
            <p className="stat-hint">modules with operation level set</p>
          </article>
        </div>

        {loading ? (
          <div style={{ textAlign: "center", padding: "60px", color: "#9A9DB0", fontSize: "14px" }}>Loading permissions…</div>
        ) : (
          <div className="module-layout" style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
            <ModuleList
              modules={modules} enabledModules={enabledModules} activeModule={activeModule}
              operationLevels={operationLevels} selectedIds={selectedIds}
              roleData={roleData} allRoles={allRoles} showRoleSwitcher={showRoleSwitcher}
              // TODO(create-role): restore these props: showNewRoleForm newRoleName newRoleDesc creatingRole
              showNewRoleForm={showNewRoleForm} newRoleName={newRoleName} newRoleDesc={newRoleDesc}
              creatingRole={creatingRole} activeRoleId={activeRoleId}
              onToggle={toggleModule}
              onSelect={(key) => setActiveModule(key)}
              onToggleRoleSwitcher={() => { setShowRoleSwitcher((v) => !v); setShowNewRoleForm(false); }}
              onToggleNewRoleForm={() => setShowNewRoleForm((v) => !v)}
              onSwitchRole={switchRole}
              onNewRoleNameChange={setNewRoleName}
              onNewRoleDescChange={setNewRoleDesc}
              onCreateRole={() => void createNewRole()}
            />

            {activeMod && enabledModules.has(activeMod.module) ? (
              <ModuleConfigPanel
                mod={activeMod}
                operationLevel={operationLevels[activeMod.module] ?? "none"}
                selectedIds={selectedIds}
                onOperationChange={handleOperationChange}
                onPermissionToggle={handlePermissionToggle}
              />
            ) : (
              <div style={{ flex: 1, background: "#FFFFFF", border: "1px solid #E8E8EE", borderRadius: "14px", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 40px", textAlign: "center", minHeight: "320px" }}>
                <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: "#EEEAFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", marginBottom: "14px" }}>&#128275;</div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: "15px", color: "#15172A" }}>Enable a module to configure it</p>
                <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#9A9DB0", maxWidth: "260px" }}>Toggle the switch next to any module on the left to activate it, then choose its access level here.</p>
              </div>
            )}
          </div>
        )}
          </>
        )}

      </main>

      <style jsx>{`
        .assign-permission-panel { font-family: var(--font-manrope), system-ui, sans-serif; }
        .page { background: #f8f8fc; border-radius: 16px; padding: 18px; }
        .page-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 14px 24px; background: #ffffff; border: 1px solid rgba(0,0,0,.08); border-radius: 12px; }
        .page-head h1 { margin: 0; font-size: 32px; font-weight: 700; line-height: 1.15; letter-spacing: -.02em; color: #0f172a; font-family: var(--font-playfair-display), Georgia, serif; }
        .page-head h1 em { color: #6c3ce1; font-family: var(--font-playfair-display), Georgia, serif; font-style: italic; font-weight: 400; }
        .actions { display: flex; gap: 8px; align-items: center; }
        .btn { border-radius: 8px; padding: 7px 14px; font-size: 12px; border: 1px solid rgba(0,0,0,.12); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all .12s; line-height: 1.4; font-family: var(--font-manrope), system-ui, sans-serif; }
        .btn-ghost { background: #fff; color: #181817; }
        .btn-ghost:hover { background: #f7f7f6; }
        .btn-primary { background: #5b4fcf; color: #fff; border-color: #5b4fcf; }
        .btn-primary:hover:not(:disabled) { background: #4a3fb8; border-color: #4a3fb8; }
        .btn-primary:disabled { opacity: .6; cursor: not-allowed; }
        .stats-grid { margin-top: 16px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
        .stat-card { background: #ffffff; border: 1px solid rgba(0,0,0,.08); border-radius: 14px; padding: 14px 16px; }
        .stat-label { margin: 0; text-transform: uppercase; letter-spacing: .06em; font-size: 11px; color: #72758b; font-weight: 700; }
        .stat-value { margin: 10px 0 6px; color: #10122b; font-size: 44px; line-height: 1; font-family: var(--font-playfair-display), Georgia, serif; font-weight: 500; letter-spacing: -.02em; }
        .stat-hint { margin: 0; color: #72758b; font-size: 13px; }
        .flash { margin-top: 16px; border-radius: 10px; padding: 12px 14px; font-size: 14px; font-weight: 600; }
        .flash.error { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
        .module-layout { margin-top: 20px; }
        @media (max-width: 768px) { .module-layout { flex-direction: column !important; } .module-layout > div:first-child { width: 100% !important; } .stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 480px) { .stats-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

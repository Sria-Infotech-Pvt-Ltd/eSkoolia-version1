"use client";
/**
 * Generic list-page pieces (Master Prompt §4.11–§4.15, §5) — the template every
 * Transport list page reuses. Visual spec follows the HR Staff Directory
 * (app/(dashboard)/hr/directory/page.tsx), whose versions are inline in that page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Search } from "lucide-react";
import { Chip, ExportChip, OutlineButton, type Tone } from "./controls";
import { LAYER, TpPortal, useOverlayLayer } from "./overlays";
import { T, Z } from "./tokens";

// ─── State hooks ─────────────────────────────────────────────────────────────

/** One group open at a time; Expand all / Collapse all; search opens all. */
export function useGroupOpen(initialOpen: string | null) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen ? [initialOpen] : []));
  const isOpen = useCallback((key: string) => open.has(key), [open]);
  const toggle = useCallback((key: string) => {
    setOpen((prev) => (prev.has(key) ? new Set([...prev].filter((k) => k !== key)) : new Set([key])));
  }, []);
  const openOnly = useCallback((key: string) => setOpen(new Set([key])), []);
  const expandAll = useCallback((keys: string[]) => setOpen(new Set(keys)), []);
  const collapseAll = useCallback(() => setOpen(new Set()), []);
  return { isOpen, toggle, openOnly, expandAll, collapseAll };
}

/** Selection map of record id → boolean (§5). */
export function useSelection() {
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const ids = useMemo(() => Object.keys(sel).filter((k) => sel[k]), [sel]);
  const toggle = useCallback((id: string) => setSel((s) => ({ ...s, [id]: !s[id] })), []);
  const clear = useCallback(() => setSel({}), []);
  const toggleAll = useCallback((visible: string[]) => {
    setSel((s) => {
      const all = visible.length > 0 && visible.every((id) => s[id]);
      const next = { ...s };
      visible.forEach((id) => { next[id] = !all; });
      return next;
    });
  }, []);
  return { sel, ids, count: ids.length, toggle, clear, toggleAll, isSelected: (id: string) => !!sel[id] };
}

// ─── Smart Filter & Bulk Actions panel ───────────────────────────────────────

export interface FilterField {
  key: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}

export interface FilterChip { label: string; tone: Tone }

export function SmartFilter({
  fields, chips, groupingChip, onReset,
}: { fields: FilterField[]; chips: FilterChip[]; groupingChip?: string; onReset: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tp-card" style={{ marginBottom: 12, overflow: "hidden" }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="tp-link-reset"
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderLeft: `4px solid ${T.puDeep}`, background: T.filterBg }}>
        <ChevronDown size={16} color={T.pu} strokeWidth={2}
          style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s", flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 800, color: T.ink }}>Smart Filter &amp; Bulk Actions</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {chips.length === 0 ? <Chip tone="slate">No filters active</Chip> : chips.map((c) => <Chip key={c.label} tone={c.tone}>{c.label}</Chip>)}
            {groupingChip && <Chip tone="slate">{groupingChip}</Chip>}
          </span>
        </span>
        <span style={{ fontSize: 12, color: T.muted, flexShrink: 0 }}>{open ? "Collapse" : "Expand to filter"}</span>
      </button>
      {open && (
        <div style={{ borderTop: `1px solid ${T.rowBd}`, padding: "14px 16px" }}>
          <div className="tp-filter-grid">
            {fields.map((f) => (
              <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: T.label }}>{f.label}</span>
                <select value={f.value} onChange={(e) => f.onChange(e.target.value)}
                  style={{ width: "100%", height: 36, padding: "0 8px", border: `1px solid ${T.cardBd}`, borderRadius: 9, background: "#fff", fontSize: 13, color: T.ink }}>
                  {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <OutlineButton onClick={onReset}>Reset filters</OutlineButton>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Search row ──────────────────────────────────────────────────────────────

export function SearchRow({
  value, onChange, onSubmit, placeholder, allSelected, onToggleAll, onExport,
}: {
  value: string; onChange: (v: string) => void; onSubmit: () => void; placeholder: string;
  allSelected: boolean; onToggleAll: () => void; onExport: () => void;
}) {
  return (
    <div className="tp-card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, padding: "12px 16px", marginBottom: 12 }}>
      <Search size={16} color={T.pu} strokeWidth={1.8} style={{ flexShrink: 0 }} />
      <input value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") onSubmit(); }}
        placeholder={placeholder} aria-label={placeholder}
        style={{ flex: "1 1 220px", minWidth: 0, height: 36, border: "none", outline: "none", fontSize: 14, background: "transparent", color: T.ink }} />
      <button type="button" className="tp-btn-search" onClick={onSubmit}>Search</button>
      <span aria-hidden style={{ width: 1, height: 20, background: T.cardBd }} />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: T.inkChip, cursor: "pointer" }}>
        <input type="checkbox" className="tp-check" checked={allSelected} onChange={onToggleAll} />
        Select all
      </label>
      <ExportChip onClick={onExport} />
    </div>
  );
}

// ─── Grouped accordion list ──────────────────────────────────────────────────

export function GroupedList({
  title, helper, onCollapseAll, onExpandAll, footer, actions, children,
}: {
  title: string; helper: string; onCollapseAll: () => void; onExpandAll: () => void; footer?: React.ReactNode;
  /** Extra header buttons shown before Collapse all / Expand all. */
  actions?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="tp-card">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "14px 16px" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.ink }}>{title}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{helper}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {actions}
          <OutlineButton onClick={onCollapseAll}>Collapse all</OutlineButton>
          <OutlineButton onClick={onExpandAll}>Expand all</OutlineButton>
        </div>
      </div>
      <div style={{ background: T.page, padding: 12, borderTop: `1px solid ${T.rowBd}`, borderRadius: "0 0 14px 14px" }}>
        {children}
        {footer}
      </div>
    </div>
  );
}

export function Donut({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <span title={`${p}%`} style={{
      width: 36, height: 36, borderRadius: 999, flexShrink: 0, display: "grid", placeItems: "center",
      background: `conic-gradient(${T.pu} ${p * 3.6}deg, ${T.cardBd} 0deg)`,
    }}>
      <span style={{ width: 24, height: 24, borderRadius: 999, background: "#fff", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 800, color: T.pu }}>
        {p}%
      </span>
    </span>
  );
}

export function GroupCard({
  name, title, chips, pct, open, onToggle, extra, children,
}: {
  name: string; chips: React.ReactNode; pct: number; open: boolean; onToggle: () => void; extra?: React.ReactNode; children: React.ReactNode;
  /** Optional rich title (defaults to `name`, which also labels the toggle for screen readers). */
  title?: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${T.cardBd}`, borderRadius: 14, marginBottom: 12, boxShadow: T.shadowAcc, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderLeft: `4px solid ${T.puDeep}`, background: "linear-gradient(135deg,#FFFFFF 60%,#EEEAFF 100%)" }}>
        <button type="button" onClick={onToggle} aria-label={open ? `Collapse ${name}` : `Expand ${name}`} aria-expanded={open} className="tp-btn-row"
          style={{ width: 24, height: 24, borderRadius: 6 }}>
          <ChevronDown size={16} color={T.pu} strokeWidth={2} style={{ transform: open ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }} />
        </button>
        <button type="button" onClick={onToggle} className="tp-link-reset" style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 850, color: T.ink }}>{title ?? name}</span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>{chips}</span>
        </button>
        {extra}
        <Donut pct={pct} />
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

export function ListFooter({ summary, counts, onCollapseAll, onExportView }: {
  summary: string; counts?: string; onCollapseAll: () => void; onExportView: () => void;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, padding: "4px 4px 0" }}>
      <span style={{ fontSize: 12, color: T.muted }}>
        {summary}{counts && <span style={{ color: T.label }}> {counts}</span>}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <OutlineButton onClick={onCollapseAll}>Collapse all</OutlineButton>
        <OutlineButton onClick={onExportView}>Export view</OutlineButton>
      </div>
    </div>
  );
}

/** Paginated groups end with a centred "Show N more <noun>" row (§4.14). */
export function ShowMoreRow({ colSpan, remaining, step, noun, onMore }: {
  colSpan: number; remaining: number; step: number; noun: string; onMore: () => void;
}) {
  if (remaining <= 0) return null;
  return (
    <tr>
      <td colSpan={colSpan} style={{ textAlign: "center", padding: "12px 8px" }}>
        <OutlineButton onClick={onMore}>Show {Math.min(step, remaining)} more {noun}</OutlineButton>
      </td>
    </tr>
  );
}

/** Soft button used in list headers (e.g. "Bulk Allocate"). */
export function SoftButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} style={{
      height: 32, padding: "0 12px", borderRadius: 9, border: `1px solid ${T.softBd}`, background: T.puSoft, color: T.pu,
      fontSize: 12.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", ...rest.style,
    }}>{children}</button>
  );
}

// ─── Table cells ─────────────────────────────────────────────────────────────

export function IconTile({ icon: Icon, size = 36 }: { icon: React.ElementType; size?: number }) {
  return (
    <span style={{ width: size, height: size, borderRadius: 10, background: T.puSoft, display: "grid", placeItems: "center", flexShrink: 0 }}>
      <Icon size={17} color={T.pu} strokeWidth={1.8} />
    </span>
  );
}

export function Avatar({ name, initials, online }: { name: string; initials: string; online?: boolean }) {
  return (
    <span style={{ position: "relative", flexShrink: 0 }} aria-label={name}>
      <span style={{ width: 36, height: 36, borderRadius: 999, background: T.pu, color: "#fff", display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800 }}>{initials}</span>
      {online && <span style={{ position: "absolute", right: 0, bottom: 0, width: 10, height: 10, borderRadius: 999, background: "#22C55E", boxShadow: "0 0 0 2px #FFFFFF" }} />}
    </span>
  );
}

export function IdentityCell({ lead, title, sub }: { lead: React.ReactNode; title: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      {lead}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: T.ink }}>{title}</div>
        <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}

export function CellStack({ top, sub }: { top: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: T.ink }}>{top}</div>
      {sub && <div style={{ fontSize: 11.5, color: T.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export interface MenuItem { label: string; color?: string; onClick: () => void }

/** Row "more" menu — one open at a time (the page owns `openId`). Portaled so table scroll never clips it. */
export function MoreMenu({ open, onToggle, onClose, items, label }: {
  open: boolean; onToggle: () => void; onClose: () => void; items: MenuItem[]; label: string;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  useOverlayLayer(open, LAYER.menu, onClose);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, onClose]);

  return (
    <>
      <button ref={btnRef} type="button" className="tp-btn-row" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={onToggle}>
        <MoreHorizontal size={15} strokeWidth={2.6} />
      </button>
      {open && pos && (
        <TpPortal>
          <div ref={menuRef} role="menu" className="tp-anim-fade" style={{
            position: "fixed", top: pos.top, right: pos.right, width: 180, zIndex: Z.menu, background: "#fff",
            border: `1px solid ${T.shellBd}`, borderRadius: 12, boxShadow: T.shadow3, padding: 6,
          }}>
            {items.map((it) => (
              <button key={it.label} type="button" role="menuitem" className="tp-menu-item" style={{ color: it.color ?? T.ink }}
                onClick={() => { onClose(); it.onClick(); }}>
                {it.label}
              </button>
            ))}
          </div>
        </TpPortal>
      )}
    </>
  );
}

// ─── Floating bulk-action bar ────────────────────────────────────────────────

export function BulkBar({ count, actions, onClear }: {
  count: number; actions: { label: string; onClick: () => void }[]; onClear: () => void;
}) {
  if (count === 0) return null;
  // Outer element centres; inner element animates (hr-fade-up also uses transform).
  return (
    <div role="region" aria-label="Bulk actions" style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: Z.bulk, maxWidth: "calc(100vw - 24px)",
    }}>
      <div className="tp-anim-fade" style={{
        background: T.ink, color: "#fff", borderRadius: 999, padding: "8px 16px", display: "flex", alignItems: "center", gap: 10,
        boxShadow: T.shadowBulk, whiteSpace: "nowrap", overflowX: "auto",
      }}>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{count} selected</span>
        <span aria-hidden style={{ width: 1, height: 18, background: "rgba(255,255,255,.2)" }} />
        {actions.map((a) => <button key={a.label} type="button" className="tp-bulk-btn" onClick={a.onClick}>{a.label}</button>)}
        <button type="button" onClick={onClear} className="tp-link-reset" style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,.7)", padding: "0 4px" }}>Clear</button>
      </div>
    </div>
  );
}

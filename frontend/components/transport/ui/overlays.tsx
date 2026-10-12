"use client";
/**
 * Transport overlays — Modal, Drawer, ConfirmDialog (Master Prompt §4.16–§4.18, §4.23).
 *
 * Same visual spec as HrModal / ProfileDrawer / HrConfirmDialog in
 * components/hr/HrUi.tsx and app/(dashboard)/hr/directory/page.tsx. They are
 * re-implemented (not wrapped) because each HR overlay installs its own
 * document-level Escape listener, so a single Esc closes every open layer at
 * once. Here every layer registers with one OverlayProvider and Esc closes only
 * the topmost (confirm → document modal → modal → drawer → row menu).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, X } from "lucide-react";
import { HrButton } from "@/components/hr/HrUi";
import { T, Z } from "./tokens";

// ─── Escape stack ────────────────────────────────────────────────────────────

/** Esc priority — higher closes first; ties go to the most recently opened. */
export const LAYER = { menu: 0, drawer: 1, wizard: 2, modal: 3, docModal: 4, preview: 5, confirm: 6 } as const;

interface Layer { id: number; priority: number; seq: number; close: () => void }
interface OverlayCtx { register: (priority: number, close: () => void) => () => void }

const OverlayContext = createContext<OverlayCtx | null>(null);

export function OverlayProvider({ children }: { children: React.ReactNode }) {
  const layers = useRef<Layer[]>([]);
  const counter = useRef(0);

  const register = useCallback((priority: number, close: () => void) => {
    counter.current += 1;
    const layer: Layer = { id: counter.current, priority, seq: counter.current, close };
    layers.current.push(layer);
    return () => { layers.current = layers.current.filter((l) => l.id !== layer.id); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || layers.current.length === 0) return;
      const top = [...layers.current].sort((a, b) => b.priority - a.priority || b.seq - a.seq)[0];
      e.preventDefault();
      e.stopPropagation();
      top.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return <OverlayContext.Provider value={{ register }}>{children}</OverlayContext.Provider>;
}

/** Registers an open overlay layer so Esc closes it only when it is topmost. */
export function useOverlayLayer(open: boolean, priority: number, onClose: () => void) {
  const ctx = useContext(OverlayContext);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open || !ctx) return;
    return ctx.register(priority, () => closeRef.current());
  }, [open, priority, ctx]);
}

/** Portals into <body>, re-applying the .tp scope so Transport tokens resolve. */
export function TpPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(<div className="tp">{children}</div>, document.body);
}

function useAutoFocus(open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) ref.current?.focus(); }, [open]);
  return ref;
}

// ─── Modal (HrModal) ─────────────────────────────────────────────────────────

export type ModalSize = "sm" | "md" | "lg" | "xl";
const MODAL_WIDTH: Record<ModalSize, string> = {
  sm: "min(480px,96vw)", md: "min(600px,96vw)", lg: "min(760px,96vw)", xl: "min(960px,96vw)",
};

export function Modal({
  open, onClose, title, subtitle, size = "md", footer, children, priority = LAYER.modal,
}: {
  open: boolean; onClose: () => void; title: string; subtitle?: string; size?: ModalSize;
  footer?: React.ReactNode; children: React.ReactNode; priority?: number;
}) {
  useOverlayLayer(open, priority, onClose);
  const ref = useAutoFocus(open);
  if (!open) return null;
  const titleId = `tp-modal-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <TpPortal>
      <div
        ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="tp-overlay-root"
        style={{ position: "fixed", inset: 0, zIndex: Z.modal, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      >
        <button type="button" aria-label="Close dialog" className="tp-backdrop" onClick={onClose}
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)" }} />
        <div className="tp-anim-fade" style={{
          position: "relative", width: MODAL_WIDTH[size], maxHeight: "88vh", background: "#fff", borderRadius: 16,
          boxShadow: T.shadowModal, display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "18px 20px", borderBottom: `1px solid ${T.modalBd}` }}>
            <div>
              <h2 id={titleId} className="tp-serif" style={{ margin: 0, fontSize: 16, fontWeight: 900, color: T.ink }}>{title}</h2>
              {subtitle && <p style={{ margin: "3px 0 0", fontSize: 12, color: T.muted, opacity: 0.8 }}>{subtitle}</p>}
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="tp-close"
              style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0 }}>
              <X size={14} strokeWidth={2} />
            </button>
          </div>
          <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>{children}</div>
          {footer && (
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.rowBd}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
              {footer}
            </div>
          )}
        </div>
      </div>
    </TpPortal>
  );
}

// ─── Confirm dialog (HrConfirmDialog) ────────────────────────────────────────

export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel, tone = "danger",
}: {
  open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string;
  confirmLabel: string; tone?: "danger" | "safe";
}) {
  useOverlayLayer(open, LAYER.confirm, onClose);
  const ref = useAutoFocus(open);
  if (!open) return null;
  const danger = tone === "danger";
  return (
    <TpPortal>
      <div
        ref={ref} tabIndex={-1} role="alertdialog" aria-modal="true" aria-label={title} className="tp-overlay-root"
        style={{ position: "fixed", inset: 0, zIndex: Z.confirm, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      >
        <button type="button" aria-label="Cancel" className="tp-backdrop" onClick={onClose}
          style={{ background: "rgba(15,23,42,0.55)", backdropFilter: "blur(2px)" }} />
        <div className="tp-anim-fade" style={{
          position: "relative", width: "min(480px,96vw)", background: "#fff", borderRadius: 16, boxShadow: T.shadowModal, padding: 20,
        }}>
          <div style={{
            display: "flex", gap: 12, padding: 12, borderRadius: 10,
            background: danger ? "linear-gradient(135deg,#fff7ed,#fff1f2)" : T.puSoft,
          }}>
            <AlertTriangle size={20} color={danger ? T.confirmIcon : T.pu} style={{ flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 900, color: T.ink }}>{title}</div>
              <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5, marginTop: 4 }}>{message}</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <HrButton type="button" variant="ghost" onClick={onClose}>Cancel</HrButton>
            <HrButton type="button" variant={danger ? "red" : "primary"} onClick={onConfirm}>{confirmLabel}</HrButton>
          </div>
        </div>
      </div>
    </TpPortal>
  );
}

// ─── Drawer (ProfileDrawer) ──────────────────────────────────────────────────

export function Drawer({
  open, onClose, label, children,
}: { open: boolean; onClose: () => void; label: string; children: React.ReactNode }) {
  useOverlayLayer(open, LAYER.drawer, onClose);
  const ref = useAutoFocus(open);
  if (!open) return null;
  return (
    <TpPortal>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label} className="tp-overlay-root"
        style={{ position: "fixed", inset: 0, zIndex: Z.drawer, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" aria-label="Close panel" className="tp-backdrop" onClick={onClose}
          style={{ background: "rgba(15,23,42,0.35)" }} />
        <aside className="tp-anim-slide" style={{
          position: "relative", width: 390, maxWidth: "94vw", height: "100%", background: "#fff", overflowY: "auto",
          boxShadow: T.shadowDrawer,
        }}>
          <button type="button" aria-label="Close" onClick={onClose} className="tp-close"
            style={{ position: "absolute", top: 16, right: 16, width: 32, height: 32, borderRadius: 999 }}>
            <X size={16} strokeWidth={2} />
          </button>
          {children}
        </aside>
      </div>
    </TpPortal>
  );
}

export function DrawerHeader({
  avatar, icon: Icon, title, titleMono, sub, idLabel, badges,
}: {
  avatar?: string; icon?: React.ElementType; title: string; titleMono?: boolean; sub: string; idLabel: string;
  badges?: React.ReactNode;
}) {
  return (
    <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${T.rowBd}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, paddingRight: 36 }}>
        {Icon ? (
          <div style={{ width: 56, height: 56, borderRadius: 14, background: T.puSoft, display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Icon size={26} color={T.pu} strokeWidth={1.8} />
          </div>
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 999, background: T.pu, color: "#fff", display: "grid", placeItems: "center", fontSize: 18, fontWeight: 800, flexShrink: 0 }}>
            {avatar}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div className={titleMono ? "tp-mono" : undefined} style={{ fontSize: 16, fontWeight: 800, color: T.ink, letterSpacing: titleMono ? "0.02em" : undefined }}>{title}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{sub}</div>
          <div style={{ fontSize: 11, color: T.label, marginTop: 2 }}>ID {idLabel}</div>
        </div>
      </div>
      {badges && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>{badges}</div>}
    </div>
  );
}

export function DrawerHighlight({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.rowBd}` }}>
      <div style={{ display: "flex", gap: 12, background: T.hlBg, border: `1px solid ${T.hlBd}`, borderRadius: 12, padding: 12 }}>
        {items.map((it) => (
          <div key={it.label} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>{it.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: T.pu, marginTop: 4 }}>{it.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DrawerSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "16px 20px", borderBottom: `1px solid ${T.rowBd}` }}>
      <h4 style={{ margin: "0 0 8px", fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>{title}</h4>
      {children}
    </div>
  );
}

export function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 12, padding: "4px 0", borderBottom: `1px dashed ${T.dashed}` }}>
      <span style={{ color: T.muted }}>{label}</span>
      <strong style={{ color: T.ink, textAlign: "right", display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>{children}</strong>
    </div>
  );
}

export function DrawerActions({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "16px 20px", display: "flex", gap: 8, flexWrap: "wrap" }}>{children}</div>;
}

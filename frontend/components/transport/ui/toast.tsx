"use client";
/**
 * Transport toast (Master Prompt §4.21). Same look as HrToastProvider in
 * components/hr/HrUi.tsx (2.2s, #111827 / #991b1b / #1e40af), but a new toast
 * replaces the current one instead of stacking, and it announces via role="status".
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Z } from "./tokens";

export type ToastType = "success" | "error" | "info";
interface ToastCtx { toast: (message: string, type?: ToastType) => void }

const ToastContext = createContext<ToastCtx>({ toast: () => {} });
export const useTpToast = () => useContext(ToastContext);

const BG: Record<ToastType, string> = { success: "#111827", error: "#991b1b", info: "#1e40af" };

export function TpToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<{ id: number; message: string; type: ToastType } | null>(null);
  const counter = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    counter.current += 1;
    setCurrent({ id: counter.current, message, type });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCurrent(null), 2200);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div role="status" aria-live="polite" style={{ position: "fixed", top: 16, right: 16, zIndex: Z.toast }}>
        {current && (
          <div key={current.id} className="tp-anim-fade" style={{
            minWidth: 240, maxWidth: 340, padding: "12px 16px", borderRadius: 10, color: "#fff", fontSize: 13, fontWeight: 700,
            background: BG[current.type],
            boxShadow: "0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)",
          }}>
            {current.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

"use client";

import { ReactNode, RefObject } from "react";
import { inputStyle } from "../catalogue/ui";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter. A scanner types the code and presses Enter, so this resolves it at once. */
  onSubmit: (value: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  placeholder: string;
  label: string;
  loading?: boolean;
  /** The suggestion list, or an error or empty message. */
  children?: ReactNode;
}

/** The one search box of a desk tab. The parent refocuses it after every action. */
export function DeskSearch({ value, onChange, onSubmit, inputRef, placeholder, label, loading, children }: Props) {
  return (
    <div style={{ marginBottom: 12 }}>
      <input
        ref={inputRef}
        aria-label={label}
        style={{ ...inputStyle, height: 42, fontSize: 15 }}
        value={value}
        autoFocus
        autoComplete="off"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (value.trim()) onSubmit(value);
          }
        }}
      />
      <div aria-live="polite" style={{ fontSize: 11, color: "var(--ink-3)", minHeight: 14, marginTop: 2 }}>
        {loading ? "Searching..." : ""}
      </div>
      {children}
    </div>
  );
}

export function SuggestionList({ children }: { children: ReactNode }) {
  return (
    <div role="listbox" style={{ border: "1px solid var(--bd)", borderRadius: 10, background: "var(--bg-1)", overflow: "hidden" }}>
      {children}
    </div>
  );
}

export function SuggestionRow({ onPick, children }: { onPick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={false}
      onClick={onPick}
      style={{
        display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px",
        border: "none", borderBottom: "1px solid var(--bd)", background: "var(--bg-1)", cursor: "pointer", textAlign: "left",
        color: "var(--ink-1)", fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

"use client";

import { useState } from "react";
import { getCopyByCode } from "@/hooks/useLibraryApi";
import type { BookCopy } from "@/types/library";
import { Btn, describeError, inputStyle, Modal, Pill } from "./ui";

interface Props {
  canLookup: boolean;
  onClose: () => void;
}

/** Static guidance plus a typing test: a keyboard-wedge scanner just types the code and presses Enter. */
export function ScannerSetupPanel({ canLookup, onClose }: Props) {
  const [value, setValue] = useState("");
  const [found, setFound] = useState<BookCopy | null>(null);
  const [message, setMessage] = useState("");

  const scan = async () => {
    const code = value.trim();
    if (!code) return;
    setFound(null);
    setMessage("");
    try {
      setFound(await getCopyByCode(code, { silent401: true }));
    } catch (err) {
      setMessage(describeError(err, "No copy with that code."));
    }
  };

  const options = [
    { name: "USB or Bluetooth scanner (keyboard wedge)", tag: "Recommended", body: "The scanner types the code like a keyboard and presses Enter. Plug it in or pair it, click the search box, and scan. No setup in Eskoolia." },
    { name: "Device camera", tag: "Optional", body: "Works only in browsers that support camera scanning and only over a secure page. If the camera is unavailable, type the code instead." },
    { name: "Type the code", tag: "Always works", body: "Type the full copy code, for example LIB-FIC-0001/C1, or just part of the title or author." },
  ];

  return (
    <Modal title="Scanner setup" onClose={onClose} width={620} footer={<Btn variant="primary" onClick={onClose}>Done</Btn>}>
      {options.map((option) => (
        <div key={option.name} style={{ padding: "10px 0", borderBottom: "1px solid var(--bd)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ fontSize: 14, color: "var(--ink-1)" }}>{option.name}</strong>
            <Pill tone={option.tag === "Recommended" ? "ok" : "neutral"}>{option.tag}</Pill>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-2)" }}>{option.body}</p>
        </div>
      ))}
      {canLookup ? (
        <div style={{ marginTop: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}>
            Test your scanner: click here, then scan a label
            <input
              style={{ ...inputStyle, marginTop: 4, fontFamily: "var(--font-mono)" }}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void scan();
                }
              }}
              placeholder="Scan or type a copy code, then press Enter"
            />
          </label>
          {found ? (
            <p role="status" style={{ fontSize: 13, color: "var(--ok)" }}>
              Found {found.code}: {found.book_title} ({found.status}).
            </p>
          ) : null}
          {message ? <p role="alert" style={{ fontSize: 13, color: "var(--danger)" }}>{message}</p> : null}
        </div>
      ) : null}
    </Modal>
  );
}

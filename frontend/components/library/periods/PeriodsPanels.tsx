"use client";

import { useRef, useState } from "react";
import { checkIn, LibraryApiError } from "@/hooks/useLibraryApi";
import type { Footfall, Occupancy, PrepBriefing } from "@/types/library";
import { Btn, inputStyle, Pill } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { barWidth, occupancyPercent, slotLabel, startsInText } from "./periodsHelpers";

export const panelStyle = { background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: 16 } as const;
const headingStyle = { margin: "0 0 8px", fontSize: 15, color: "var(--ink-1)" } as const;
const mutedStyle = { fontSize: 13, color: "var(--ink-3)", margin: 0 } as const;

function Bar({ percent, label, tone = "var(--pu)" }: { percent: number; label: string; tone?: string }) {
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} style={{ height: 8, borderRadius: 999, background: "var(--bg-3)", overflow: "hidden" }}>
      <div style={{ width: `${percent}%`, height: "100%", background: tone }} />
    </div>
  );
}

/** Checked in versus scheduled for every period running now. */
export function OccupancyCard({ occupancy }: { occupancy: Occupancy }) {
  return (
    <section style={panelStyle} aria-label="Live occupancy">
      <h2 style={headingStyle}>Live occupancy</h2>
      {occupancy.slots.length === 0 ? (
        <p style={mutedStyle}>No library period is running right now.</p>
      ) : (
        <>
          <div style={{ fontSize: 26, fontWeight: 700, color: "var(--ink-1)", fontVariantNumeric: "tabular-nums" }}>
            {occupancy.checked_in} <span style={{ fontSize: 14, fontWeight: 400, color: "var(--ink-3)" }}>checked in of {occupancy.scheduled} scheduled</span>
          </div>
          {occupancy.slots.map((row) => (
            <div key={row.slot_id} style={{ marginTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ink-1)", marginBottom: 3 }}>
                <span><strong>{slotLabel(row)}</strong> <span style={{ color: "var(--ink-3)" }}>{row.room_label}, {row.period_name}</span></span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.checked_in} / {row.scheduled}</span>
              </div>
              <Bar percent={occupancyPercent(row.checked_in, row.scheduled)} label={`${slotLabel(row)} checked in`} />
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/** The librarian types or scans a card number. The server picks the running period for that member's class. */
export function CheckInBox({ onCheckedIn }: { onCheckedIn: () => void }) {
  const [card, setCard] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const value = card.trim();
    if (!value) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await checkIn({ card_no: value, method: "card_tap" });
      setMessage({
        tone: "ok",
        text: result.created
          ? `${result.visit.member_name || result.visit.card_no} checked in. ${result.checked_in} of ${result.scheduled} here.`
          : `${result.visit.member_name || result.visit.card_no} was already checked in.`,
      });
      setCard("");
      onCheckedIn();
    } catch (err) {
      const field = err instanceof LibraryApiError ? err.fieldErrors?.period_slot?.[0] ?? err.fieldErrors?.member?.[0] : undefined;
      setMessage({ tone: "danger", text: field ?? refusalMessage(err, "Could not check in.") });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  return (
    <section style={panelStyle} aria-label="Check in">
      <h2 style={headingStyle}>Check in</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={input}
          aria-label="Card number"
          placeholder="Scan or type a card number"
          style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
          value={card}
          autoFocus
          onChange={(e) => setCard(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <Btn variant="primary" onClick={submit} disabled={busy || !card.trim()}>{busy ? "Checking..." : "Check in"}</Btn>
      </div>
      <div role="status" style={{ minHeight: 20, marginTop: 8, fontSize: 13, color: message?.tone === "danger" ? "var(--danger)" : "var(--ok)" }}>{message?.text}</div>
    </section>
  );
}

export function FootfallCard({ footfall }: { footfall: Footfall }) {
  const max = Math.max(0, ...footfall.results.map((r) => r.visits));
  return (
    <section style={panelStyle} aria-label="Visits this week">
      <h2 style={headingStyle}>Visits this week</h2>
      <p style={{ ...mutedStyle, marginBottom: 8 }}>{footfall.total} visit{footfall.total === 1 ? "" : "s"} from {formatDate(footfall.from)} to {formatDate(footfall.to)}</p>
      {footfall.results.length === 0 ? <p style={mutedStyle}>No class has a library period yet.</p> : null}
      {footfall.results.map((row) => (
        <div key={row.school_class} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "var(--ink-1)", marginBottom: 3 }}>
            <span>{row.class_name}</span>
            <span style={{ color: "var(--ink-3)", fontVariantNumeric: "tabular-nums" }}>{row.visits} ({row.members} student{row.members === 1 ? "" : "s"})</span>
          </div>
          <Bar percent={barWidth(row.visits, max)} label={`${row.class_name} visits`} />
        </div>
      ))}
    </section>
  );
}

export function PrepBriefingCard({ briefing }: { briefing: PrepBriefing | Record<string, never> }) {
  const has = "slot" in briefing;
  return (
    <section style={panelStyle} aria-label="Prep for next period">
      <h2 style={headingStyle}>Prep for next period</h2>
      {!has ? (
        <p style={mutedStyle}>No upcoming library period. Add one with Manage periods.</p>
      ) : (
        <>
          <div style={{ fontSize: 14, color: "var(--ink-1)", marginBottom: 2 }}>
            <strong>{slotLabel(briefing.slot)}</strong> in {briefing.slot.room_label}, {briefing.slot.period_name} at {briefing.slot.start_time}
          </div>
          <p style={{ ...mutedStyle, marginBottom: 10 }}>{startsInText(briefing.starts_in_minutes, formatDate(briefing.date))}</p>
          <BriefList title="Books due back" count={briefing.due_back.count} empty="Nothing is due back from this class.">
            {briefing.due_back.rows.map((row) => (
              <li key={row.issue_id}>{row.book_title} <span style={{ color: "var(--ink-3)" }}>{row.member_name}{row.days_overdue > 0 ? `, ${row.days_overdue} day${row.days_overdue === 1 ? "" : "s"} overdue` : ""}</span></li>
            ))}
          </BriefList>
          <BriefList title="Blocked by dues" count={briefing.blocked.count} empty="Nobody in this class is blocked." tone="danger">
            {briefing.blocked.rows.map((row) => (
              <li key={row.member_id}>{row.member_name} <span style={{ color: "var(--ink-3)" }}>{row.card_no}</span></li>
            ))}
          </BriefList>
          <BriefList title="Holds ready to hand over" count={briefing.holds_ready.count} empty="No held title is waiting for this class.">
            {briefing.holds_ready.rows.map((row) => (
              <li key={row.hold_id}>{row.book_title} <span style={{ color: "var(--ink-3)" }}>{row.member_name}</span></li>
            ))}
          </BriefList>
        </>
      )}
    </section>
  );
}

function BriefList({ title, count, empty, tone = "neutral", children }: { title: string; count: number; empty: string; tone?: "neutral" | "danger"; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)", marginBottom: 3 }}>
        {title} <Pill tone={count > 0 ? (tone === "danger" ? "danger" : "info") : "neutral"}>{count}</Pill>
      </div>
      {count === 0 ? <p style={{ ...mutedStyle, fontSize: 12 }}>{empty}</p> : <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--ink-1)" }}>{children}</ul>}
    </div>
  );
}

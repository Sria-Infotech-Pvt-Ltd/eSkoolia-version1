"use client";

import type { WeekGrid } from "@/types/library";
import { thStyle } from "../catalogue/ui";
import { cellsByDayPeriod, DAY_LABEL, slotLabel } from "./periodsHelpers";

/** Monday to Saturday by class period. The cell of a period that is running now carries the live marker. */
export function WeekGridCard({ grid }: { grid: WeekGrid }) {
  const cells = cellsByDayPeriod(grid);
  if (grid.periods.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--ink-3)", margin: 12 }}>No class periods are set up yet, so there is no grid to show.</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }} aria-label="Library periods this week">
        <thead>
          <tr>
            <th style={thStyle}>Period</th>
            {grid.days.map((day) => (
              <th key={day} style={{ ...thStyle, color: day === grid.today ? "var(--pu-deep)" : "var(--ink-3)" }}>
                {DAY_LABEL[day]}
                {day === grid.today ? " (today)" : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.periods.map((period) => (
            <tr key={period.id}>
              <td style={{ padding: "8px", borderBottom: "1px solid var(--bd)", fontSize: 12, color: "var(--ink-2)", whiteSpace: "nowrap" }}>
                <strong>{period.name}</strong>
                <div style={{ color: "var(--ink-3)", fontSize: 11 }}>{period.start_time} to {period.end_time}</div>
              </td>
              {grid.days.map((day) => {
                const here = cells.get(`${day}|${period.id}`) ?? [];
                return (
                  <td key={day} style={{ padding: 4, borderBottom: "1px solid var(--bd)", verticalAlign: "top", minWidth: 110 }}>
                    {here.map((slot) => (
                      <div
                        key={slot.id}
                        style={{
                          padding: "4px 6px", borderRadius: 6, marginBottom: 3, fontSize: 12,
                          background: slot.live ? "var(--ok-soft)" : "var(--pu-soft)",
                          color: slot.live ? "var(--ok)" : "var(--pu-deep)",
                          border: slot.live ? "1px solid var(--ok)" : "1px solid transparent",
                        }}
                      >
                        <strong>{slotLabel(slot)}</strong>
                        <div style={{ fontSize: 11 }}>{slot.room_label}</div>
                        {slot.live ? <div style={{ fontSize: 10, fontWeight: 700 }}>LIVE NOW</div> : null}
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

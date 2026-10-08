"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getFootfall, getOccupancy, getPrepBriefing, getWeekGrid } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import type { Footfall, Occupancy, PrepBriefing, WeekGrid } from "@/types/library";
import { Btn, SkeletonRows, StateBox, useToast } from "../catalogue/ui";
import { POLL_INTERVAL_MS, shouldPoll } from "../console/consoleHelpers";
import { refusalMessage } from "../issue-desk/deskHelpers";
import { CheckInBox, FootfallCard, OccupancyCard, panelStyle, PrepBriefingCard } from "./PeriodsPanels";
import { SlotManager } from "./SlotManager";
import { WeekGridCard } from "./WeekGridCard";

export function PeriodsPage() {
  const { me, can } = usePermissions();
  const [grid, setGrid] = useState<WeekGrid | null>(null);
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
  const [footfall, setFootfall] = useState<Footfall | null>(null);
  const [briefing, setBriefing] = useState<PrepBriefing | Record<string, never> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const { show, node: toastNode } = useToast();
  const latest = useRef(0);
  const canView = can("library.periods.view");

  /** Everything on the page. `quiet` is the background refresh: no skeleton, and a failure keeps what is on screen. */
  const load = useCallback(async (quiet = false) => {
    const ticket = ++latest.current;
    if (!quiet) {
      setLoading(true);
      setError("");
    }
    try {
      const [g, o, f, b] = await Promise.all([
        getWeekGrid({ silent401: true }),
        getOccupancy(undefined, { silent401: true }),
        getFootfall(undefined, { silent401: true }),
        getPrepBriefing({ silent401: true }),
      ]);
      if (ticket !== latest.current) return;
      setGrid(g);
      setOccupancy(o);
      setFootfall(f);
      setBriefing(b);
      setError("");
    } catch (err) {
      if (ticket !== latest.current || quiet) return;
      setError(refusalMessage(err, "Could not load the library periods."));
    } finally {
      if (ticket === latest.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (me && canView) void load();
  }, [me, canView, load]);

  // Refresh every 30 seconds while the tab is visible.
  useEffect(() => {
    if (!me || !canView) return undefined;
    const timer = setInterval(() => {
      if (shouldPoll(typeof document === "undefined" ? undefined : document.visibilityState)) void load(true);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [me, canView, load]);

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
        <StateBox title="You do not have access to library periods">Ask an administrator to give your role the library periods view permission.</StateBox>
      </Shell>
    );
  }

  return (
    <Shell actions={can("library.periods.manage") ? <Btn variant="primary" onClick={() => setManaging(true)}>Manage periods</Btn> : null}>
      {loading ? (
        <SkeletonRows rows={8} columns={7} />
      ) : error || !grid || !occupancy || !footfall || !briefing ? (
        <StateBox tone="danger" title="Could not load the library periods">
          {error} <Btn small onClick={() => load()}>Retry</Btn>
        </StateBox>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            <OccupancyCard occupancy={occupancy} />
            {can("library.visits.check_in") ? <CheckInBox onCheckedIn={() => void load(true)} /> : null}
          </div>
          <section style={{ ...panelStyle, padding: 8 }} aria-label="Weekly grid">
            <h2 style={{ margin: "8px 8px 4px", fontSize: 15, color: "var(--ink-1)" }}>This week</h2>
            {grid.slots.filter((s) => s.is_active).length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--ink-3)", margin: "4px 8px 12px" }}>No library periods are set up yet.{can("library.periods.manage") ? " Use Manage periods to add the first one." : ""}</p>
            ) : null}
            <WeekGridCard grid={grid} />
          </section>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
            <FootfallCard footfall={footfall} />
            <PrepBriefingCard briefing={briefing} />
          </div>
        </div>
      )}
      {managing && grid ? (
        <SlotManager
          slots={grid.slots}
          periods={grid.periods}
          onClose={() => setManaging(false)}
          onChanged={(message) => {
            show(message);
            void load(true);
          }}
        />
      ) : null}
      {toastNode}
    </Shell>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Periods and occupancy</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>When each class visits the library, and who is here now</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>{actions}</div>
      </div>
      {children}
    </div>
  );
}

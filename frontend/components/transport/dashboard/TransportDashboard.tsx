"use client";
/**
 * Transport Command Center — /transport (Master Prompt §7.1). Exam Command
 * Center layout. Figures come from stored records: the dashboard summary API
 * (today's boardings, the weekly series, fuel spend, last GPS sync) and the
 * shared store (fleet, alerts, allocation, maintenance, saved settings).
 */
import {
  AlertTriangle, Bus, Car, ClipboardCheck, Clock, FileBarChart, Gauge, MapPin, Plus, Route, ShieldCheck,
  Sparkles, Users, Wrench,
} from "lucide-react";
import { useTransport, useVehicles } from "@/lib/transport/store";
import { capacityOf } from "@/lib/transport/catalog";
import { TODAY, clockOf, daysLeft, inr, num, plural, toISO } from "@/lib/transport/format";
import type { AlertSeverity, AlertType, TransportAlert } from "@/lib/transport/types";
import {
  AttentionItem, Breadcrumb, ModuleCard, QuickAction, SideCard, StatTile, T, TransportPage, useMountSkeleton,
  type AttnTone,
} from "@/components/transport/ui";
import { BoardingsChart } from "./BoardingsChart";

const SEV_ORDER: Record<AlertSeverity, number> = { Critical: 0, Warning: 1, Info: 2 };
const SEV_TONE: Record<AlertSeverity, AttnTone> = { Critical: "danger", Warning: "warn", Info: "info" };
const TYPE_ICON: Record<AlertType, React.ElementType> = {
  "Late arrival": Clock, Overspeed: Gauge, "Document expiry": ShieldCheck, SOS: AlertTriangle, Breakdown: Wrench, "Route deviation": Route,
};

function alertHref(a: TransportAlert): string {
  if (a.type === "Late arrival") return `/transport/live?id=${a.routeCode}`;
  if (a.type === "Document expiry" && a.ref?.vehicleId) return `/transport/vehicles?id=${a.ref.vehicleId}`;
  if (a.type === "Document expiry" && a.ref?.driverId) return `/transport/drivers?id=${a.ref.driverId}`;
  return `/transport/alerts?id=${a.id}`;
}

export function TransportDashboard() {
  const loading = useMountSkeleton();
  const { state } = useTransport();
  const vehicles = useVehicles();
  const d = state.dashboard;
  const { reminders } = state.settings;

  // Fleet
  const idle = vehicles.filter((v) => v.status === "Idle").length;
  const inService = vehicles.filter((v) => v.status === "Under maintenance").length;
  const brokenDown = vehicles.filter((v) => v.status === "Breakdown").length;
  const onRoad = vehicles.length - idle - inService - brokenDown;
  const seatsUsed = vehicles.reduce((s, v) => s + v.occupied, 0);
  const seatsTotal = vehicles.reduce((s, v) => s + capacityOf(v), 0);

  // Students & today's morning register
  const allocated = state.students.filter((s) => s.status === "Allocated");
  const pending = state.students.filter((s) => s.status === "Pending").length;
  const waitlisted = state.students.filter((s) => s.status === "Waitlisted").length;
  // Today's register for the current shift (dashboard summary API).
  const boarded = d?.students.boarded ?? 0;
  const notBoarded = Math.max(0, allocated.length - boarded);
  const shiftName = d?.shift === "afternoon" ? "afternoon drop" : "morning pickup";

  // Alerts
  const open = state.alerts.filter((a) => a.state !== "resolved");
  // Late buses = open late-arrival alerts.
  const late = [...new Set(open.filter((a) => a.type === "Late arrival").map((a) => a.routeCode || a.title))];
  const lateNote = late.length ? late.map((code) => `Route ${code}`).join(" · ") : "No late-arrival alerts open";
  const critOverspeed = open.filter((a) => a.type === "Overspeed" && a.severity === "Critical").length;
  const docExpiries = open.filter((a) => a.type === "Document expiry").length;

  // Maintenance & fuel
  // Archived vehicles' service records are not shown on Maintenance, so they don't count here either.
  const activeVehicleIds = new Set(vehicles.map((v) => v.id));
  const openService = state.maintenance.filter((r) => r.status !== "Completed" && activeVehicleIds.has(r.vehicleId));
  const dueThisWeek = openService.filter((r) => (r.status === "Due soon" || r.status === "Scheduled") && daysLeft(r.date) >= 0 && daysLeft(r.date) <= 7).length;
  const overdue = openService.filter((r) => r.status === "Overdue");
  const overduePlates = overdue.map((r) => state.vehicles.find((v) => v.id === r.vehicleId)?.reg).filter(Boolean).join(", ");
  const month = toISO(TODAY).slice(0, 7);
  const fuelMtd = d?.fuel.spendMtd ?? state.fuel.filter((f) => f.date.startsWith(month)).reduce((s, f) => s + f.amount, 0);

  // Staff & routes
  const drivers = state.drivers.filter((x) => !x.archived);
  const licencesDue = drivers.filter((x) => x.status !== "Inactive" && daysLeft(x.licenceValidTill) <= reminders.licenceDays).length;
  const stops = state.routes.reduce((s, r) => s + r.stops.length, 0);
  const avgRoute = state.routes.length ? Math.round(state.routes.reduce((s, r) => s + r.routeTimeMin, 0) / state.routes.length) : 0;

  const attention: { icon: React.ElementType; tone: AttnTone; title: string; sub: string; href: string }[] = [
    ...[...open]
      .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.ageMin - b.ageMin)
      .slice(0, pending > 0 ? 4 : 5)
      .map((a) => ({ icon: TYPE_ICON[a.type], tone: SEV_TONE[a.severity], title: a.title, sub: a.detail, href: alertHref(a) })),
    ...(pending > 0
      ? [{ icon: MapPin, tone: "info" as const, title: `${plural(pending, "student")} awaiting a pickup point`, sub: "Resolve in Student Allocation", href: "/transport/allocation" }]
      : []),
  ];

  return (
    <TransportPage hub>
      <Breadcrumb items={[{ label: "Dashboard", href: "/dashboard" }, { label: "Transport", href: "/transport" }, { label: "Command Center" }]} />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 22 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: T.exInk2 }}>
            Transport · {TODAY.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
          </div>
          <h1 style={{ margin: "6px 0 8px", fontSize: 34, lineHeight: 1.15, letterSpacing: "-0.01em" }}>
            <span style={{ fontFamily: "Georgia, serif", fontWeight: 900, color: T.exInk1 }}>Every route, </span>
            <span className="tp-serif" style={{ fontStyle: "italic", fontWeight: 500, color: T.exPu }}>every child, accounted for.</span>
          </h1>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: T.exInk2, maxWidth: 640 }}>
            {plural(state.routes.length, "active route")} and {plural(vehicles.length, "vehicle")} on record. Track buses live, clear today&apos;s
            alerts and keep fleet compliance current — all from one place.
          </p>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: T.exInk2 }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: T.dotOk }} />
          {d?.lastSynced ? `Last GPS sync ${clockOf(d.lastSynced)}` : "No GPS positions received yet"}
        </div>
      </div>

      <div className="tp-stat-grid">
        <StatTile loading={loading} icon={Bus} tone="neutral" label="Buses on road now" value={`${onRoad} / ${vehicles.length}`}
          note={`${idle} in depot · ${inService} under maintenance${brokenDown ? ` · ${brokenDown} broken down` : ""}`} />
        <StatTile loading={loading} icon={Users} tone="ok" label="Students onboard" value={num(boarded)}
          note={`of ${num(allocated.length)} allocated · today's ${shiftName}`} />
        <StatTile loading={loading} icon={Clock} tone={late.length ? "danger" : "ok"} label="Late buses" value={String(late.length)} note={lateNote} />
        <StatTile loading={loading} icon={AlertTriangle} tone={open.length ? "danger" : "ok"} label="Open alerts" value={String(open.length)}
          note={`${critOverspeed} critical overspeed, ${plural(docExpiries, "document expiry", "document expiries")}`} />
        <StatTile loading={loading} icon={Gauge} tone="neutral" label="Seat utilisation" value={`${seatsTotal ? Math.round((seatsUsed / seatsTotal) * 100) : 0}%`}
          note={`${num(seatsUsed)} seats used of ${num(seatsTotal)} across fleet`} />
        <StatTile loading={loading} icon={Wrench} tone={dueThisWeek + overdue.length ? "warn" : "ok"} label="Maintenance due" value={String(dueThisWeek + overdue.length)}
          note={`${dueThisWeek} this week · ${plural(overdue.length, "overdue service")}`} />
      </div>

      <div className="tp-hub-cols">
        <div className="tp-module-grid">
          <ModuleCard icon={Car} rhythm="Set once" title="Fleet & Staff" dot={licencesDue ? "warn" : "ok"}
            description={`${vehicles.length} vehicles, ${drivers.length} drivers and ${state.attendants.filter((x) => !x.archived).length} attendants on record. ${licencesDue ? `${plural(licencesDue, "licence")} due for renewal within ${reminders.licenceDays} days.` : `No licence renewals due within ${reminders.licenceDays} days.`}`}
            ctas={[{ label: "Manage vehicles", href: "/transport/vehicles", variant: "primary" }, { label: "Drivers", href: "/transport/drivers", variant: "outline" }]} />
          <ModuleCard icon={Route} rhythm="Per term" title="Routes & Pickup Points" dot="ok"
            description={`${state.routes.length} routes and ${stops} pickup points published.${avgRoute ? ` Avg route time ${avgRoute} min.` : ""}`}
            ctas={[{ label: "Plan routes", href: "/transport/routes", variant: "primary" }, { label: "Pickup points", href: "/transport/routes?section=pickup-points", variant: "outline" }]} />
          <ModuleCard icon={Users} rhythm="Per term" title="Student Allocation" dot={pending + waitlisted ? "warn" : "ok"}
            description={`${num(allocated.length)} students allocated · ${pending} pending a pickup point · ${waitlisted} on the waitlist.`}
            ctas={[{ label: "Resolve pending", href: "/transport/allocation", variant: "primary" }]} />
          <ModuleCard icon={ClipboardCheck} rhythm="Daily" title="Daily Operations" dot={late.length ? "danger" : notBoarded ? "warn" : "ok"}
            description={`${plural(late.length, "late-arrival alert")} open. ${plural(notBoarded, "student")} not yet boarded on today's ${shiftName}.`}
            ctas={[{ label: "Open live tracking", href: "/transport/live", variant: late.length ? "danger" : "primary" }, { label: "Attendance", href: "/transport/allocation?section=attendance", variant: "outline" }]} />
          <ModuleCard icon={Wrench} rhythm="Monthly" title="Cost & Upkeep" dot={overdue.length ? "warn" : "ok"}
            description={`Fuel spend ${inr(fuelMtd)} MTD · ${overdue.length ? `${plural(overdue.length, "service")} overdue on ${overduePlates}.` : "no services overdue."}`}
            ctas={[{ label: "Maintenance", href: "/transport/maintenance", variant: "outline" }, { label: "Fuel log", href: "/transport/maintenance?section=fuel", variant: "outline" }]} />
          <ModuleCard icon={FileBarChart} rhythm="Live" title="Reports" dot="ok" span2
            description="Route-wise strength, vehicle utilisation, fee collection, duty roster, boarding register and cost reports — generated as PDF or Excel."
            ctas={[{ label: "Open reports", href: "/transport/reports", variant: "outline" }]} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <SideCard>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
              <Sparkles size={15} color={T.exPu} strokeWidth={1.8} />
              <span style={{ fontSize: 13, fontWeight: 700, color: T.exInk1, flex: 1 }}>Needs attention</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: T.danger, background: T.dangerSoft, borderRadius: 999, padding: "2px 8px" }}>
                {open.length} open
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {attention.length === 0 && <div style={{ fontSize: 12, color: T.exInk3 }}>Nothing needs attention right now.</div>}
              {attention.map((a) => <AttentionItem key={a.title + a.href} {...a} />)}
            </div>
          </SideCard>

          <SideCard>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Plus size={14} color={T.exInk2} strokeWidth={2} />
              <span style={{ fontSize: 13, fontWeight: 700, color: T.exInk1 }}>Quick actions</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <QuickAction icon={Plus} label="Add a vehicle" href="/transport/vehicles?new=1" />
              <QuickAction icon={Route} label="Create a route" href="/transport/routes?new=1" />
              <QuickAction icon={Users} label="Bulk allocate students" href="/transport/allocation?new=1" />
              <QuickAction icon={ClipboardCheck} label="Mark today's attendance" href="/transport/allocation?section=attendance" />
              <QuickAction icon={Wrench} label="Log a service" href="/transport/maintenance?new=1" />
              <QuickAction icon={FileBarChart} label="Generate boarding register" href={`/transport/reports?id=${encodeURIComponent("Daily boarding register")}`} />
            </div>
          </SideCard>

          <BoardingsChart data={d?.boardingsWeek ?? []} />
        </div>
      </div>
    </TransportPage>
  );
}

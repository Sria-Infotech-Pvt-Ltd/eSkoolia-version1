"use client";
/**
 * Transport Settings — /transport/settings (Master Prompt §7.14). Each section
 * edits a local draft; Save stores it per school (PATCH transport-settings/save/).
 * Saved values drive Live Tracking (overspeed, geofence), the backend's overspeed
 * alerts and expiry windows (reminder days), and default fares for new stops.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, Coins, Settings as SettingsIcon, ShieldCheck, X } from "lucide-react";
import { useTransport } from "@/lib/transport/store";
import type { FareSlab, TransportSettings } from "@/lib/transport/types";
import {
  Badge, Button, Field, HeroPrimary, HeroSecondary, Input, KpiCard, KpiGrid, OutlineButton, PageHero, SearchRow, Select, SimpleAccordion,
  SmartFilter, Switch, T, TransportPage, useDeepLink, useMountSkeleton, useTpToast, type FilterChip,
} from "@/components/transport/ui";

type SectionKey = "general" | "alerts" | "notifications" | "fares" | "documents";
const KEYS: Record<SectionKey, (keyof TransportSettings)[]> = {
  general: ["geofence", "shifts"], alerts: ["thresholds"], notifications: ["notifications"], fares: ["fees", "fareSlabs"], documents: ["reminders"],
};
const SECTIONS: { key: SectionKey; title: string; description: string; category: string; icon: React.ElementType; fields: string[] }[] = [
  { key: "general", title: "General", description: "School geofence and default shift times", category: "Operations", icon: SettingsIcon,
    fields: ["School latitude", "School longitude", "Geofence radius (m)", "Morning pickup starts", "School arrival by", "Afternoon drop starts"] },
  { key: "alerts", title: "Alerts & thresholds", description: "Overspeed, late arrival and route deviation limits", category: "Safety", icon: AlertTriangle,
    fields: ["Overspeed limit (km/h)", "Late-arrival threshold (min)", "Route deviation (m)", "Idle engine alert (min)", "SOS escalation"] },
  { key: "notifications", title: "Parent notifications", description: "SMS and app messages sent to parents", category: "Parents", icon: Bell,
    fields: ["Boarded / dropped alerts", "Bus approaching stop", "Delay alerts", "SMS fallback", "Message language"] },
  { key: "fares", title: "Fare rules", description: "Distance slabs used to price each pickup point", category: "Finance", icon: Coins,
    fields: ["Billing cycle", "Sibling concession (%)", "Distance slabs", "Slab", "Monthly fare"] },
  { key: "documents", title: "Documents", description: "Expiry reminders for vehicle and staff documents", category: "Compliance", icon: ShieldCheck,
    fields: ["Vehicle document reminder (days)", "Driver licence reminder (days)", "First-aid certificate reminder (days)", "Block expired vehicles from routes"] },
];
const ALL = "all";

function pick(s: TransportSettings, key: SectionKey): Partial<TransportSettings> {
  return Object.fromEntries(KEYS[key].map((k) => [k, s[k]])) as Partial<TransportSettings>;
}

export function SettingsPage() {
  const { state, dispatch } = useTransport();
  const saved = state.settings;
  const { toast } = useTpToast();
  const loading = useMountSkeleton();

  const [draft, setDraft] = useState<TransportSettings>(() => structuredClone(saved));
  // When saved settings change (first load, or after a save), sections the user
  // hasn't edited follow the new saved values; edited sections keep the draft.
  const prevSaved = useRef(saved);
  // Settings just saved from this page: their draft adopts the stored values, which the backend
  // may have normalised (e.g. fare slabs sorted, fares rounded), so they don't stay "unsaved".
  const justSaved = useRef<Set<string>>(new Set());
  useEffect(() => {
    const before = prevSaved.current;
    prevSaved.current = saved;
    if (before === saved) return;
    const adopt = justSaved.current;
    justSaved.current = new Set();
    setDraft((d) => {
      const next = { ...d };
      (Object.keys(saved) as (keyof TransportSettings)[]).forEach((k) => {
        if (adopt.has(k) || JSON.stringify(d[k]) === JSON.stringify(before[k])) (next as Record<string, unknown>)[k] = structuredClone(saved[k]);
      });
      return next;
    });
  }, [saved]);
  const [open, setOpen] = useState<Set<SectionKey>>(new Set(["general"]));
  const [fCat, setFCat] = useState(ALL);
  const [fShow, setFShow] = useState(ALL);
  const [fSections, setFSections] = useState("custom");
  const [query, setQuery] = useState("");
  const [applied, setApplied] = useState("");

  const isDirty = (key: SectionKey) => JSON.stringify(pick(draft, key)) !== JSON.stringify(pick(saved, key));
  const dirtyKeys = SECTIONS.map((s) => s.key).filter(isDirty);

  const visible = useMemo(() => {
    const q = applied.toLowerCase();
    return SECTIONS.filter((s) => {
      if (fCat !== ALL && s.category !== fCat) return false;
      if (fShow === "unsaved" && !dirtyKeys.includes(s.key)) return false;
      if (q && ![s.title, s.description, ...s.fields].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [fCat, fShow, applied, dirtyKeys]);

  const chips: FilterChip[] = [
    ...(fCat !== ALL ? [{ label: `Category: ${fCat}`, tone: "purple" as const }] : []),
    ...(fShow !== ALL ? [{ label: "Unsaved only", tone: "purple" as const }] : []),
    ...(applied ? [{ label: `Search: "${applied}"`, tone: "blue" as const }] : []),
  ];

  const patch = <K extends keyof TransportSettings>(k: K, value: TransportSettings[K]) => setDraft((d) => ({ ...d, [k]: value }));
  const notifOn = [saved.notifications.boardedDropped, saved.notifications.approaching, saved.notifications.delay, saved.notifications.smsFallback].filter(Boolean).length;

  const validate = (keys: SectionKey[]) => {
    if (keys.includes("alerts") && draft.thresholds.overspeed > 60) { toast("Overspeed limit can't exceed 60 km/h", "error"); return false; }
    if (keys.includes("general") && (draft.geofence.lat === null) !== (draft.geofence.lng === null)) {
      toast("Enter both the school latitude and longitude", "error"); return false;
    }
    return true;
  };
  const saveSection = async (key: SectionKey, title: string) => {
    if (!validate([key])) return;
    const patch = pick(draft, key);
    justSaved.current = new Set(Object.keys(patch));
    if (await dispatch({ type: "settings/save", patch })) toast(`${title} saved`);
    else { justSaved.current = new Set(); toast("Not saved — see the message above", "error"); }
  };
  const discardSection = (key: SectionKey, title: string) => {
    setDraft((d) => ({ ...d, ...structuredClone(pick(saved, key)) }));
    toast(`${title} changes discarded`, "info");
  };
  const saveAll = async () => {
    if (dirtyKeys.length === 0) { toast("Nothing to save", "info"); return; }
    if (!validate(dirtyKeys)) return;
    const patch = Object.assign({}, ...dirtyKeys.map((k) => pick(draft, k)));
    justSaved.current = new Set(Object.keys(patch));
    if (await dispatch({ type: "settings/save", patch })) toast("All changes saved", "info");
    else { justSaved.current = new Set(); toast("Not saved — see the message above", "error"); }
  };
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(saved, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "transport-settings.json"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Settings exported as JSON");
  };

  const allKeys = SECTIONS.map((s) => s.key);
  useDeepLink(({ id }) => {
    const s = SECTIONS.find((x) => x.key === id || x.title.toLowerCase() === id?.toLowerCase());
    if (s) setOpen(new Set([s.key]));
  });

  const resetFilters = () => { setFCat(ALL); setFShow(ALL); setFSections("custom"); setQuery(""); setApplied(""); };
  const toggle = (k: SectionKey) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const slabs = draft.fareSlabs;
  const setSlab = (i: number, field: keyof FareSlab, value: string) =>
    patch("fareSlabs", slabs.map((s, j) => (j === i ? { ...s, [field]: Math.max(0, Number(value) || 0) } : s)));
  const addSlab = () => {
    const last = slabs[slabs.length - 1] ?? { from: 0, to: 0, fare: 1000 };
    patch("fareSlabs", [...slabs, { from: last.to, to: last.to + 5, fare: last.fare + 400 }]);
  };

  const body = (key: SectionKey) => {
    switch (key) {
      case "general":
        return (
          <div className="tp-form-grid">
            <Field label="School latitude" hint={draft.geofence.lat === null ? "Not set yet · centre of the school geofence" : "Centre of the school geofence"}>
              <Input type="number" step="0.000001" value={draft.geofence.lat ?? ""} placeholder="e.g. 17.4935"
                onChange={(e) => patch("geofence", { ...draft.geofence, lat: e.target.value === "" ? null : Number(e.target.value) })} className="tp-mono" />
            </Field>
            <Field label="School longitude">
              <Input type="number" step="0.000001" value={draft.geofence.lng ?? ""} placeholder="e.g. 78.3812"
                onChange={(e) => patch("geofence", { ...draft.geofence, lng: e.target.value === "" ? null : Number(e.target.value) })} className="tp-mono" />
            </Field>
            <Field label="Geofence radius (m)" hint="Buses inside this radius count as arrived">
              <Input type="number" min={0} value={draft.geofence.radius} onChange={(e) => patch("geofence", { ...draft.geofence, radius: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Morning pickup starts" hint="Earliest first-stop time across routes">
              <Input type="time" value={draft.shifts.morningPickup} onChange={(e) => patch("shifts", { ...draft.shifts, morningPickup: e.target.value })} />
            </Field>
            <Field label="School arrival by" hint="Late alerts fire after this">
              <Input type="time" value={draft.shifts.schoolArrival} onChange={(e) => patch("shifts", { ...draft.shifts, schoolArrival: e.target.value })} />
            </Field>
            <Field label="Afternoon drop starts">
              <Input type="time" value={draft.shifts.afternoonDrop} onChange={(e) => patch("shifts", { ...draft.shifts, afternoonDrop: e.target.value })} />
            </Field>
          </div>
        );
      case "alerts":
        return (
          <div className="tp-form-grid">
            <Field label="Overspeed limit (km/h)" hint="State guideline for school buses is 50 km/h in city limits">
              <Input type="number" min={0} value={draft.thresholds.overspeed} onChange={(e) => patch("thresholds", { ...draft.thresholds, overspeed: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Late-arrival threshold (min)" hint="Minutes behind schedule before an alert">
              <Input type="number" min={0} value={draft.thresholds.lateMin} onChange={(e) => patch("thresholds", { ...draft.thresholds, lateMin: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Route deviation (m)" hint="Distance off the planned path">
              <Input type="number" min={0} value={draft.thresholds.deviationM} onChange={(e) => patch("thresholds", { ...draft.thresholds, deviationM: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Idle engine alert (min)" hint="Engine on, vehicle stationary">
              <Input type="number" min={0} value={draft.thresholds.idleMin} onChange={(e) => patch("thresholds", { ...draft.thresholds, idleMin: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="SOS escalation" hint="Who is called first">
              <Select value={draft.thresholds.sosEscalation} onChange={(e) => patch("thresholds", { ...draft.thresholds, sosEscalation: e.target.value })}>
                {["Transport in-charge", "Principal", "Both together"].map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            </Field>
          </div>
        );
      case "notifications": {
        const n = draft.notifications;
        const sw = (label: string, hint: string, k: "boardedDropped" | "approaching" | "delay" | "smsFallback") => (
          <Field label={label} hint={hint}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44 }}>
              <Switch checked={n[k]} onChange={() => patch("notifications", { ...n, [k]: !n[k] })} label={label} />
              <span style={{ fontSize: 13, color: T.ink }}>{n[k] ? "On" : "Off"}</span>
            </span>
          </Field>
        );
        return (
          <div className="tp-form-grid">
            {sw("Boarded / dropped alerts", "App push when the RFID card is scanned", "boardedDropped")}
            {sw("Bus approaching stop", "10 minutes before the scheduled pickup", "approaching")}
            {sw("Delay alerts", "When the bus is past the late threshold", "delay")}
            {sw("SMS fallback", "For parents without the app · charges apply", "smsFallback")}
            <Field label="Message language">
              <Select value={n.language} onChange={(e) => patch("notifications", { ...n, language: e.target.value })}>
                {["English", "Telugu", "Hindi"].map((x) => <option key={x} value={x}>{x}</option>)}
              </Select>
            </Field>
          </div>
        );
      }
      case "fares":
        return (
          <div>
            <div className="tp-form-grid" style={{ marginBottom: 16 }}>
              <Field label="Billing cycle" hint="Synced to the Fees module">
                <Select value={draft.fees.billingCycle} onChange={(e) => patch("fees", { ...draft.fees, billingCycle: e.target.value })}>
                  {["Monthly", "Quarterly", "Per term"].map((x) => <option key={x} value={x}>{x}</option>)}
                </Select>
              </Field>
              <Field label="Sibling concession (%)" hint="Applied to the second child onwards">
                <Input type="number" min={0} max={100} value={draft.fees.siblingConcession} onChange={(e) => patch("fees", { ...draft.fees, siblingConcession: Number(e.target.value) || 0 })} />
              </Field>
            </div>
            <div className="tp-scroll-x" style={{ border: `1px solid ${T.cardBd}`, borderRadius: 12 }}>
              <table className="tp-table" style={{ minWidth: 560 }}>
                <thead><tr><th>Slab</th><th>From (km)</th><th>To (km)</th><th>Monthly fare (₹)</th><th style={{ textAlign: "right" }}><span className="sr-only">Remove</span></th></tr></thead>
                <tbody>
                  {slabs.map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 700 }}>Slab {i + 1}</td>
                      {(["from", "to", "fare"] as const).map((f) => (
                        <td key={f}>
                          <input type="number" min={0} value={s[f]} aria-label={`Slab ${i + 1} ${f}`} onChange={(e) => setSlab(i, f, e.target.value)}
                            style={{ height: 36, width: "100%", maxWidth: f === "fare" ? 140 : 120, border: `1px solid ${T.modalBd}`, borderRadius: 9, padding: "0 10px", fontSize: 13, color: T.ink }} />
                        </td>
                      ))}
                      <td style={{ textAlign: "right" }}>
                        <button type="button" className="tp-btn-row" aria-label={`Remove slab ${i + 1}`} onClick={() => patch("fareSlabs", slabs.filter((_, j) => j !== i))}><X size={14} strokeWidth={2} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10 }}><OutlineButton onClick={addSlab}>+ Add slab</OutlineButton></div>
          </div>
        );
      case "documents":
      default:
        return (
          <div className="tp-form-grid">
            <Field label="Vehicle document reminder (days)" hint="Insurance, fitness, permit, PUC">
              <Input type="number" min={0} value={draft.reminders.vehicleDocsDays} onChange={(e) => patch("reminders", { ...draft.reminders, vehicleDocsDays: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Driver licence reminder (days)">
              <Input type="number" min={0} value={draft.reminders.licenceDays} onChange={(e) => patch("reminders", { ...draft.reminders, licenceDays: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="First-aid certificate reminder (days)">
              <Input type="number" min={0} value={draft.reminders.firstAidDays} onChange={(e) => patch("reminders", { ...draft.reminders, firstAidDays: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Block expired vehicles from routes" hint="Prevents assigning a vehicle with an expired document">
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minHeight: 44 }}>
                <Switch checked={draft.reminders.blockExpired} onChange={() => patch("reminders", { ...draft.reminders, blockExpired: !draft.reminders.blockExpired })} label="Block expired vehicles from routes" />
                <span style={{ fontSize: 13, color: T.ink }}>{draft.reminders.blockExpired ? "On" : "Off"}</span>
              </span>
            </Field>
          </div>
        );
    }
  };

  return (
    <TransportPage>
      <PageHero eyebrow="Transport · Configuration" title="Transport" accent="settings"
        sub="Geofence, shift timings, safety thresholds, parent notifications, fare slabs and document reminders for this campus."
        actions={<>
          <HeroSecondary onClick={exportJson}>Export JSON</HeroSecondary>
          <HeroPrimary icon={false} onClick={() => { void saveAll(); }}>Save all changes</HeroPrimary>
        </>} />

      <KpiGrid>
        <KpiCard loading={loading} label="Overspeed limit" value={`${saved.thresholds.overspeed} km/h`} sub="Alerts above this speed" color={T.red} />
        <KpiCard loading={loading} label="Late threshold" value={`${saved.thresholds.lateMin} min`} sub="Behind schedule before alerting" color={T.amber} />
        <KpiCard loading={loading} label="Notifications" value={`${notifOn} / 4`} sub="Parent channels switched on" color={T.green} />
        <KpiCard loading={loading} label="Unsaved sections" value={dirtyKeys.length} sub={dirtyKeys.length ? "Save before leaving this page" : "Everything is saved"} color={T.pu} />
      </KpiGrid>

      <SmartFilter chips={chips} onReset={resetFilters} fields={[
        { key: "cat", label: "Category", value: fCat, onChange: setFCat,
          options: [{ value: ALL, label: "All" }, ...["Operations", "Safety", "Parents", "Finance", "Compliance"].map((x) => ({ value: x, label: x }))] },
        { key: "show", label: "Show", value: fShow, onChange: setFShow, options: [{ value: ALL, label: "All sections" }, { value: "unsaved", label: "Unsaved only" }] },
        { key: "sections", label: "Sections", value: fSections, onChange: (v) => { setFSections(v); if (v === "collapsed") setOpen(new Set()); if (v === "expanded") setOpen(new Set(allKeys)); },
          options: [{ value: "custom", label: "As set" }, { value: "collapsed", label: "Collapsed" }, { value: "expanded", label: "Expanded" }] },
        { key: "campus", label: "Campus", value: "this", onChange: () => {}, options: [{ value: "this", label: "This campus" }] },
      ]} />

      <SearchRow value={query} onChange={setQuery} onSubmit={() => { setApplied(query.trim()); if (query.trim()) setOpen(new Set(allKeys)); }}
        placeholder="Search settings…" allSelected={false} onToggleAll={() => setOpen(new Set(allKeys))} onExport={exportJson} />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {visible.length === 0 && (
          <div className="tp-card" style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: T.muted }}>No settings match your search.</div>
        )}
        {visible.map((s) => (
          <SimpleAccordion key={s.key} icon={s.icon} title={s.title} description={s.description} open={open.has(s.key)} onToggle={() => toggle(s.key)}
            right={isDirty(s.key) ? <Badge tone="amber">Unsaved changes</Badge> : undefined}>
            {body(s.key)}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
              <Button type="button" variant="ghost" onClick={() => discardSection(s.key, s.title)}>Discard</Button>
              <Button type="button" variant="primary" onClick={() => saveSection(s.key, s.title)}>Save changes</Button>
            </div>
          </SimpleAccordion>
        ))}
      </div>
    </TransportPage>
  );
}

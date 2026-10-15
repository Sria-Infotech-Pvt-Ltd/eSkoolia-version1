"use client";
/**
 * Routes modals: stop form, edit route, move stops and the 4-step Add Route wizard
 * (Master Prompt §7.5). Stops are real map points, so every new stop needs its
 * latitude / longitude (used for GPS arrival detection and the maps).
 */
import { useState } from "react";
import { X } from "lucide-react";
import { daysLeft, fmtTime } from "@/lib/transport/format";
import type { NewRouteInput, RoutePatch } from "@/lib/transport/actions";
import type { Attendant, Driver, RouteShift, TransportRoute } from "@/lib/transport/types";
import {
  Button, Field, InfoRow, Input, LAYER, Modal, Select, StepWizard, T, useTpToast,
} from "@/components/transport/ui";

export interface StopFormValues { name: string; landmark: string; fare: string; lat: string; lng: string; pickupTime: string; dropTime: string }

/** "17.4935" → 17.4935 within range, else null. */
export function coord(value: string, limit: number): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

export function StopFormModal({
  mode, routeLabel, initial, onClose, onSubmit,
}: { mode: "add" | "edit"; routeLabel: string; initial: StopFormValues; onClose: () => void; onSubmit: (v: StopFormValues) => void }) {
  const { toast } = useTpToast();
  const [v, setV] = useState(initial);
  const [errors, setErrors] = useState<{ name?: string; lat?: string; lng?: string }>({});
  const submit = () => {
    const e: typeof errors = {};
    if (!v.name.trim()) e.name = "This field is required.";
    if (coord(v.lat, 90) === null) e.lat = "Enter a latitude between -90 and 90.";
    if (coord(v.lng, 180) === null) e.lng = "Enter a longitude between -180 and 180.";
    setErrors(e);
    if (Object.keys(e).length) { toast("Fill in the required fields", "error"); return; }
    onSubmit({ ...v, name: v.name.trim() });
  };
  return (
    <Modal open onClose={onClose} size="md" title={mode === "add" ? "Add stop" : "Edit stop"} subtitle={`${routeLabel} · stop details and monthly fare`}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>{mode === "add" ? "Add stop" : "Save changes"}</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Stop name" required error={errors.name}>
          <Input value={v.name} onChange={(e) => { setV({ ...v, name: e.target.value }); setErrors((x) => ({ ...x, name: undefined })); }} placeholder="e.g. Kothaguda X Rd" />
        </Field>
        <Field label="Landmark"><Input value={v.landmark} onChange={(e) => setV({ ...v, landmark: e.target.value })} placeholder="e.g. near bus shelter" /></Field>
        <Field label="Latitude" required error={errors.lat}>
          <Input type="number" step="0.000001" value={v.lat} onChange={(e) => { setV({ ...v, lat: e.target.value }); setErrors((x) => ({ ...x, lat: undefined })); }} placeholder="e.g. 17.4486" />
        </Field>
        <Field label="Longitude" required error={errors.lng}>
          <Input type="number" step="0.000001" value={v.lng} onChange={(e) => { setV({ ...v, lng: e.target.value }); setErrors((x) => ({ ...x, lng: undefined })); }} placeholder="e.g. 78.3908" />
        </Field>
        <Field label="Pickup time"><Input type="time" value={v.pickupTime} onChange={(e) => setV({ ...v, pickupTime: e.target.value })} /></Field>
        <Field label="Drop time"><Input type="time" value={v.dropTime} onChange={(e) => setV({ ...v, dropTime: e.target.value })} /></Field>
        <Field label="Monthly fare (₹)" hint="Charged per student per month">
          <Input type="number" min={0} value={v.fare} onChange={(e) => setV({ ...v, fare: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function EditRouteModal({
  route, plates, drivers, attendants, onClose, onSubmit,
}: {
  route: TransportRoute; plates: string[]; drivers: Driver[]; attendants: Attendant[];
  onClose: () => void; onSubmit: (patch: RoutePatch) => void;
}) {
  const { toast } = useTpToast();
  const [v, setV] = useState<RoutePatch>({
    name: route.name, zone: route.zone, busReg: route.busReg, driverName: route.driverName,
    attendantName: route.attendantName, firstPickup: route.firstPickup,
  });
  const [error, setError] = useState<string | undefined>();
  const withCurrent = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);
  const submit = () => {
    if (!v.name.trim()) { setError("This field is required."); toast("Fill in the required fields", "error"); return; }
    onSubmit({ ...v, name: v.name.trim() });
  };
  return (
    <Modal open onClose={onClose} size="md" title={`Edit route ${route.code}`} subtitle="Name, crew, vehicle and first pickup time"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Save route</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Route name" required error={error}>
          <Input value={v.name} onChange={(e) => { setV({ ...v, name: e.target.value }); setError(undefined); }} />
        </Field>
        <Field label="Zone">
          <Input value={v.zone} onChange={(e) => setV({ ...v, zone: e.target.value })} placeholder="e.g. West" />
        </Field>
        <Field label="Vehicle" hint="Changing the bus updates Live Tracking and Attendance">
          <Select value={v.busReg} onChange={(e) => setV({ ...v, busReg: e.target.value })}>
            {!route.busReg && <option value="">No vehicle</option>}
            {withCurrent(plates, route.busReg).map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        </Field>
        <Field label="Driver" hint="Drives the route's vehicle">
          <Select value={v.driverName} onChange={(e) => setV({ ...v, driverName: e.target.value })}>
            <option value="">Keep current driver</option>
            {withCurrent(drivers.map((d) => d.name), route.driverName).map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Field label="Attendant">
          <Select value={v.attendantName} onChange={(e) => setV({ ...v, attendantName: e.target.value })}>
            <option value="">Keep current attendant</option>
            {withCurrent(attendants.map((a) => a.name), route.attendantName).map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
        <Field label="First pickup time">
          <Input type="time" value={v.firstPickup} onChange={(e) => setV({ ...v, firstPickup: e.target.value || route.firstPickup })} />
        </Field>
      </div>
    </Modal>
  );
}

export function MoveStopsModal({
  title, subtitle, fieldLabel, cta, routes, onClose, onSubmit,
}: {
  title: string; subtitle: string; fieldLabel: string; cta: string; routes: TransportRoute[];
  onClose: () => void; onSubmit: (code: string) => void;
}) {
  const { toast } = useTpToast();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    if (!code) { setError("This field is required."); toast("Fill in the required fields", "error"); return; }
    onSubmit(code);
  };
  return (
    <Modal open onClose={onClose} size="sm" title={title} subtitle={subtitle}
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>{cta}</Button>
      </>}>
      <Field label={fieldLabel} required error={error}>
        <Select value={code} onChange={(e) => { setCode(e.target.value); setError(undefined); }}>
          <option value="">Choose a route</option>
          {routes.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}

// ─── Add Route wizard ────────────────────────────────────────────────────────

const STEPS = [
  { label: "Basics", hint: "Code & shift" },
  { label: "Stops", hint: "Pickup order" },
  { label: "Vehicle & Staff", hint: "Crew" },
  { label: "Review", hint: "Confirm" },
];

export function AddRouteWizard({
  existingCodes, plates, freePlates, drivers, attendants, onClose, onCreate,
}: {
  existingCodes: string[]; plates: string[]; freePlates: string[]; drivers: Driver[]; attendants: Attendant[];
  onClose: () => void; onCreate: (input: NewRouteInput) => void;
}) {
  const { toast } = useTpToast();
  const [step, setStep] = useState(1);
  const [code, setCode] = useState(`R${existingCodes.length + 1}`);
  const [name, setName] = useState("");
  const [shift, setShift] = useState<RouteShift>("Morning + afternoon");
  const [first, setFirst] = useState("06:40");
  const [stops, setStops] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [stopInput, setStopInput] = useState("");
  const [latInput, setLatInput] = useState("");
  const [lngInput, setLngInput] = useState("");
  // Vehicles without a route first.
  const vehicleOptions = [...freePlates, ...plates.filter((p) => !freePlates.includes(p))];
  const driverOptions = drivers.filter((d) => !d.archived && d.status !== "Inactive" && daysLeft(d.licenceValidTill) >= 0).map((d) => d.name);
  const attendantOptions = attendants.filter((a) => !a.archived && a.status !== "Inactive" && daysLeft(a.firstAidValidTill) >= 0).map((a) => a.name);
  const [bus, setBus] = useState(vehicleOptions[0] ?? "");
  const [driver, setDriver] = useState(driverOptions[0] ?? "");
  const [attendant, setAttendant] = useState(attendantOptions[0] ?? "");
  const [errors, setErrors] = useState<{ code?: string; name?: string; stops?: string }>({});

  const addStop = () => {
    const n = stopInput.trim();
    const lat = coord(latInput, 90);
    const lng = coord(lngInput, 180);
    if (!n || lat === null || lng === null) {
      setErrors((e) => ({ ...e, stops: "Enter the stop name, latitude and longitude." }));
      return;
    }
    // Stop names are unique per route; a duplicate would fail midway through Create route.
    if (stops.some((s) => s.name === n)) {
      setErrors((e) => ({ ...e, stops: `"${n}" is already a stop on this route.` }));
      return;
    }
    setStops((s) => [...s, { name: n, lat, lng }]);
    setStopInput(""); setLatInput(""); setLngInput("");
    setErrors((e) => ({ ...e, stops: undefined }));
  };

  const next = () => {
    if (step === 1) {
      const e: typeof errors = {};
      const c = code.trim().toUpperCase();
      if (!c) e.code = "This field is required.";
      else if (existingCodes.includes(c)) e.code = "This route code is already in use.";
      if (!name.trim()) e.name = "This field is required.";
      setErrors(e);
      if (e.code || e.name) { toast("Fill in the required fields", "error"); return; }
    }
    if (step === 2 && stops.length < 2) {
      setErrors({ stops: "Add at least two stops to continue." });
      toast("Add at least two stops to continue.", "error");
      return;
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const create = () => onCreate({
    code: code.trim().toUpperCase(), name: name.trim(), shift, firstPickup: first, stops,
    busReg: bus, driverName: driver, attendantName: attendant,
  });

  return (
    <Modal open onClose={onClose} size="lg" priority={LAYER.wizard} title="Add route" subtitle="Four steps · you can go back at any time"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <span style={{ flex: 1 }} />
        {step > 1 && <Button type="button" variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button>}
        {step < 4
          ? <Button type="button" variant="primary" onClick={next}>Next</Button>
          : <Button type="button" variant="primary" onClick={create}>Create route</Button>}
      </>}>
      <div className="tp-scroll-x" style={{ marginBottom: 22 }}>
        <StepWizard steps={STEPS} currentStep={step} onStepClick={(n) => { if (n < step) setStep(n); }} />
      </div>

      {step === 1 && (
        <div className="tp-form-grid">
          <Field label="Route code" required error={errors.code}>
            <Input value={code} onChange={(e) => { setCode(e.target.value); setErrors((x) => ({ ...x, code: undefined })); }} className="tp-mono" />
          </Field>
          <Field label="Route name" required error={errors.name}>
            <Input value={name} onChange={(e) => { setName(e.target.value); setErrors((x) => ({ ...x, name: undefined })); }} placeholder="e.g. Kokapet – Narsingi" />
          </Field>
          <Field label="Shift">
            <Select value={shift} onChange={(e) => setShift(e.target.value as RouteShift)}>
              {(["Morning + afternoon", "Morning only", "Afternoon only"] as RouteShift[]).map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
          </Field>
          <Field label="First pickup time"><Input type="time" value={first} onChange={(e) => setFirst(e.target.value || "06:40")} /></Field>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 200px" }}>
              <Input value={stopInput} onChange={(e) => setStopInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStop(); } }}
                placeholder="Stop name, e.g. Kothaguda X Rd" aria-label="Stop name" />
            </div>
            <div style={{ flex: "1 1 110px" }}>
              <Input type="number" step="0.000001" value={latInput} onChange={(e) => setLatInput(e.target.value)} placeholder="Latitude" aria-label="Latitude" />
            </div>
            <div style={{ flex: "1 1 110px" }}>
              <Input type="number" step="0.000001" value={lngInput} onChange={(e) => setLngInput(e.target.value)} placeholder="Longitude" aria-label="Longitude" />
            </div>
            <Button type="button" variant="primary" onClick={addStop} style={{ height: 44 }}>Add stop</Button>
          </div>
          <div style={{ marginTop: 12, border: `1px solid ${T.cardBd}`, borderRadius: 12, overflow: "hidden" }}>
            {stops.length === 0 ? (
              <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: T.muted }}>No stops yet. Add them in pickup order.</div>
            ) : stops.map((s, i) => (
              <div key={`${s.name}-${i}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderTop: i ? `1px solid ${T.rowBd}` : undefined }}>
                <span style={{ width: 24, height: 24, borderRadius: 999, background: T.pu, color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: T.ink }}>{s.name}</span>
                <span className="tp-mono" style={{ fontSize: 12, color: T.muted }}>{s.lat.toFixed(4)}, {s.lng.toFixed(4)}</span>
                <button type="button" className="tp-btn-row" aria-label={`Remove ${s.name}`} onClick={() => setStops((list) => list.filter((_, j) => j !== i))}>
                  <X size={14} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
          {errors.stops && <div style={{ fontSize: 11, color: T.red, marginTop: 8 }}>{errors.stops}</div>}
        </div>
      )}

      {step === 3 && (
        <div className="tp-form-grid">
          <Field label="Vehicle" hint="Vehicles without a route listed first">
            <Select value={bus} onChange={(e) => setBus(e.target.value)}>
              <option value="">No vehicle yet</option>
              {vehicleOptions.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
          <Field label="Driver" hint="Only drivers with a valid licence">
            <Select value={driver} onChange={(e) => setDriver(e.target.value)}>
              <option value="">No driver yet</option>
              {driverOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
          <Field label="Attendant" hint="First-aid certified attendants">
            <Select value={attendant} onChange={(e) => setAttendant(e.target.value)}>
              <option value="">No attendant yet</option>
              {attendantOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        </div>
      )}

      {step === 4 && (
        <div>
          <div style={{ display: "flex", gap: 12, background: T.hlBg, border: `1px solid ${T.hlBd}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            {[{ l: "Route", v: code.trim().toUpperCase() }, { l: "Stops", v: String(stops.length) }, { l: "First pickup", v: fmtTime(first) }].map((x) => (
              <div key={x.l} style={{ flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>{x.l}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: T.pu, marginTop: 4 }}>{x.v}</div>
              </div>
            ))}
          </div>
          <InfoRow label="Route name">{name.trim()}</InfoRow>
          <InfoRow label="Shift">{shift}</InfoRow>
          <InfoRow label="First pickup">{fmtTime(first)}</InfoRow>
          <InfoRow label="Stops">{stops.map((s) => s.name).join(" → ")}</InfoRow>
          <InfoRow label="Vehicle"><span className="tp-mono">{bus || "—"}</span></InfoRow>
          <InfoRow label="Driver">{driver || "—"}</InfoRow>
          <InfoRow label="Attendant">{attendant || "—"}</InfoRow>
        </div>
      )}
    </Modal>
  );
}

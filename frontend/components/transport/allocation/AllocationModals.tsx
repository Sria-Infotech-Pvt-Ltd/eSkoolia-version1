"use client";
/** Edit allocation modal and the 3-step Bulk Allocate wizard (Master Prompt §7.7). */
import { useMemo, useState } from "react";
import { capacityOf } from "@/lib/transport/mock";
import { initials, inr, plural } from "@/lib/transport/format";
import type { AllocationStatus, Student, TransportRoute, Vehicle } from "@/lib/transport/types";
import {
  Button, Field, InfoRow, LAYER, Modal, Select, StatusBadge, StepPills, T, useTpToast,
} from "@/components/transport/ui";

export function EditAllocationModal({
  student, routes, onClose, onSubmit,
}: {
  student: Student; routes: TransportRoute[]; onClose: () => void;
  onSubmit: (routeCode: string, stopId: string, status: AllocationStatus) => void;
}) {
  const { toast } = useTpToast();
  const startRoute = routes.find((r) => r.code === student.routeCode) ?? routes[0];
  const [routeCode, setRouteCode] = useState(startRoute?.code ?? "");
  const [stopId, setStopId] = useState(student.stopId && startRoute?.stops.some((s) => s.id === student.stopId) ? student.stopId : startRoute?.stops[0]?.id ?? "");
  // Editing a Pending / Waitlisted student is how they get a seat, so the form defaults to Allocated.
  const [status, setStatus] = useState<AllocationStatus>("Allocated");
  const route = routes.find((r) => r.code === routeCode);
  const [errors, setErrors] = useState<{ route?: string; stop?: string }>({});

  const submit = () => {
    const e: typeof errors = {};
    if (!routeCode) e.route = "This field is required.";
    if (!stopId) e.stop = "This field is required.";
    setErrors(e);
    if (e.route || e.stop) { toast("Fill in the required fields", "error"); return; }
    onSubmit(routeCode, stopId, status);
  };

  return (
    <Modal open onClose={onClose} size="md" title="Edit allocation" subtitle="Route, pickup point and status"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Save allocation</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Route" required error={errors.route}>
          <Select value={routeCode} onChange={(e) => {
            const r = routes.find((x) => x.code === e.target.value);
            setRouteCode(e.target.value);
            setStopId(r?.stops[0]?.id ?? ""); // route change resets to its first stop
            setErrors({});
          }}>
            {routes.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
          </Select>
        </Field>
        <Field label="Pickup point" required error={errors.stop} hint={route ? `Fare ${inr(route.stops.find((s) => s.id === stopId)?.fare ?? 0)} per month · ${route.busReg}` : undefined}>
          <Select value={stopId} onChange={(e) => setStopId(e.target.value)}>
            {(route?.stops ?? []).map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as AllocationStatus)}>
            {(["Allocated", "Pending", "Waitlisted"] as AllocationStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

export function BulkAllocateWizard({
  candidates, preselect, routes, vehicles, onClose, onAllocate,
}: {
  candidates: Student[]; preselect: string[]; routes: TransportRoute[]; vehicles: Vehicle[];
  onClose: () => void; onAllocate: (ids: string[], routeCode: string, stopId: string) => void;
}) {
  const { toast } = useTpToast();
  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(preselect));
  const [routeCode, setRouteCode] = useState(routes[0]?.code ?? "");
  const route = routes.find((r) => r.code === routeCode);
  const [stopId, setStopId] = useState(route?.stops[0]?.id ?? "");
  const stop = route?.stops.find((s) => s.id === stopId);
  const [error, setError] = useState<string | undefined>();

  const seatsFree = useMemo(() => {
    const bus = vehicles.find((v) => v.reg === route?.busReg);
    return bus ? Math.max(0, capacityOf(bus) - bus.occupied) : 0;
  }, [vehicles, route]);

  const pickedList = candidates.filter((s) => picked.has(s.id));
  const toggle = (id: string) => { setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); setError(undefined); };

  const goTo = (n: number) => {
    if (n > 1 && picked.size === 0) { setError("Select at least one student."); toast("Select at least one student.", "error"); setStep(1); return; }
    if (n > 2 && (!routeCode || !stopId)) { toast("Fill in the required fields", "error"); setStep(2); return; }
    setStep(n);
  };

  const names = pickedList.map((s) => s.name);
  const nameSummary = names.length > 4 ? `${names.slice(0, 4).join(", ")} +${names.length - 4} more` : names.join(", ");

  return (
    <Modal open onClose={onClose} size="lg" priority={LAYER.wizard} title="Bulk allocate students"
      subtitle="Assign pending and waitlisted students to a route and pickup point"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <span style={{ flex: 1 }} />
        {step > 1 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < 3
          ? <Button type="button" variant="primary" onClick={() => goTo(step + 1)}>Next</Button>
          : <Button type="button" variant="primary" onClick={() => onAllocate([...picked], routeCode, stopId)}>Allocate {plural(picked.size, "student")}</Button>}
      </>}>
      <div style={{ marginBottom: 18 }}>
        <StepPills step={step} setStep={(n) => { if (n < step) setStep(n); else goTo(n); }} steps={["Students", "Route & stop", "Review"]} />
      </div>

      {step === 1 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, color: T.muted }}>{picked.size} of {candidates.length} selected</span>
            <button type="button" className="tp-btn-outline"
              onClick={() => { setPicked(picked.size === candidates.length ? new Set() : new Set(candidates.map((s) => s.id))); setError(undefined); }}>
              {picked.size === candidates.length && candidates.length > 0 ? "Clear all" : "Select all"}
            </button>
          </div>
          <div style={{ border: `1px solid ${T.cardBd}`, borderRadius: 12, maxHeight: 340, overflowY: "auto" }}>
            {candidates.length === 0 && <div style={{ padding: "24px 12px", textAlign: "center", fontSize: 13, color: T.muted }}>No pending or waitlisted students.</div>}
            {candidates.map((s, i) => {
              const on = picked.has(s.id);
              return (
                <label key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", cursor: "pointer", background: on ? T.rowSel : "#fff", borderTop: i ? `1px solid ${T.rowBd}` : undefined }}>
                  <input type="checkbox" className="tp-check" checked={on} onChange={() => toggle(s.id)} />
                  <span style={{ width: 28, height: 28, borderRadius: 999, background: T.pu, color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{initials(s.name)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: T.ink }}>{s.name}</span>
                    <span style={{ display: "block", fontSize: 11.5, color: T.muted }}>Class {s.cls}-{s.section} · {s.admission}</span>
                  </span>
                  <StatusBadge status={s.status} />
                </label>
              );
            })}
          </div>
          {error && <div style={{ fontSize: 11, color: T.red, marginTop: 8 }}>{error}</div>}
        </div>
      )}

      {step === 2 && (
        <div className="tp-form-grid">
          <Field label="Route" required hint={route ? `${route.busReg} · ${seatsFree} seats free per shift` : undefined}>
            <Select value={routeCode} onChange={(e) => { const r = routes.find((x) => x.code === e.target.value); setRouteCode(e.target.value); setStopId(r?.stops[0]?.id ?? ""); }}>
              {routes.map((r) => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
            </Select>
          </Field>
          <Field label="Pickup point" required hint={stop ? `Fare ${inr(stop.fare)} per month` : undefined}>
            <Select value={stopId} onChange={(e) => setStopId(e.target.value)}>
              {(route?.stops ?? []).map((s) => <option key={s.id} value={s.id}>{s.seq}. {s.name}</option>)}
            </Select>
          </Field>
        </div>
      )}

      {step === 3 && (
        <div>
          <div style={{ display: "flex", gap: 12, background: T.hlBg, border: `1px solid ${T.hlBd}`, borderRadius: 12, padding: 12, marginBottom: 14 }}>
            {[{ l: "Students", v: String(picked.size) }, { l: "Monthly fees", v: inr((stop?.fare ?? 0) * picked.size) }].map((x) => (
              <div key={x.l} style={{ flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>{x.l}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: T.pu, marginTop: 4 }}>{x.v}</div>
              </div>
            ))}
          </div>
          <InfoRow label="Route">{route ? `${route.code} · ${route.name}` : "—"}</InfoRow>
          <InfoRow label="Pickup point">{stop?.name ?? "—"}</InfoRow>
          <InfoRow label="Bus"><span className="tp-mono">{route?.busReg ?? "—"}</span></InfoRow>
          <InfoRow label="Students">{nameSummary || "—"}</InfoRow>
        </div>
      )}
    </Modal>
  );
}

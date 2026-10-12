"use client";
/** Add / Edit vehicle, Upload compliance document and Assign route modals (Master Prompt §7.2). */
import { useState } from "react";
import { docField } from "@/lib/transport/store";
import { daysLeft, fmtDate } from "@/lib/transport/format";
import { VEHICLE_STATUSES, VEHICLE_TYPES, routeLabel } from "@/lib/transport/mock";
import type { Driver, TransportRoute, Vehicle, VehicleDoc, VehicleStatus, VehicleType } from "@/lib/transport/types";
import { Button, Field, Input, LAYER, Modal, Select, T, useTpToast } from "@/components/transport/ui";
import { DOCS, defaultDoc, useVehicleDocWindow } from "./shared";

export interface VehicleFormValues {
  reg: string; model: string; type: VehicleType; status: VehicleStatus;
  routeCode: string; driverId: string; fitness: string; insurance: string;
}

export function VehicleFormModal({
  mode, initial, routes, drivers, onClose, onSubmit,
}: {
  mode: "add" | "edit"; initial: VehicleFormValues; routes: TransportRoute[]; drivers: Driver[];
  onClose: () => void; onSubmit: (values: VehicleFormValues) => void;
}) {
  const { toast } = useTpToast();
  const [v, setV] = useState<VehicleFormValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof VehicleFormValues, string>>>({});

  const set = <K extends keyof VehicleFormValues>(key: K, value: VehicleFormValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const submit = () => {
    const next: typeof errors = {};
    if (!v.reg.trim()) next.reg = "This field is required.";
    if (!v.model.trim()) next.model = "This field is required.";
    setErrors(next);
    if (Object.keys(next).length) { toast("Fill in the required fields", "error"); return; }
    onSubmit({ ...v, reg: v.reg.trim().toUpperCase(), model: v.model.trim() });
  };

  return (
    <Modal open onClose={onClose} size="lg" title={mode === "add" ? "Add vehicle" : "Edit vehicle"}
      subtitle="Registration, assignment and compliance dates"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>{mode === "add" ? "Add vehicle" : "Save changes"}</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Registration no." required error={errors.reg} hint="Format: state · RTO · series · number">
          <Input value={v.reg} onChange={(e) => set("reg", e.target.value)} placeholder="TS 00 AB 0000" className="tp-mono" />
        </Field>
        <Field label="Make & model" required error={errors.model}>
          <Input value={v.model} onChange={(e) => set("model", e.target.value)} placeholder="e.g. Tata Starbus Ultra" />
        </Field>
        <Field label="Vehicle type">
          <Select value={v.type} onChange={(e) => set("type", e.target.value as VehicleType)}>
            {VEHICLE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={v.status} onChange={(e) => set("status", e.target.value as VehicleStatus)}>
            {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <Field label="Assigned route">
          <Select value={v.routeCode} onChange={(e) => set("routeCode", e.target.value)}>
            <option value="">Unassigned</option>
            {routes.map((r) => <option key={r.code} value={r.code}>{routeLabel(routes, r.code)}</option>)}
          </Select>
        </Field>
        <Field label="Driver">
          <Select value={v.driverId} onChange={(e) => set("driverId", e.target.value)}>
            <option value="">Unassigned</option>
            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
        </Field>
        <Field label="Fitness certificate expiry">
          <Input type="date" value={v.fitness} onChange={(e) => set("fitness", e.target.value)} />
        </Field>
        <Field label="Insurance expiry">
          <Input type="date" value={v.insurance} onChange={(e) => set("insurance", e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

export function UploadDocModal({
  vehicle, onClose, onSubmit,
}: { vehicle: Vehicle; onClose: () => void; onSubmit: (doc: VehicleDoc, validTill: string) => void }) {
  const { toast } = useTpToast();
  const docWindow = useVehicleDocWindow();
  const [doc, setDoc] = useState<VehicleDoc>(() => defaultDoc(vehicle, docWindow));
  const [validTill, setValidTill] = useState("2027-10-06");
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();

  const valid = !!validTill && daysLeft(validTill) > 0;
  const submit = () => {
    if (!valid) {
      setError("Choose a date after today.");
      toast("Choose a valid-till date after today", "error");
      return;
    }
    onSubmit(doc, validTill);
  };

  const current = vehicle[docField(doc)];
  return (
    <Modal open onClose={onClose} size="md" priority={LAYER.docModal} title="Upload compliance document"
      subtitle="Renewing updates the expiry badges and clears related alerts"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Upload document</Button>
      </>}>
      <div className="tp-form-grid">
        <Field label="Document" required hint={`${vehicle.reg} · ${vehicle.model}`}>
          <Select value={doc} onChange={(e) => setDoc(e.target.value as VehicleDoc)}>
            {DOCS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Valid till" required error={error}>
          <Input type="date" value={validTill} onChange={(e) => { setValidTill(e.target.value); setError(undefined); }} />
        </Field>
        <div style={{ gridColumn: "1 / -1" }}>
          <Field label="Scanned copy" hint={file ? `Attached: ${file}` : "PDF, JPG or PNG · up to 5 MB"}>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="tp-file-input" aria-label="Scanned copy"
              onChange={(e) => setFile(e.target.files?.[0]?.name ?? null)} />
          </Field>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, background: T.hlBg, border: `1px solid ${T.hlBd}`, borderRadius: 12, padding: 12, marginTop: 16 }}>
        {[{ label: "Currently valid till", value: fmtDate(current) }, { label: "After upload", value: valid ? fmtDate(validTill) : "—" }].map((it) => (
          <div key={it.label} style={{ flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: T.muted }}>{it.label}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: T.pu, marginTop: 4 }}>{it.value}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

export function AssignRouteModal({
  count, routes, onClose, onSubmit,
}: { count: number; routes: TransportRoute[]; onClose: () => void; onSubmit: (routeCode: string) => void }) {
  const { toast } = useTpToast();
  const [route, setRoute] = useState("");
  const [error, setError] = useState<string | undefined>();
  const submit = () => {
    if (!route) { setError("This field is required."); toast("Fill in the required fields", "error"); return; }
    onSubmit(route);
  };
  return (
    <Modal open onClose={onClose} size="sm" title="Assign route" subtitle="Move the selected vehicles onto one route"
      footer={<>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button type="button" variant="primary" onClick={submit}>Assign route</Button>
      </>}>
      <Field label="Route" required error={error} hint={`Applies to ${count} selected vehicles. Drivers are notified in the app.`}>
        <Select value={route} onChange={(e) => { setRoute(e.target.value); setError(undefined); }}>
          <option value="">Choose a route</option>
          {routes.map((r) => <option key={r.code} value={r.code}>{routeLabel(routes, r.code)}</option>)}
        </Select>
      </Field>
    </Modal>
  );
}

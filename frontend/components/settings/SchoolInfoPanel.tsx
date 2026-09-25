"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  User, MapPin, BadgeCheck, ClipboardCheck, ChevronLeft, ChevronRight,
  CheckCircle2, Loader2, Building2, Landmark, Palette, UploadCloud, LocateFixed,
} from "lucide-react";
import { apiRequestWithRefresh, apiRequestWithRefreshResponse } from "@/lib/api-auth";
import { useUnsavedChangesGuard } from "@/contexts/UnsavedChangesContext";
import {
  BOARD_OPTIONS, INDIAN_STATE_OPTIONS, MEDIUM_OF_INSTRUCTION_OPTIONS, REGION_OPTIONS,
  STATE_CODE_TO_REGION, matchStateNameToCode,
} from "@/lib/school-choices";

const SchoolLocationMap = dynamic(() => import("./SchoolLocationMap"), {
  ssr: false,
  loading: () => <div style={{ minHeight: 320, borderRadius: 12, background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, color: "var(--ink-3)" }}>Loading map…</div>,
});

const LOGO_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_ALLOWED_TYPES = ["image/jpeg", "image/png"];
// Nullable numeric/decimal fields must PATCH as JSON null when empty, not "" —
// DRF's IntegerField/DecimalField reject an empty string with "A valid number is required."
const NULLABLE_NUMERIC_FIELDS = new Set(["year_established", "latitude", "longitude", "geofence_radius_meters"]);

interface SchoolInfo {
  school_id: number;
  school_name: string;
  school_code: string;
  board: string;
  school_type: string;
  medium_of_instruction: string;
  year_established: number | null;
  motto: string;
  principal_name: string | null;
  principal_email: string | null;
  principal_phone: string | null;
  school_phone: string;
  school_email: string;
  website: string;
  campus_address: string | null;
  city: string | null;
  state: string;
  region: string;
  pin_code: string | null;
  country: string;
  latitude: string | null;
  longitude: string | null;
  geofence_radius_meters: number | null;
  affiliation_number: string | null;
  udise_code: string;
  gstin: string;
  pan: string;
  logo_url: string;
  brand_color: string;
}

const EDITABLE_FIELDS: Array<{ key: keyof SchoolInfo; label: string }> = [
  { key: "board", label: "Board" },
  { key: "school_type", label: "School Type" },
  { key: "medium_of_instruction", label: "Medium of Instruction" },
  { key: "year_established", label: "Year Established" },
  { key: "motto", label: "Motto / Tagline" },
  { key: "principal_name", label: "Principal Name" },
  { key: "principal_email", label: "Principal Email" },
  { key: "principal_phone", label: "Principal Phone" },
  { key: "school_phone", label: "Front-office Phone" },
  { key: "school_email", label: "Front-office Email" },
  { key: "website", label: "Website" },
  { key: "campus_address", label: "Campus Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "region", label: "Region" },
  { key: "pin_code", label: "PIN Code" },
  { key: "country", label: "Country" },
  { key: "latitude", label: "Latitude" },
  { key: "longitude", label: "Longitude" },
  { key: "geofence_radius_meters", label: "Geofence Radius (m)" },
  { key: "affiliation_number", label: "Board Affiliation Number" },
  { key: "udise_code", label: "UDISE Code" },
  { key: "gstin", label: "GSTIN" },
  { key: "pan", label: "PAN" },
  { key: "logo_url", label: "Logo URL" },
  { key: "brand_color", label: "Brand Color" },
];

const WIZARD_STEPS: Array<{ label: string; icon: typeof User }> = [
  { label: "Identity", icon: BadgeCheck },
  { label: "Principal Contact", icon: User },
  { label: "Address", icon: MapPin },
  { label: "Compliance", icon: Landmark },
  { label: "Branding", icon: Palette },
  { label: "Review", icon: ClipboardCheck },
];

// Groups the flat EDITABLE_FIELDS list back into the same sections as steps 0–3,
// so Review reads as a set of labeled cards instead of one undifferentiated grid.
const REVIEW_GROUPS: Array<{ step: number; keys: Array<keyof SchoolInfo> }> = [
  { step: 0, keys: ["board", "school_type", "medium_of_instruction", "year_established", "motto"] },
  { step: 1, keys: ["principal_name", "principal_email", "principal_phone", "school_phone", "school_email", "website"] },
  { step: 2, keys: ["campus_address", "city", "state", "region", "pin_code", "country", "latitude", "longitude", "geofence_radius_meters"] },
  { step: 3, keys: ["affiliation_number", "udise_code", "gstin", "pan"] },
];

const inputStyle = { border: "1px solid var(--bd-2)", borderRadius: 10, padding: "9px 11px", fontSize: 14, background: "var(--bg-1)", color: "var(--ink-1)", width: "100%" } as const;
const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 6, fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" };

// Previously every text field here used a raw onChange with no masking at all —
// no digits-only cap on phone/PIN, no uppercase-alnum restriction on GSTIN/PAN/
// UDISE, not even type="email"/"tel". `format` applies the same kind of
// field-appropriate sanitizer already established elsewhere in the codebase
// (e.g. StudentAddPanel.tsx's phone/pincode masking) so these fields can't be
// saved as garbage in the first place.
type FieldFormat = "phone" | "email" | "pin" | "code";

function sanitizeByFormat(raw: string, format?: FieldFormat): string {
  switch (format) {
    case "phone":
      return raw.replace(/\D/g, "").slice(0, 10);
    case "pin":
      return raw.replace(/\D/g, "").slice(0, 6);
    case "code":
      return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 20);
    case "email":
      return raw.trim();
    default:
      return raw;
  }
}

function Field({ form, setForm, fieldKey, label, multiline, type, format }: {
  form: Partial<SchoolInfo>;
  setForm: React.Dispatch<React.SetStateAction<Partial<SchoolInfo>>>;
  fieldKey: keyof SchoolInfo;
  label: string;
  multiline?: boolean;
  type?: string;
  format?: FieldFormat;
}) {
  return (
    <label style={labelStyle}>
      {label}
      {multiline ? (
        <textarea
          value={(form[fieldKey] as string) ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, [fieldKey]: e.target.value }))}
          rows={3}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      ) : (
        <input
          type={type ?? (format === "email" ? "email" : format === "phone" ? "tel" : "text")}
          value={(form[fieldKey] as string | number) ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, [fieldKey]: type === "number" ? (e.target.value ? Number(e.target.value) : null) : sanitizeByFormat(e.target.value, format) } as Partial<SchoolInfo>))}
          style={inputStyle}
        />
      )}
    </label>
  );
}

function SelectField({ form, setForm, fieldKey, label, options }: {
  form: Partial<SchoolInfo>;
  setForm: React.Dispatch<React.SetStateAction<Partial<SchoolInfo>>>;
  fieldKey: keyof SchoolInfo;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label style={labelStyle}>
      {label}
      <select
        value={(form[fieldKey] as string) ?? ""}
        onChange={(e) => setForm((f) => ({ ...f, [fieldKey]: e.target.value }))}
        style={inputStyle}
      >
        <option value="">— Select —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function ReviewSection({ title, icon: Icon, onEdit, children }: {
  title: string;
  icon: typeof User;
  onEdit: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ border: "1px solid var(--bd-2)", borderRadius: 14, background: "var(--bg-1)", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 16px", background: "var(--bg-2)", borderBottom: "1px solid var(--bd)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: "var(--pu-tint)", color: "var(--pu)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={12.5} strokeWidth={2.25} />
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-1)" }}>{title}</span>
        </div>
        <button type="button" onClick={onEdit}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, background: "transparent", border: "none", color: "var(--pu)", fontSize: 12, fontWeight: 700, cursor: "pointer", padding: "3px 4px" }}>
          Edit <ChevronRight size={11} />
        </button>
      </div>
      <div style={{ padding: "2px 16px" }}>{children}</div>
    </div>
  );
}

function ReviewRow({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, padding: "10px 0", borderBottom: last ? "none" : "1px solid var(--bd)" }}>
      <span style={{ fontSize: 12.5, color: "var(--ink-3)", flexShrink: 0 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)", textAlign: "right" }}>{value}</span>
    </div>
  );
}

export function SchoolInfoPanel() {
  const [info, setInfo] = useState<SchoolInfo | null>(null);
  const [form, setForm] = useState<Partial<SchoolInfo>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [geocoding, setGeocoding] = useState(false);
  const geocodeRequestId = useRef(0);
  const [pendingLocationUpdate, setPendingLocationUpdate] = useState<{
    values: Partial<SchoolInfo>;
    diff: Array<{ label: string; from: string; to: string }>;
  } | null>(null);
  const [locationUpdateReason, setLocationUpdateReason] = useState("");
  const [savedLocationUpdateReason, setSavedLocationUpdateReason] = useState<string | null>(null);

  const stateLabel = (code: string | undefined | null) =>
    (code && INDIAN_STATE_OPTIONS.find((s) => s.code === code)?.name) || "—";
  const regionLabel = (r: string | undefined | null) => (r ? r.charAt(0).toUpperCase() + r.slice(1) : "—");

  const applyReverseGeocode = async (lat: number, lng: number) => {
    const requestId = ++geocodeRequestId.current;
    setGeocoding(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&accept-language=en`,
        { headers: { Accept: "application/json" } }
      );
      if (!res.ok) return;
      const data = await res.json();
      if (requestId !== geocodeRequestId.current) return; // a newer pin drop superseded this lookup
      const addr = data.address ?? {};
      const city: string | undefined = addr.city || addr.town || addr.village || addr.municipality || addr.county;
      const pinCode: string | undefined = addr.postcode;
      const stateCode = matchStateNameToCode(addr.state);
      const regionCode = (stateCode && STATE_CODE_TO_REGION[stateCode]) || undefined;
      const road = [addr.road, addr.suburb || addr.neighbourhood].filter(Boolean).join(", ");
      const country = addr.country as string | undefined;

      setForm((current) => {
        const proposed: Partial<SchoolInfo> = {};
        const diff: Array<{ label: string; from: string; to: string }> = [];

        if (city && city !== current.city) {
          proposed.city = city;
          diff.push({ label: "City", from: current.city || "—", to: city });
        }
        if (pinCode && pinCode !== current.pin_code) {
          proposed.pin_code = pinCode;
          diff.push({ label: "PIN Code", from: current.pin_code || "—", to: pinCode });
        }
        if (stateCode && stateCode !== current.state) {
          proposed.state = stateCode;
          diff.push({ label: "State", from: stateLabel(current.state), to: stateLabel(stateCode) });
        }
        if (regionCode && regionCode !== current.region) {
          proposed.region = regionCode;
          diff.push({ label: "Region", from: regionLabel(current.region), to: regionLabel(regionCode) });
        }
        if (country && country !== current.country) {
          proposed.country = country;
          diff.push({ label: "Country", from: current.country || "—", to: country });
        }
        // Only ever suggest campus_address when it's still blank — a nudge of
        // the pin shouldn't be able to overwrite an address someone typed in.
        if (!current.campus_address?.trim() && road) {
          proposed.campus_address = road;
          diff.push({ label: "Campus Address", from: "—", to: road });
        }

        if (diff.length > 0) {
          setLocationUpdateReason("");
          setPendingLocationUpdate({ values: proposed, diff });
        }
        return current; // lat/lng already applied by setLocation; address fields wait for confirmation
      });
    } catch {
      // Best-effort — the lat/lng itself is already saved; leave the address fields untouched on failure.
    } finally {
      if (requestId === geocodeRequestId.current) setGeocoding(false);
    }
  };

  const confirmLocationUpdate = () => {
    if (!pendingLocationUpdate || !locationUpdateReason.trim()) return;
    const reason = locationUpdateReason.trim();
    const overrides = pendingLocationUpdate.values;
    setForm((f) => ({ ...f, ...overrides }));
    setPendingLocationUpdate(null);
    setLocationUpdateReason("");
    // Saves immediately rather than just staging the change locally — waiting for a
    // separate "Save & Exit" click here meant a refresh right after confirming lost
    // the update entirely, which read as "the address isn't actually saving."
    void handleSave({ silent: true, overrides, reason, successMessage: "Address updated and saved." }).catch(() => {});
  };

  const discardLocationUpdate = () => {
    setPendingLocationUpdate(null);
    setLocationUpdateReason("");
  };

  const setLocation = (lat: number, lng: number) => {
    const latitude = lat.toFixed(6);
    const longitude = lng.toFixed(6);
    setForm((f) => ({ ...f, latitude, longitude }));
    // Save the pin position right away, independent of the address-diff confirmation
    // below — a small nudge that doesn't imply a different City/State would otherwise
    // never get persisted until the wizard's own Save button is clicked.
    void handleSave({ silent: true, overrides: { latitude, longitude }, successMessage: "Location saved." }).catch(() => {});
    void applyReverseGeocode(lat, lng);
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Geolocation is not supported by this browser.");
      return;
    }
    setLocationError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation(pos.coords.latitude, pos.coords.longitude);
        setLocating(false);
      },
      (err) => {
        setLocationError(err.message || "Could not get your current location.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const loadLogoPreview = async (url: string | null | undefined) => {
    if (!url) { setLogoPreview(null); return; }
    if (/^https?:\/\//i.test(url)) { setLogoPreview(url); return; }
    try {
      const res = await apiRequestWithRefreshResponse(url, { silent401: true });
      if (!res.ok) { setLogoPreview(null); return; }
      const blob = await res.blob();
      const reader = new FileReader();
      reader.onload = () => setLogoPreview(reader.result as string);
      reader.readAsDataURL(blob);
    } catch {
      setLogoPreview(null);
    }
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequestWithRefresh<SchoolInfo>("/api/v1/settings/school-info/");
      setInfo(data);
      setForm(data);
      void loadLogoPreview(data.logo_url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load school info.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const handleSave = async (opts?: { silent?: boolean; overrides?: Partial<SchoolInfo>; reason?: string; successMessage?: string }) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const source = { ...form, ...opts?.overrides };
      const payload: Record<string, unknown> = Object.fromEntries(EDITABLE_FIELDS.map(({ key }) => {
        const value = source[key];
        if (NULLABLE_NUMERIC_FIELDS.has(key)) {
          return [key, value === undefined || value === null || value === "" ? null : value];
        }
        return [key, value ?? ""];
      }));
      // Not a model field — the backend reads this off the raw request to note
      // *why* a map-driven address change was made in the settings audit log.
      const reason = opts?.reason ?? savedLocationUpdateReason;
      if (reason) {
        payload.location_update_reason = reason;
      }
      const updated = await apiRequestWithRefresh<SchoolInfo>("/api/v1/settings/school-info/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      setInfo(updated);
      setForm(updated);
      setSavedLocationUpdateReason(null);
      setSuccess(opts?.successMessage ?? (opts?.silent ? "Saved." : "School info updated."));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save school info.");
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const isDirty = !!info && JSON.stringify(form) !== JSON.stringify(info);
  useUnsavedChangesGuard(isDirty, () => handleSave());

  const handleLogoFile = async (file: File | null) => {
    if (!file) return;
    setLogoError(null);
    if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
      setLogoError("Only JPG or PNG images are allowed.");
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(`File exceeds the ${LOGO_MAX_BYTES / (1024 * 1024)}MB limit.`);
      return;
    }
    setLogoUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const updated = await apiRequestWithRefresh<SchoolInfo>("/api/v1/settings/school-info/logo/", {
        method: "POST",
        body,
      });
      setInfo(updated);
      setForm(updated);
      void loadLogoPreview(updated.logo_url);
      setSuccess("Logo uploaded.");
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Failed to upload logo.");
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  };

  return (
    <div style={{ background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 18, boxShadow: "var(--sh-1)", padding: "28px 30px" }}>
      <h1 style={{ fontSize: 34, fontWeight: 600, color: "var(--ink-1)", margin: "0 0 5px", lineHeight: 1.05, letterSpacing: "-0.03em", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        School{" "}
        <em style={{ fontFamily: "var(--font-instrument-serif,'Instrument Serif',Georgia,serif)", fontWeight: 400, fontStyle: "italic", color: "var(--pu)", fontSize: 38, letterSpacing: "-0.02em" }}>
          Info
        </em>
      </h1>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)", marginTop: 10, lineHeight: 1.55 }}>
        Auto-filled from School Tenancy — edit identity, contact, address, compliance and branding details used
        across the ERP. Jump straight to any section, or save and move on without stepping through the rest.
      </p>

      {loading && <div style={{ marginTop: 24, color: "var(--ink-2)", fontSize: 14 }}>Loading…</div>}
      {error && <div style={{ marginTop: 16, color: "var(--err)", fontSize: 13 }}>{error}</div>}
      {success && <div style={{ marginTop: 16, color: "var(--ok)", fontSize: 13 }}>{success}</div>}

      {!loading && info && (
        <>
          <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "var(--ink-2)" }}>
            <Building2 size={16} strokeWidth={2} />
            <span><strong style={{ color: "var(--ink-1)" }}>{info.school_name}</strong></span>
            <span>Code: {info.school_code}</span>
          </div>

          <div style={{ marginTop: 24, border: "1px solid var(--bd)", borderRadius: 14, padding: "22px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 22 }}>
              {WIZARD_STEPS.map((s, i) => {
                const StepIcon = s.icon;
                const isDone = i < step;
                const isActive = i === step;
                const jumpable = i !== step;
                return (
                  <div key={s.label} style={{ display: "flex", alignItems: "center", flex: i < WIZARD_STEPS.length - 1 ? 1 : "0 0 auto" }}>
                    <div
                      onClick={() => jumpable && setStep(i)}
                      title={`Jump to ${s.label}`}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 34, cursor: jumpable ? "pointer" : "default" }}
                    >
                      <div
                        style={{
                          width: 32, height: 32, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                          background: isActive ? "var(--pu)" : isDone ? "var(--pu-tint)" : "var(--bg-2)",
                          color: isActive ? "#fff" : isDone ? "var(--pu)" : "var(--ink-3)",
                          border: isActive ? "none" : `1px solid ${isDone ? "var(--pu-soft)" : "var(--bd-2)"}`,
                          transition: "all 0.15s ease", flexShrink: 0,
                        }}
                      >
                        {isDone ? <CheckCircle2 size={16} strokeWidth={2.5} /> : <StepIcon size={15} strokeWidth={2.25} />}
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: isActive ? "var(--pu)" : "var(--ink-3)", textAlign: "center", whiteSpace: "nowrap" }}>
                        {s.label}
                      </span>
                    </div>
                    {i < WIZARD_STEPS.length - 1 && (
                      <div style={{ flex: 1, height: 2, background: isDone ? "var(--pu-soft)" : "var(--bd)", margin: "0 4px 18px" }} />
                    )}
                  </div>
                );
              })}
            </div>

            {step === 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
                <SelectField form={form} setForm={setForm} fieldKey="board" label="Board" options={BOARD_OPTIONS} />
                <Field form={form} setForm={setForm} fieldKey="school_type" label="School Type" />
                <SelectField
                  form={form} setForm={setForm} fieldKey="medium_of_instruction" label="Medium of Instruction"
                  options={MEDIUM_OF_INSTRUCTION_OPTIONS.map((m) => ({ value: m, label: m }))}
                />
                <Field form={form} setForm={setForm} fieldKey="year_established" label="Year Established" type="number" />
                <Field form={form} setForm={setForm} fieldKey="motto" label="Motto / Tagline" />
              </div>
            )}

            {step === 1 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
                <Field form={form} setForm={setForm} fieldKey="principal_name" label="Principal Name" />
                <Field form={form} setForm={setForm} fieldKey="principal_email" label="Principal Email" format="email" />
                <Field form={form} setForm={setForm} fieldKey="principal_phone" label="Principal Phone" format="phone" />
                <Field form={form} setForm={setForm} fieldKey="school_phone" label="Front-office Phone" format="phone" />
                <Field form={form} setForm={setForm} fieldKey="school_email" label="Front-office Email" format="email" />
                <Field form={form} setForm={setForm} fieldKey="website" label="Website" />
              </div>
            )}

            {step === 2 && (
              <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
                <Field form={form} setForm={setForm} fieldKey="campus_address" label="Campus Address" multiline />
                <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18, alignContent: "start" }}>
                  <Field form={form} setForm={setForm} fieldKey="city" label="City" />
                  <Field form={form} setForm={setForm} fieldKey="pin_code" label="PIN Code" format="pin" />
                </div>
                <SelectField
                  form={form} setForm={setForm} fieldKey="state" label="State"
                  options={INDIAN_STATE_OPTIONS.map((s) => ({ value: s.code, label: `${s.name} (${s.code})` }))}
                />
                <SelectField
                  form={form} setForm={setForm} fieldKey="region" label="Region"
                  options={REGION_OPTIONS.map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) }))}
                />
                <Field form={form} setForm={setForm} fieldKey="country" label="Country" />
              </div>

              <div style={{ marginTop: 22, borderTop: "1px solid var(--bd)", paddingTop: 20 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                  <label style={{ ...labelStyle, flexDirection: "row" as const, alignItems: "center" }}>
                    <MapPin size={14} /> Campus Location
                  </label>
                  <button
                    type="button"
                    onClick={useCurrentLocation}
                    disabled={locating}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6,
                      background: "var(--bg-1)", color: "var(--pu)", border: "1px solid var(--pu-soft)",
                      borderRadius: 10, padding: "7px 12px", fontSize: 12.5, fontWeight: 700,
                      cursor: locating ? "default" : "pointer", opacity: locating ? 0.7 : 1,
                    }}
                  >
                    {locating ? <Loader2 size={13} className="si-spin" /> : <LocateFixed size={13} />}
                    {locating ? "Locating…" : "Use My Current Location"}
                  </button>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "var(--ink-3)" }}>
                  Click the map to drop a pin on the campus, or drag the pin to adjust. This point will be used
                  to geofence staff clock-in/out once that feature ships. If the location implies a different
                  City, PIN Code, State, Region or Country than what&apos;s set above, you&apos;ll be asked to confirm
                  the change (and why) — confirming saves it immediately, no separate Save click needed.
                </p>
                <SchoolLocationMap
                  latitude={form.latitude ? parseFloat(form.latitude) : null}
                  longitude={form.longitude ? parseFloat(form.longitude) : null}
                  radiusMeters={form.geofence_radius_meters ?? null}
                  onChange={setLocation}
                />
                {geocoding && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-3)", display: "flex", alignItems: "center", gap: 6 }}>
                    <Loader2 size={12} className="si-spin" /> Looking up address for this location…
                  </div>
                )}
                {locationError && <div style={{ marginTop: 8, fontSize: 12, color: "var(--err)" }}>{locationError}</div>}

                {pendingLocationUpdate && (
                  <div style={{ marginTop: 12, border: "1px solid var(--pu-soft)", background: "var(--pu-tint)", borderRadius: 12, padding: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--ink-1)", marginBottom: 8 }}>
                      Update address from this location?
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 12 }}>
                      {pendingLocationUpdate.diff.map((d) => (
                        <div key={d.label} style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
                          <strong style={{ color: "var(--ink-1)" }}>{d.label}:</strong> {d.from} → {d.to}
                        </div>
                      ))}
                    </div>
                    <label style={{ ...labelStyle, marginBottom: 12 }}>
                      Reason for this update
                      <input
                        value={locationUpdateReason}
                        onChange={(e) => setLocationUpdateReason(e.target.value)}
                        style={inputStyle}
                        placeholder="e.g. Corrected pin to the actual campus gate"
                        autoFocus
                      />
                    </label>
                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        type="button"
                        onClick={confirmLocationUpdate}
                        disabled={!locationUpdateReason.trim() || saving}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6,
                          background: "var(--pu)", color: "#fff", border: "none", borderRadius: 10,
                          padding: "8px 16px", fontSize: 13, fontWeight: 700,
                          cursor: locationUpdateReason.trim() && !saving ? "pointer" : "default",
                          opacity: locationUpdateReason.trim() && !saving ? 1 : 0.5,
                        }}
                      >
                        {saving && <Loader2 size={13} className="si-spin" />}
                        {saving ? "Saving…" : "Update & Save Address"}
                      </button>
                      <button
                        type="button"
                        onClick={discardLocationUpdate}
                        disabled={saving}
                        style={{
                          background: "var(--bg-1)", color: "var(--ink-2)", border: "1px solid var(--bd-2)",
                          borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 700,
                          cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                        }}
                      >
                        Keep Current Address
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 18, marginTop: 16 }}>
                  <Field form={form} setForm={setForm} fieldKey="latitude" label="Latitude" />
                  <Field form={form} setForm={setForm} fieldKey="longitude" label="Longitude" />
                  <label style={labelStyle}>
                    Geofence Radius (metres)
                    <input
                      type="number"
                      min={0}
                      value={form.geofence_radius_meters ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, geofence_radius_meters: e.target.value ? Number(e.target.value) : null }))}
                      style={inputStyle}
                      placeholder="e.g. 200"
                    />
                  </label>
                </div>
              </div>
              </>
            )}

            {step === 3 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
                <Field form={form} setForm={setForm} fieldKey="affiliation_number" label="Board Affiliation Number" />
                <Field form={form} setForm={setForm} fieldKey="udise_code" label="UDISE Code" format="code" />
                <Field form={form} setForm={setForm} fieldKey="gstin" label="GSTIN" format="code" />
                <Field form={form} setForm={setForm} fieldKey="pan" label="PAN" format="code" />
              </div>
            )}

            {step === 4 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0,1fr))", gap: 18 }}>
                <label style={labelStyle}>
                  Logo
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 56, height: 56, borderRadius: 10, border: "1px solid var(--bd-2)",
                        background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, overflow: "hidden",
                      }}
                    >
                      {logoPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logoPreview} alt="School logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : (
                        <Building2 size={20} strokeWidth={1.75} color="var(--ink-3)" />
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg"
                        onChange={(e) => void handleLogoFile(e.target.files?.[0] ?? null)}
                        style={{ display: "none" }}
                      />
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        disabled={logoUploading}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 6, alignSelf: "flex-start",
                          background: "var(--bg-1)", color: "var(--pu)", border: "1px solid var(--pu-soft)",
                          borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 700,
                          cursor: logoUploading ? "default" : "pointer", opacity: logoUploading ? 0.7 : 1,
                        }}
                      >
                        {logoUploading ? <Loader2 size={14} className="si-spin" /> : <UploadCloud size={14} />}
                        {logoUploading ? "Uploading…" : "Upload Logo"}
                      </button>
                      <span style={{ fontSize: 11.5, color: "var(--ink-3)" }}>JPG or PNG, up to 2MB.</span>
                      {logoError && <span style={{ fontSize: 11.5, color: "var(--err)" }}>{logoError}</span>}
                    </div>
                  </div>
                </label>
                <label style={labelStyle}>
                  Brand Color
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="color"
                      value={(form.brand_color as string) || "#6d4aff"}
                      onChange={(e) => setForm((f) => ({ ...f, brand_color: e.target.value }))}
                      style={{ height: 38, width: 46, flexShrink: 0, cursor: "pointer", border: "1px solid var(--bd-2)", borderRadius: 10, background: "var(--bg-1)" }}
                    />
                    <input
                      value={(form.brand_color as string) ?? ""}
                      onChange={(e) => setForm((f) => ({ ...f, brand_color: e.target.value }))}
                      style={inputStyle}
                      placeholder="#6d4aff"
                    />
                  </div>
                </label>
              </div>
            )}

            {step === 5 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 14, alignItems: "start" }}>
                {REVIEW_GROUPS.map(({ step: groupStep, keys }) => {
                  const { label: title, icon } = WIZARD_STEPS[groupStep];
                  return (
                    <ReviewSection key={groupStep} title={title} icon={icon} onEdit={() => setStep(groupStep)}>
                      {keys.map((key, i) => {
                        const raw = form[key] as string;
                        const value = key === "state" ? stateLabel(raw) : key === "region" ? regionLabel(raw) : raw || "—";
                        return (
                          <ReviewRow
                            key={key}
                            label={EDITABLE_FIELDS.find((f) => f.key === key)?.label ?? key}
                            value={value}
                            last={i === keys.length - 1}
                          />
                        );
                      })}
                    </ReviewSection>
                  );
                })}

                <ReviewSection title="Branding" icon={Palette} onEdit={() => setStep(4)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 9, border: "1px solid var(--bd-2)", background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                      {logoPreview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logoPreview} alt="School logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                      ) : (
                        <Building2 size={17} strokeWidth={1.75} color="var(--ink-3)" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, color: "var(--ink-3)" }}>Logo</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ink-1)" }}>{logoPreview ? "Uploaded" : "Not set"}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                      <div style={{ width: 20, height: 20, borderRadius: 6, background: (form.brand_color as string) || "#6d4aff", border: "1px solid var(--bd-2)" }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-1)", fontFamily: "var(--font-mono,monospace)" }}>{(form.brand_color as string) || "—"}</span>
                    </div>
                  </div>
                </ReviewSection>
              </div>
            )}

            <div style={{ marginTop: 26, display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--bd)", paddingTop: 20 }}>
              <div>
                {step > 0 && (
                  <button onClick={() => setStep(step - 1)} style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--bg-1)", border: "1px solid var(--bd-2)", borderRadius: 10, padding: "9px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "var(--ink-2)" }}>
                    <ChevronLeft size={15} /> Back
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {step < WIZARD_STEPS.length - 1 && (
                  <button
                    onClick={() => void handleSave({ silent: true }).then(() => setStep(WIZARD_STEPS.length - 1)).catch(() => {})}
                    disabled={saving}
                    style={{ background: "var(--bg-1)", color: "var(--pu)", border: "1px solid var(--pu-soft)", borderRadius: 10, padding: "9px 18px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    {saving ? (<><Loader2 size={15} className="si-spin" /> Saving…</>) : (<><CheckCircle2 size={15} /> Save &amp; Exit</>)}
                  </button>
                )}
                {step < WIZARD_STEPS.length - 1 ? (
                  <button
                    onClick={() => setStep(step + 1)}
                    style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    Next <ChevronRight size={15} />
                  </button>
                ) : (
                  <button
                    onClick={() => void handleSave().catch(() => {})}
                    disabled={saving}
                    style={{ background: "var(--pu)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 20px", fontSize: 13, fontWeight: 700, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1, display: "inline-flex", alignItems: "center", gap: 6 }}
                  >
                    {saving ? (<><Loader2 size={15} className="si-spin" /> Saving…</>) : (<><CheckCircle2 size={15} /> Save Changes</>)}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <style jsx>{`
        .si-spin { animation: si-rotate 0.8s linear infinite; }
        @keyframes si-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

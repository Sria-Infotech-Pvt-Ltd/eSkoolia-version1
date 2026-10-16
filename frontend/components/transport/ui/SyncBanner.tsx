"use client";
/**
 * Transport data status, shown above every Transport screen: first load,
 * a save in progress, a failed load / save (with retry), and sections the
 * signed-in user's role cannot read.
 */
import { useTransport } from "@/lib/transport/store";
import { T } from "./tokens";

const SECTION_LABEL: Record<string, string> = {
  vehicles: "vehicles", routes: "routes", stops: "pickup points", staff: "drivers & attendants",
  allocation: "student allocation", alerts: "alerts", maintenance: "maintenance", fuel: "fuel",
  reports: "reports", settings: "settings", dashboard: "dashboard", attendance: "attendance",
};

function Bar({ tone, children }: { tone: "info" | "error"; children: React.ReactNode }) {
  const error = tone === "error";
  return (
    <div role={error ? "alert" : "status"} style={{
      display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "12px 16px 0", padding: "10px 14px",
      borderRadius: 12, fontSize: 13, fontWeight: 600,
      background: error ? T.redSoft : T.infoSoft, color: error ? T.danger : T.info,
      border: `1px solid ${error ? T.redBd : T.hlBd}`,
    }}>
      {children}
    </div>
  );
}

export function SyncBanner() {
  const { status, saving, error, clearError, reload, state } = useTransport();
  const hidden = state.unavailable.map((s) => SECTION_LABEL[s] ?? s);
  return (
    <>
      {status === "loading" && <Bar tone="info">Loading transport records…</Bar>}
      {saving && status !== "loading" && <Bar tone="info">Saving changes…</Bar>}
      {error && (
        <Bar tone="error">
          <span style={{ flex: 1, minWidth: 0 }}>{status === "error" ? "Couldn't load transport records: " : "Couldn't save: "}{error}</span>
          <button type="button" className="tp-btn-outline" onClick={() => { clearError(); void reload(); }}>Retry</button>
          <button type="button" className="tp-btn-outline" onClick={clearError}>Dismiss</button>
        </Bar>
      )}
      {status === "ready" && hidden.length > 0 && (
        <Bar tone="info">Your role can&apos;t view {hidden.join(", ")} - those sections are shown empty.</Bar>
      )}
    </>
  );
}

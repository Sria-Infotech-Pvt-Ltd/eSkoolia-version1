"use client";

import { useEffect, useState } from "react";
import {
  createPeriodSlot,
  deletePeriodSlot,
  LibraryApiError,
  listClassSections,
  listSchoolClasses,
  updatePeriodSlot,
} from "@/hooks/useLibraryApi";
import type { GridPeriod, GridSlot, SchoolClassOption, SlotDay } from "@/types/library";
import { Btn, ConfirmDialog, Field, inputStyle, Modal, Pill, tdStyle, thStyle } from "../catalogue/ui";
import { refusalMessage } from "../issue-desk/deskHelpers";
import { conflictText, DAY_LABEL, slotLabel } from "./periodsHelpers";

interface Props {
  slots: GridSlot[];
  periods: GridPeriod[];
  onClose: () => void;
  /** Called after any change so the page reloads the grid. */
  onChanged: (message: string) => void;
}

const DAYS = Object.keys(DAY_LABEL) as SlotDay[];

/** Add, switch off and delete library periods. A clash with another slot is shown by name. */
export function SlotManager({ slots, periods, onClose, onChanged }: Props) {
  const [classes, setClasses] = useState<SchoolClassOption[]>([]);
  const [sections, setSections] = useState<{ id: number; name: string }[]>([]);
  const [form, setForm] = useState({ school_class: "", section: "", day: "Mon" as SlotDay, period: "", room_label: "Main Library" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [removing, setRemoving] = useState<GridSlot | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSchoolClasses({ silent401: true })
      .then((rows) => !cancelled && setClasses(rows))
      .catch((err) => !cancelled && setProblem(refusalMessage(err, "Could not load the classes.")));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSections([]);
    if (!form.school_class) return;
    let cancelled = false;
    listClassSections(Number(form.school_class), { silent401: true })
      .then((rows) => !cancelled && setSections(rows))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [form.school_class]);

  const fail = (err: unknown, fallback: string) => {
    if (err instanceof LibraryApiError && err.status === 409 && err.payload?.slot) {
      setProblem(conflictText(err.payload, err.message));
      return;
    }
    if (err instanceof LibraryApiError && err.fieldErrors) {
      const first = Object.entries(err.fieldErrors)[0];
      if (first) {
        setProblem(`${first[0].replace("_", " ")}: ${first[1][0]}`);
        return;
      }
    }
    setProblem(refusalMessage(err, fallback));
  };

  const add = async () => {
    setBusy(true);
    setProblem("");
    try {
      await createPeriodSlot({
        school_class: Number(form.school_class),
        section: form.section ? Number(form.section) : null,
        day: form.day,
        period: Number(form.period),
        room_label: form.room_label.trim() || "Main Library",
      });
      onChanged("Library period added");
    } catch (err) {
      fail(err, "Could not add the library period.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (slot: GridSlot) => {
    setBusy(true);
    setProblem("");
    try {
      await updatePeriodSlot(slot.id, { is_active: !slot.is_active });
      onChanged(slot.is_active ? "Library period switched off" : "Library period switched on");
    } catch (err) {
      fail(err, "Could not change the library period.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (slot: GridSlot) => {
    setBusy(true);
    setProblem("");
    try {
      await deletePeriodSlot(slot.id);
      onChanged("Library period deleted");
    } catch (err) {
      fail(err, "Could not delete the library period.");
    } finally {
      setBusy(false);
    }
  };

  const valid = form.school_class !== "" && form.period !== "";

  return (
    <Modal title="Manage library periods" onClose={onClose} width={860} footer={<Btn onClick={onClose}>Close</Btn>}>
      {problem ? (
        <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{problem}</div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, alignItems: "end" }}>
        <Field label="Class">
          <select style={inputStyle} value={form.school_class} onChange={(e) => setForm({ ...form, school_class: e.target.value, section: "" })}>
            <option value="">Choose a class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Section">
          <select style={inputStyle} value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} disabled={!form.school_class}>
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Day">
          <select style={inputStyle} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value as SlotDay })}>
            {DAYS.map((d) => (
              <option key={d} value={d}>{DAY_LABEL[d]}</option>
            ))}
          </select>
        </Field>
        <Field label="Period">
          <select style={inputStyle} value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
            <option value="">Choose a period</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.start_time} to {p.end_time})</option>
            ))}
          </select>
        </Field>
        <Field label="Room">
          <input style={inputStyle} value={form.room_label} maxLength={50} onChange={(e) => setForm({ ...form, room_label: e.target.value })} />
        </Field>
        <div style={{ marginBottom: 12 }}>
          <Btn variant="primary" onClick={add} disabled={busy || !valid}>{busy ? "Saving..." : "Add period"}</Btn>
        </div>
      </div>
      {periods.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--ink-3)", margin: "0 0 10px" }}>No class periods are set up yet. Add them in the school timetable settings first.</p>
      ) : null}

      <div style={{ overflowX: "auto", border: "1px solid var(--bd)", borderRadius: 10, padding: "2px 8px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
          <thead>
            <tr>
              <th style={thStyle}>Class</th>
              <th style={thStyle}>Day</th>
              <th style={thStyle}>Period</th>
              <th style={thStyle}>Room</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {slots.map((slot) => (
              <tr key={slot.id}>
                <td style={tdStyle}>{slotLabel(slot)}</td>
                <td style={tdStyle}>{DAY_LABEL[slot.day]}</td>
                <td style={tdStyle}>{slot.period_name} <span style={{ color: "var(--ink-3)", fontSize: 11 }}>{slot.start_time} to {slot.end_time}</span></td>
                <td style={tdStyle}>{slot.room_label}</td>
                <td style={tdStyle}><Pill tone={slot.is_active ? "ok" : "neutral"}>{slot.is_active ? "On" : "Off"}</Pill></td>
                <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                  <Btn small variant="ghost" disabled={busy} onClick={() => toggle(slot)}>{slot.is_active ? "Switch off" : "Switch on"}</Btn>
                  <Btn small variant="ghost" disabled={busy} onClick={() => setRemoving(slot)}>Delete</Btn>
                </td>
              </tr>
            ))}
            {slots.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--ink-3)" }}>No library periods yet. Add the first one above.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {removing ? (
        <ConfirmDialog
          title="Delete library period"
          message={`Delete ${slotLabel(removing)} on ${DAY_LABEL[removing.day]} during ${removing.period_name}? A period that already has check-ins cannot be deleted: switch it off instead.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={async () => {
            const target = removing;
            setRemoving(null);
            await remove(target);
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </Modal>
  );
}

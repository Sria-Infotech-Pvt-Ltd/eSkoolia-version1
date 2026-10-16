"use client";

import { useState } from "react";
import { createBookCategory, deleteBookCategory, updateBookCategory } from "@/hooks/useLibraryApi";
import type { BookCategory } from "@/types/library";
import { CATEGORY_COLOR_KEYS, colorVar, nextColorKey } from "./colors";
import { Btn, ConfirmDialog, describeError, Dot, Field, fieldMessages, inputStyle, Modal, Pill, tdStyle, thStyle } from "./ui";

interface Props {
  categories: BookCategory[];
  can: (code: string) => boolean;
  onChanged: () => void;
  onClose: () => void;
  notify: (text: string, tone?: "ok" | "danger") => void;
}

interface FormState {
  id: number | null;
  name: string;
  code: string;
  color_key: string;
  description: string;
}

export function CategoriesModal({ categories, can, onChanged, onClose, notify }: Props) {
  const canCreate = can("library.book_categories.create");
  const canUpdate = can("library.book_categories.update");
  const canDelete = can("library.book_categories.delete");
  const blank = (): FormState => ({ id: null, name: "", code: "", color_key: nextColorKey(categories.map((c) => c.color_key)), description: "" });
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<BookCategory | null>(null);
  const [removeError, setRemoveError] = useState("");

  const editing = form?.id != null ? categories.find((c) => c.id === form.id) : undefined;
  const codeLocked = Boolean(editing && editing.title_count > 0);

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      setErrors({ name: "Name is required." });
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const body = { name: form.name.trim(), color_key: form.color_key, description: form.description.trim(), ...(form.code.trim() && !codeLocked ? { code: form.code.trim() } : {}) };
      if (form.id == null) await createBookCategory(body);
      else await updateBookCategory(form.id, body);
      notify(form.id == null ? "Category added" : "Category saved");
      setForm(null);
      onChanged();
    } catch (err) {
      const messages = fieldMessages(err);
      setErrors(Object.keys(messages).length ? messages : { name: describeError(err, "Could not save the category.") });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (category: BookCategory) => {
    try {
      await updateBookCategory(category.id, { is_active: !category.is_active });
      onChanged();
    } catch (err) {
      notify(describeError(err), "danger");
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    setRemoveError("");
    try {
      await deleteBookCategory(removing.id);
      notify("Category deleted");
      setRemoving(null);
      onChanged();
    } catch (err) {
      setRemoveError(describeError(err, "Could not delete the category."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        title="Manage categories"
        onClose={onClose}
        width={720}
        footer={
          canCreate && !form ? (
            <Btn variant="primary" onClick={() => setForm(blank())}>
              Add category
            </Btn>
          ) : undefined
        }
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Category</th>
              <th style={thStyle}>Prefix</th>
              <th style={thStyle}>Titles</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle} />
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td style={tdStyle}>
                  <Dot color={colorVar(category.color_key)} />
                  {category.name}
                </td>
                <td style={{ ...tdStyle, fontFamily: "var(--font-mono)" }}>{category.code}</td>
                <td style={tdStyle}>{category.title_count}</td>
                <td style={tdStyle}>
                  <label style={{ fontSize: 12 }}>
                    <input type="checkbox" checked={category.is_active} disabled={!canUpdate} onChange={() => toggle(category)} aria-label={`${category.name} active`} />{" "}
                    {category.is_active ? <Pill tone="ok">Active</Pill> : <Pill>Inactive</Pill>}
                  </label>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                  {canUpdate ? (
                    <Btn small variant="ghost" onClick={() => { setErrors({}); setForm({ id: category.id, name: category.name, code: category.code, color_key: category.color_key, description: category.description }); }}>
                      Edit
                    </Btn>
                  ) : null}
                  {canDelete ? (
                    <Btn small variant="ghost" onClick={() => { setRemoveError(""); setRemoving(category); }}>
                      Delete
                    </Btn>
                  ) : null}
                </td>
              </tr>
            ))}
            {categories.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "var(--ink-3)" }}>
                  No categories yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>

        {form ? (
          <div style={{ marginTop: 16, padding: 14, background: "var(--bg-2)", borderRadius: 10 }}>
            <h3 style={{ margin: "0 0 10px", fontSize: 14, color: "var(--ink-1)" }}>{form.id == null ? "New category" : "Edit category"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
              <Field label="Name *" error={errors.name}>
                <input style={inputStyle} value={form.name} maxLength={120} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field
                label="Prefix code"
                error={errors.code}
                hint={codeLocked ? "Locked: this category has titles." : "Leave blank to derive it from the name."}
              >
                <input
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)", textTransform: "uppercase" }}
                  value={form.code}
                  maxLength={8}
                  disabled={codeLocked}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                />
              </Field>
            </div>
            <Field label="Description" error={errors.description}>
              <input style={inputStyle} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
            <div role="group" aria-label="Colour" style={{ display: "flex", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
              {CATEGORY_COLOR_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  title={key}
                  aria-label={`Colour ${key}`}
                  aria-pressed={form.color_key === key}
                  onClick={() => setForm({ ...form, color_key: key })}
                  style={{
                    width: 24, height: 24, borderRadius: 999, background: colorVar(key), cursor: "pointer",
                    border: form.color_key === key ? "3px solid var(--ink-1)" : "2px solid var(--bg-1)",
                  }}
                />
              ))}
            </div>
            {errors.color_key ? <div role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{errors.color_key}</div> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <Btn variant="primary" onClick={save} disabled={busy}>
                {busy ? "Saving..." : "Save"}
              </Btn>
              <Btn onClick={() => setForm(null)} disabled={busy}>
                Cancel
              </Btn>
            </div>
          </div>
        ) : null}
      </Modal>
      {removing ? (
        <ConfirmDialog
          title="Delete category"
          message={`Delete "${removing.name}"? A category that has titles cannot be deleted. Make it inactive instead.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={remove}
          onCancel={() => setRemoving(null)}
        >
          {removeError ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{removeError}</div> : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}

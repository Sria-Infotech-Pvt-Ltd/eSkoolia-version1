"use client";

import { useEffect, useMemo, useState } from "react";
import { addCopies, createBook, getBook, LibraryApiError, listDonations, listPurchaseOrders, updateBook } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import type { AgeBand, BookCategory, BookDetail, BookFormat, CopyCondition, Donation, PurchaseOrder } from "@/types/library";
import {
  AGE_BAND_LABELS,
  emptyWizard,
  FORMAT_LABELS,
  LAST_STEP,
  stepForField,
  toBookInput,
  totalValue,
  validateWizardStep,
  firstInvalidStep,
  WIZARD_STEPS,
  type WizardData,
  type WizardErrors,
} from "./wizard";
import { Btn, describeError, Field, fieldMessages, inputStyle, Modal, SkeletonRows, StateBox } from "./ui";

interface Props {
  categories: BookCategory[];
  /** Edit an existing title. Omit to accession a new one. */
  bookId?: number;
  onClose: () => void;
  onSaved: () => void;
  onPrintLabels: (bookId: number) => void;
}

const CONDITIONS: CopyCondition[] = ["new", "good", "fair", "worn", "damaged"];

function fromDetail(book: BookDetail): WizardData {
  return {
    ...emptyWizard(),
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    publisher: book.publisher,
    publication_year: book.publication_year ? String(book.publication_year) : "",
    language: book.language,
    category: book.category ? String(book.category.id) : "",
    age_band: book.age_band,
    for_students: book.for_students,
    for_teachers: book.for_teachers,
    for_staff: book.for_staff,
    format: book.format,
    is_reference_only: book.is_reference_only,
    copies_count: "0",
    cost_per_copy: book.cost_per_copy,
    edition: book.edition,
    part_label: book.part_label,
    source: book.source,
    purchase_order: book.purchase_order ? String(book.purchase_order) : "",
    donation: book.donation ? String(book.donation) : "",
    vendor_name: book.vendor_name,
    donor_name: book.donor_name,
    call_number: book.call_number,
    rack: book.rack,
    remarks: book.remarks,
  };
}

export function AccessionWizard({ categories, bookId, onClose, onSaved, onPrintLabels }: Props) {
  const editing = bookId !== undefined;
  const { can } = usePermissions();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [data, setData] = useState<WizardData>(emptyWizard());
  const [loaded, setLoaded] = useState(!editing);
  const [loadError, setLoadError] = useState("");
  const [existing, setExisting] = useState<BookDetail | null>(null);
  const [step, setStep] = useState(0);
  const [clientErrors, setClientErrors] = useState<WizardErrors>({});
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<BookDetail | null>(null);
  const [addedCodes, setAddedCodes] = useState<string[]>([]);

  // Open orders and recent donations for the source step. Skipped without the matching view code.
  const canPickOrder = can("library.purchase_orders.view");
  const canPickDonation = can("library.donations.view");
  useEffect(() => {
    let cancelled = false;
    if (canPickOrder) {
      listPurchaseOrders({ page_size: 100 }, { silent401: true })
        .then((page) => !cancelled && setOrders(page.results.filter((order) => order.status !== "cancelled")))
        .catch(() => undefined);
    }
    if (canPickDonation) {
      listDonations({ page_size: 100 }, { silent401: true })
        .then((page) => !cancelled && setDonations(page.results))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [canPickOrder, canPickDonation]);

  useEffect(() => {
    if (bookId === undefined) return;
    let cancelled = false;
    getBook(bookId, { silent401: true })
      .then((detail) => {
        if (cancelled) return;
        setExisting(detail);
        setData(fromDetail(detail));
        setLoaded(true);
      })
      .catch((error) => !cancelled && setLoadError(describeError(error, "Could not load this title.")));
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  const options = useMemo(() => {
    const list = categories.filter((c) => c.is_active);
    const current = existing?.category;
    if (current && !list.some((c) => c.id === current.id)) {
      const known = categories.find((c) => c.id === current.id);
      if (known) list.push(known);
    }
    return list;
  }, [categories, existing]);

  const error = (field: keyof WizardData | "audience") => serverErrors[field] ?? clientErrors[field];

  const set = <K extends keyof WizardData>(field: K, value: WizardData[K]) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setClientErrors((prev) => ({ ...prev, [field]: undefined, ...(field.startsWith("for_") ? { audience: undefined } : {}) }));
    setServerErrors((prev) => {
      const copy = { ...prev };
      delete copy[field];
      if (field.startsWith("for_")) {
        delete copy.audience;
        delete copy.for_students;
      }
      return copy;
    });
  };

  const next = () => {
    const errors = validateWizardStep(step, data, { editing });
    setClientErrors(errors);
    if (!Object.keys(errors).length) setStep((s) => Math.min(LAST_STEP, s + 1));
  };

  const save = async () => {
    const invalid = firstInvalidStep(data, { editing });
    if (invalid !== null) {
      setClientErrors(validateWizardStep(invalid, data, { editing }));
      setStep(invalid);
      return;
    }
    setSaving(true);
    setBanner("");
    setServerErrors({});
    try {
      const body = toBookInput(data);
      const copies = Number(data.copies_count) || 0;
      let result: BookDetail;
      if (editing && bookId !== undefined) {
        result = await updateBook(bookId, body);
        if (copies > 0) {
          const added = await addCopies(bookId, { count: copies, condition: data.condition });
          result = added.data;
          setAddedCodes(added.added);
        }
      } else {
        result = await createBook({ ...body, copies_count: copies, condition: data.condition });
      }
      setDone(result);
      onSaved();
    } catch (err) {
      const messages = fieldMessages(err);
      const mapped: Record<string, string> = {};
      let jump: number | null = null;
      for (const [field, message] of Object.entries(messages)) {
        if (field === "non_field_errors") continue;
        mapped[field] = message;
        const target = stepForField(field);
        if (target !== null && (jump === null || target < jump)) jump = target;
      }
      setServerErrors(mapped);
      if (jump !== null) setStep(jump);
      if (!Object.keys(mapped).length || (err instanceof LibraryApiError && err.code && err.code !== "validation_error")) {
        setBanner(describeError(err, "Could not save this title."));
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setData(emptyWizard());
    setStep(0);
    setDone(null);
    setAddedCodes([]);
    setClientErrors({});
    setServerErrors({});
    setBanner("");
  };

  const chosenCategory = categories.find((c) => String(c.id) === data.category);

  if (done) {
    const codes = addedCodes.length ? addedCodes : done.copies.map((c) => c.code);
    return (
      <Modal
        title={editing ? "Title updated" : "Title accessioned"}
        onClose={onClose}
        footer={
          <>
            <Btn onClick={() => onPrintLabels(done.id)}>Print labels</Btn>
            {!editing ? <Btn onClick={reset}>Add another</Btn> : null}
            <Btn variant="primary" onClick={onClose}>
              Done
            </Btn>
          </>
        }
      >
        <p style={{ margin: "0 0 8px", color: "var(--ink-1)" }}>
          <strong>{done.title}</strong> is saved as <code style={{ fontFamily: "var(--font-mono)" }}>{done.accession_code}</code>.
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 13, color: "var(--ink-2)" }}>
          {editing ? `${codes.length} cop${codes.length === 1 ? "y" : "ies"} added.` : `${codes.length} cop${codes.length === 1 ? "y" : "ies"} created:`}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {codes.slice(0, 40).map((code) => (
            <code key={code} style={{ fontFamily: "var(--font-mono)", fontSize: 12, background: "var(--bg-2)", padding: "2px 6px", borderRadius: 6 }}>
              {code}
            </code>
          ))}
          {codes.length > 40 ? <span style={{ fontSize: 12, color: "var(--ink-3)" }}>and {codes.length - 40} more</span> : null}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={editing ? "Edit title" : "New accession"}
      onClose={onClose}
      width={720}
      footer={
        <>
          {step > 0 ? (
            <Btn onClick={() => setStep(step - 1)} disabled={saving}>
              Back
            </Btn>
          ) : null}
          {step < LAST_STEP ? (
            <Btn variant="primary" onClick={next} disabled={!loaded}>
              Next
            </Btn>
          ) : (
            <Btn variant="primary" onClick={save} disabled={saving || !loaded}>
              {saving ? "Saving..." : editing ? "Save changes" : "Save accession"}
            </Btn>
          )}
        </>
      }
    >
      {loadError ? <StateBox tone="danger" title="Could not load this title">{loadError}</StateBox> : null}
      {!loaded && !loadError ? <SkeletonRows rows={4} columns={2} /> : null}
      {loaded ? (
        <>
          <ol aria-label="Steps" style={{ display: "flex", gap: 6, listStyle: "none", padding: 0, margin: "0 0 16px", flexWrap: "wrap" }}>
            {WIZARD_STEPS.map((name, index) => (
              <li
                key={name}
                aria-current={index === step ? "step" : undefined}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999,
                  background: index === step ? "var(--pu)" : index < step ? "var(--pu-soft)" : "var(--bg-3)",
                  color: index === step ? "var(--bg-1)" : index < step ? "var(--pu-deep)" : "var(--ink-3)",
                }}
              >
                {index + 1}. {name}
              </li>
            ))}
          </ol>
          {banner ? (
            <div role="alert" style={{ background: "var(--danger-soft)", color: "var(--danger)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
              {banner}
            </div>
          ) : null}

          {step === 0 ? (
            <>
              <Field label="Title *" error={error("title")}>
                <input style={inputStyle} value={data.title} maxLength={255} autoFocus onChange={(e) => set("title", e.target.value)} />
              </Field>
              <Field label="Author" error={error("author")}>
                <input style={inputStyle} value={data.author} maxLength={180} onChange={(e) => set("author", e.target.value)} />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="ISBN" error={error("isbn")}>
                  <input style={inputStyle} value={data.isbn} maxLength={40} onChange={(e) => set("isbn", e.target.value)} />
                </Field>
                <Field label="Publisher" error={error("publisher")}>
                  <input style={inputStyle} value={data.publisher} maxLength={180} onChange={(e) => set("publisher", e.target.value)} />
                </Field>
                <Field label="Publication year" error={error("publication_year")}>
                  <input style={inputStyle} value={data.publication_year} inputMode="numeric" maxLength={4} onChange={(e) => set("publication_year", e.target.value)} />
                </Field>
                <Field label="Language" error={error("language")}>
                  <input style={inputStyle} value={data.language} maxLength={30} onChange={(e) => set("language", e.target.value)} />
                </Field>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <Field label="Category *" error={error("category")} hint="Inactive categories are not offered for new titles.">
                <select style={inputStyle} value={data.category} onChange={(e) => set("category", e.target.value)}>
                  <option value="">Choose a category</option>
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Age band *" error={error("age_band")}>
                <select style={inputStyle} value={data.age_band} onChange={(e) => set("age_band", e.target.value as AgeBand | "")}>
                  <option value="">Choose an age band</option>
                  {Object.entries(AGE_BAND_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <fieldset style={{ border: "none", padding: 0, margin: "0 0 12px" }}>
                <legend style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)", marginBottom: 4 }}>Readers * (at least one)</legend>
                {(
                  [
                    ["for_students", "Students"],
                    ["for_teachers", "Teachers"],
                    ["for_staff", "Staff"],
                  ] as const
                ).map(([field, label]) => (
                  <label key={field} style={{ marginRight: 16, fontSize: 13, color: "var(--ink-1)" }}>
                    <input type="checkbox" checked={data[field]} onChange={(e) => set(field, e.target.checked)} /> {label}
                  </label>
                ))}
                {error("audience") ?? serverErrors.for_students ? (
                  <div role="alert" style={{ fontSize: 12, color: "var(--danger)", marginTop: 3 }}>
                    {error("audience") ?? serverErrors.for_students}
                  </div>
                ) : null}
              </fieldset>
              <Field label="Format" error={error("format")}>
                <select style={inputStyle} value={data.format} onChange={(e) => set("format", e.target.value as BookFormat)}>
                  {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <label style={{ fontSize: 13, color: "var(--ink-1)" }}>
                <input type="checkbox" checked={data.is_reference_only} onChange={(e) => set("is_reference_only", e.target.checked)} /> Reference only (cannot be issued for home use)
              </label>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field
                  label={editing ? "Add more copies" : "Copies *"}
                  error={error("copies_count")}
                  hint={editing ? "0 adds none. To remove a copy, withdraw it from the copies register." : undefined}
                >
                  <input style={inputStyle} value={data.copies_count} inputMode="numeric" onChange={(e) => set("copies_count", e.target.value)} />
                </Field>
                <Field label="Cost per copy" error={error("cost_per_copy")}>
                  <input style={inputStyle} value={data.cost_per_copy} inputMode="decimal" onChange={(e) => set("cost_per_copy", e.target.value)} />
                </Field>
                <Field label="Edition" error={error("edition")}>
                  <input style={inputStyle} value={data.edition} maxLength={80} onChange={(e) => set("edition", e.target.value)} />
                </Field>
                <Field label="Part or volume" error={error("part_label")}>
                  <input style={inputStyle} value={data.part_label} maxLength={80} onChange={(e) => set("part_label", e.target.value)} />
                </Field>
                <Field label="Condition of new copies" error={error("condition")}>
                  <select style={inputStyle} value={data.condition} onChange={(e) => set("condition", e.target.value as CopyCondition)}>
                    {CONDITIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-2)" }}>Total value of these copies: {totalValue(data)}</p>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <Field label="Source" error={error("source")}>
                <select style={inputStyle} value={data.source} onChange={(e) => set("source", e.target.value as "purchased" | "donated")}>
                  <option value="purchased">Purchased</option>
                  <option value="donated">Donated</option>
                </select>
              </Field>
              {data.source === "purchased" && canPickOrder ? (
                <Field label="Purchase order (optional)" error={error("purchase_order")} hint="Links the title to an order so the order shows how many titles were cataloged.">
                  <select
                    style={inputStyle}
                    value={data.purchase_order}
                    onChange={(e) => {
                      const order = orders.find((o) => String(o.id) === e.target.value);
                      set("purchase_order", e.target.value);
                      if (order && !data.vendor_name.trim()) set("vendor_name", order.vendor_name);
                    }}
                  >
                    <option value="">No purchase order</option>
                    {orders.map((order) => (
                      <option key={order.id} value={order.id}>{order.po_number} - {order.vendor_name}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {data.source === "donated" && canPickDonation ? (
                <Field label="Donation (optional)" error={error("donation")} hint="Links the title to a donation receipt.">
                  <select
                    style={inputStyle}
                    value={data.donation}
                    onChange={(e) => {
                      const donation = donations.find((d) => String(d.id) === e.target.value);
                      set("donation", e.target.value);
                      if (donation && !data.donor_name.trim()) set("donor_name", donation.donor_name);
                    }}
                  >
                    <option value="">No donation record</option>
                    {donations.map((donation) => (
                      <option key={donation.id} value={donation.id}>{donation.receipt_no} - {donation.donor_name}</option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {data.source === "purchased" ? (
                <Field label="Vendor" error={error("vendor_name")}>
                  <input style={inputStyle} value={data.vendor_name} maxLength={180} onChange={(e) => set("vendor_name", e.target.value)} />
                </Field>
              ) : (
                <Field label="Donor" error={error("donor_name")} hint="Donor names are personal data and are never written to the activity log.">
                  <input style={inputStyle} value={data.donor_name} maxLength={180} onChange={(e) => set("donor_name", e.target.value)} />
                </Field>
              )}
              <Field label="Accession code" hint="Assigned by the system and never reused.">
                <input
                  style={{ ...inputStyle, background: "var(--bg-2)", fontFamily: "var(--font-mono)" }}
                  readOnly
                  value={existing ? existing.accession_code : chosenCategory ? `LIB-${chosenCategory.code}-####` : "Choose a category first"}
                />
              </Field>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <Field label="Rack" error={error("rack")}>
                  <input style={inputStyle} value={data.rack} maxLength={50} onChange={(e) => set("rack", e.target.value)} />
                </Field>
                <Field label="Call number" error={error("call_number")}>
                  <input style={inputStyle} value={data.call_number} maxLength={40} onChange={(e) => set("call_number", e.target.value)} />
                </Field>
              </div>
              <Field label="Remarks" error={error("remarks")}>
                <textarea style={{ ...inputStyle, height: 70, padding: 8 }} value={data.remarks} onChange={(e) => set("remarks", e.target.value)} />
              </Field>
            </>
          ) : null}

          {step === 4 ? (
            <dl style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: "6px 12px", fontSize: 13, margin: 0 }}>
              {[
                ["Title", `${data.title}${data.edition ? ` (${data.edition} ed.)` : ""}${data.part_label ? ` ${data.part_label}` : ""}`],
                ["Author", data.author || "Not given"],
                ["Category", chosenCategory ? `${chosenCategory.name} (${chosenCategory.code})` : ""],
                ["Age band", data.age_band ? AGE_BAND_LABELS[data.age_band] : ""],
                ["Readers", [data.for_students && "Students", data.for_teachers && "Teachers", data.for_staff && "Staff"].filter(Boolean).join(", ")],
                ["Format", FORMAT_LABELS[data.format] + (data.is_reference_only ? ", reference only" : "")],
                [editing ? "Copies to add" : "Copies", data.copies_count],
                ["Cost per copy", data.cost_per_copy],
                ["Total value", totalValue(data)],
                ["Source", data.source === "purchased" ? `Purchased${data.vendor_name ? ` from ${data.vendor_name}` : ""}` : "Donated"],
                ["Rack", data.rack || "Not set"],
              ].map(([term, value]) => (
                <div key={term} style={{ display: "contents" }}>
                  <dt style={{ color: "var(--ink-3)" }}>{term}</dt>
                  <dd style={{ margin: 0, color: "var(--ink-1)" }}>{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}

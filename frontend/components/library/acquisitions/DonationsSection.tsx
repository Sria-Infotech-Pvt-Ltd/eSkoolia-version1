"use client";

import { useState } from "react";
import { createDonation, LibraryApiError, listDonations, updateDonation } from "@/hooks/useLibraryApi";
import type { Donation, DonorType } from "@/types/library";
import { Btn, Field, inputStyle, Modal, Pill, SkeletonRows, StateBox, tdStyle, thStyle } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { DONOR_TYPE_LABEL, formatMoney, isValidAmount } from "./acquisitionsHelpers";
import { cardStyle, firstError, FormAlert, Pager, SectionHeader } from "./parts";
import { ReceiptPrintView } from "./ReceiptPrintView";
import { useSectionList } from "./useSectionList";

interface Props {
  can: (code: string) => boolean;
  onChanged: (message: string, tone?: "ok" | "danger") => void;
}

export function DonationsSection({ can, onChanged }: Props) {
  const canView = can("library.donations.view");
  const canCreate = can("library.donations.create");
  const [type, setType] = useState<DonorType | "">("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [receipt, setReceipt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useSectionList(
    "library-donations",
    canView,
    (page, pageSize) => listDonations({ page, page_size: pageSize, donor_type: type || undefined, search: search.trim() || undefined }),
    `${type}|${search}`,
    "Could not load the donations.",
  );
  const { setPage } = list;

  if (!canView && !canCreate) return null;

  const acknowledge = async (row: Donation) => {
    setBusy(true);
    try {
      await updateDonation(row.id, { acknowledgement_sent: !row.acknowledgement_sent });
      onChanged(row.acknowledgement_sent ? `${row.receipt_no} marked as not acknowledged` : `${row.receipt_no} marked as acknowledged`);
      await list.load();
    } catch (err) {
      onChanged(refusalMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Donations">
      <SectionHeader
        title="Donations"
        hint="Books given to the library. Donor contact details are visible only to people with donations access."
        actions={
          <>
            {canView ? (
              <>
                <input aria-label="Search donations" placeholder="Donor or receipt" style={{ ...inputStyle, width: 170 }} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
                <select aria-label="Donor type" style={{ ...inputStyle, width: 150 }} value={type} onChange={(e) => { setType(e.target.value as DonorType | ""); setPage(1); }}>
                  <option value="">All donors</option>
                  {(Object.keys(DONOR_TYPE_LABEL) as DonorType[]).map((t) => (
                    <option key={t} value={t}>{DONOR_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </>
            ) : null}
            {canCreate ? <Btn variant="primary" onClick={() => setCreating(true)}>Log a donation</Btn> : null}
          </>
        }
      />
      {!canView ? (
        <StateBox title="You can log donations but not view them">Ask an administrator for the donations view permission to see the list.</StateBox>
      ) : list.error ? (
        <StateBox tone="danger" title="Could not load the donations">
          {list.error} <Btn small onClick={list.load}>Retry</Btn>
        </StateBox>
      ) : (
        <div style={cardStyle}>
          {list.loading ? (
            <SkeletonRows rows={4} columns={7} />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Receipt</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Donor</th>
                  <th style={thStyle}>Contact</th>
                  <th style={thStyle}>Books</th>
                  <th style={thStyle}>Value</th>
                  <th style={thStyle}>Thanked</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((row) => (
                  <tr key={row.id}>
                    <td style={{ ...tdStyle, fontFamily: "var(--font-mono)", fontWeight: 600 }}>{row.receipt_no}</td>
                    <td style={tdStyle}>{formatDate(row.donation_date)}</td>
                    <td style={tdStyle}>
                      <div>{row.donor_name}</div>
                      <div style={{ fontSize: 11, color: "var(--ink-3)" }}>{DONOR_TYPE_LABEL[row.donor_type]}</div>
                    </td>
                    <td style={tdStyle}>{row.contact ? row.contact : <span style={{ color: "var(--ink-3)" }}>None</span>}</td>
                    <td style={tdStyle}>
                      {row.books_count}
                      {row.linked_books ? <span style={{ color: "var(--ink-3)", fontSize: 11 }}> ({row.linked_books} cataloged)</span> : null}
                    </td>
                    <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{formatMoney(row.estimated_value)}</td>
                    <td style={tdStyle}>
                      <Pill tone={row.acknowledgement_sent ? "ok" : "warn"}>{row.acknowledgement_sent ? "Thanked" : "Not yet"}</Pill>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                      {can("library.donations.update") ? (
                        <Btn small variant="ghost" disabled={busy} onClick={() => acknowledge(row)}>
                          {row.acknowledgement_sent ? "Undo thanks" : "Mark thanked"}
                        </Btn>
                      ) : null}
                      <Btn small variant="ghost" onClick={() => setReceipt(row.id)}>Receipt</Btn>
                    </td>
                  </tr>
                ))}
                {list.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>
                      {type || search ? "No donation matches this filter." : "No donations logged yet."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      )}
      {canView && !list.error ? <Pager count={list.count} page={list.page} pageSize={list.pageSize} loading={list.loading} noun="donation" onPage={list.setPage} onPageSize={list.setPageSize} /> : null}

      {creating ? (
        <DonationModal
          onClose={() => setCreating(false)}
          onCreated={async (receiptNo) => {
            setCreating(false);
            onChanged(`Donation ${receiptNo} logged`);
            if (canView) await list.load();
          }}
        />
      ) : null}
      {receipt !== null ? <ReceiptPrintView donationId={receipt} onClose={() => setReceipt(null)} /> : null}
    </section>
  );
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function DonationModal({ onClose, onCreated }: { onClose: () => void; onCreated: (receiptNo: string) => void }) {
  const [form, setForm] = useState({ donor_name: "", donor_type: "parent" as DonorType, contact: "", donation_date: today(), books_count: "", estimated_value: "0", notes: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [fields, setFields] = useState<Record<string, string[]> | undefined>();
  const set = <K extends keyof typeof form>(name: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [name]: value }));
  const count = Number(form.books_count);
  const valid = form.donor_name.trim() !== "" && Number.isInteger(count) && count >= 1 && isValidAmount(form.estimated_value) && form.donation_date !== "";

  const save = async () => {
    setBusy(true);
    setProblem("");
    setFields(undefined);
    try {
      const row = await createDonation({
        donor_name: form.donor_name.trim(),
        donor_type: form.donor_type,
        contact: form.contact.trim(),
        donation_date: form.donation_date,
        books_count: count,
        estimated_value: form.estimated_value.trim(),
        notes: form.notes.trim(),
      });
      onCreated(row.receipt_no);
    } catch (err) {
      setFields(err instanceof LibraryApiError ? err.fieldErrors : undefined);
      setProblem(refusalMessage(err, "Could not log the donation."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Log a donation"
      onClose={onClose}
      width={540}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={busy || !valid}>{busy ? "Saving..." : "Log donation"}</Btn>
        </>
      }
    >
      <FormAlert text={problem} />
      <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 0 }}>The receipt number is assigned when you save. Donor name and contact are personal data and are never written to the activity log.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Donor name" error={firstError(fields, "donor_name")}>
          <input style={inputStyle} value={form.donor_name} maxLength={180} autoFocus onChange={(e) => set("donor_name", e.target.value)} />
        </Field>
        <Field label="Donor type" error={firstError(fields, "donor_type")}>
          <select style={inputStyle} value={form.donor_type} onChange={(e) => set("donor_type", e.target.value as DonorType)}>
            {(Object.keys(DONOR_TYPE_LABEL) as DonorType[]).map((t) => (
              <option key={t} value={t}>{DONOR_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </Field>
        <Field label="Contact (optional)" error={firstError(fields, "contact")}>
          <input style={inputStyle} value={form.contact} maxLength={120} onChange={(e) => set("contact", e.target.value)} />
        </Field>
        <Field label="Date" error={firstError(fields, "donation_date")}>
          <input type="date" style={inputStyle} value={form.donation_date} onChange={(e) => set("donation_date", e.target.value)} />
        </Field>
        <Field label="Number of books" error={firstError(fields, "books_count")}>
          <input style={inputStyle} inputMode="numeric" value={form.books_count} onChange={(e) => set("books_count", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Estimated value" error={firstError(fields, "estimated_value") ?? (!isValidAmount(form.estimated_value) ? "Enter an amount such as 250 or 250.50." : undefined)}>
          <input style={inputStyle} inputMode="decimal" value={form.estimated_value} onChange={(e) => set("estimated_value", e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)" error={firstError(fields, "notes")}>
        <input style={inputStyle} value={form.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </Modal>
  );
}

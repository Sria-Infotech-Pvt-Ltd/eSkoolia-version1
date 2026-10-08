"use client";

import { useState } from "react";
import {
  createPurchaseOrder,
  deletePurchaseOrder,
  LibraryApiError,
  listPurchaseOrders,
  updatePurchaseOrder,
} from "@/hooks/useLibraryApi";
import type { PoStatus, PurchaseOrder, PurchaseOrderPatch } from "@/types/library";
import { Btn, ConfirmDialog, Field, inputStyle, Modal, Pill, SkeletonRows, StateBox, tdStyle, thStyle } from "../catalogue/ui";
import { formatDate, refusalMessage } from "../issue-desk/deskHelpers";
import { formatMoney, isValidAmount, PAYMENT_TONE, PO_STATUS_TONE, poActions } from "./acquisitionsHelpers";
import { cardStyle, firstError, FormAlert, Pager, SectionHeader } from "./parts";
import { useSectionList } from "./useSectionList";

interface Props {
  can: (code: string) => boolean;
  refreshKey: number;
  /** Called after any change that moves the budget numbers. */
  onChanged: (message: string, tone?: "ok" | "danger") => void;
}

const STATUS_LABEL: Record<PoStatus, string> = { ordered: "Ordered", received: "Received", cancelled: "Cancelled" };

export function PurchaseOrdersSection({ can, refreshKey, onChanged }: Props) {
  const canView = can("library.purchase_orders.view");
  const [status, setStatus] = useState<PoStatus | "">("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<PurchaseOrder | null>(null);
  const list = useSectionList(
    "library-purchase-orders",
    canView,
    (page, pageSize) => listPurchaseOrders({ page, page_size: pageSize, status: status || undefined, search: search.trim() || undefined }),
    `${status}|${search}|${refreshKey}`,
    "Could not load the purchase orders.",
  );
  const { setPage } = list;

  if (!canView) return null;

  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await work();
      onChanged(done);
      await list.load();
    } catch (err) {
      // 409: the order is already past that step. Say why and show the current state.
      onChanged(refusalMessage(err), "danger");
      await list.load();
    } finally {
      setBusy(false);
    }
  };
  const patch = (order: PurchaseOrder, body: PurchaseOrderPatch, done: string) => act(() => updatePurchaseOrder(order.id, body), done);

  return (
    <section aria-label="Purchase orders">
      <SectionHeader
        title="Purchase orders"
        hint="Orders placed with vendors. The budget counts every order that is not cancelled."
        actions={
          <>
            <input aria-label="Search purchase orders" placeholder="PO, vendor or invoice" style={{ ...inputStyle, width: 190 }} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <select aria-label="PO status" style={{ ...inputStyle, width: 140 }} value={status} onChange={(e) => { setStatus(e.target.value as PoStatus | ""); setPage(1); }}>
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as PoStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </select>
            {can("library.purchase_orders.create") ? <Btn variant="primary" onClick={() => setCreating(true)}>New PO</Btn> : null}
          </>
        }
      />
      {list.error ? (
        <StateBox tone="danger" title="Could not load the purchase orders">
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
                  <th style={thStyle}>PO</th>
                  <th style={thStyle}>Date</th>
                  <th style={thStyle}>Vendor</th>
                  <th style={thStyle}>Books</th>
                  <th style={thStyle}>Total</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Payment</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {list.rows.map((order) => {
                  const allowed = poActions(order);
                  return (
                    <tr key={order.id}>
                      <td style={tdStyle}>
                        <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{order.po_number}</div>
                        {order.invoice_number ? <div style={{ fontSize: 11, color: "var(--ink-3)" }}>Invoice {order.invoice_number}</div> : null}
                      </td>
                      <td style={tdStyle}>{formatDate(order.order_date)}</td>
                      <td style={tdStyle}>{order.vendor_name}</td>
                      <td style={tdStyle}>
                        {order.books_count}
                        {order.linked_books ? <span style={{ color: "var(--ink-3)", fontSize: 11 }}> ({order.linked_books} cataloged)</span> : null}
                      </td>
                      <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>{formatMoney(order.total_cost)}</td>
                      <td style={tdStyle}><Pill tone={PO_STATUS_TONE[order.status]}>{STATUS_LABEL[order.status]}</Pill></td>
                      <td style={tdStyle}><Pill tone={PAYMENT_TONE[order.payment_status]}>{order.payment_status === "paid" ? "Paid" : "Pending"}</Pill></td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                        {can("library.purchase_orders.update") ? (
                          <>
                            {allowed.receive ? <Btn small variant="ghost" disabled={busy} onClick={() => patch(order, { status: "received" }, `${order.po_number} marked received`)}>Receive</Btn> : null}
                            {allowed.markPaid ? <Btn small variant="ghost" disabled={busy} onClick={() => patch(order, { payment_status: "paid" }, `${order.po_number} marked paid`)}>Mark paid</Btn> : null}
                            {allowed.cancel ? <Btn small variant="ghost" disabled={busy} onClick={() => patch(order, { status: "cancelled" }, `${order.po_number} cancelled`)}>Cancel</Btn> : null}
                          </>
                        ) : null}
                        {allowed.remove && can("library.purchase_orders.delete") ? (
                          <Btn small variant="ghost" disabled={busy} onClick={() => setRemoving(order)}>Delete</Btn>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {list.rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>
                      {status || search ? "No purchase order matches this filter." : "No purchase orders yet."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      )}
      {!list.error ? <Pager count={list.count} page={list.page} pageSize={list.pageSize} loading={list.loading} noun="order" onPage={list.setPage} onPageSize={list.setPageSize} /> : null}

      {creating ? (
        <PurchaseOrderModal
          onClose={() => setCreating(false)}
          onCreated={async (number) => {
            setCreating(false);
            onChanged(`Purchase order ${number} created`);
            await list.load();
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title="Delete purchase order"
          message={`Delete ${removing.po_number} from ${removing.vendor_name}? It has not been received and no titles are linked to it.`}
          confirmLabel="Delete"
          busy={busy}
          onConfirm={async () => {
            const target = removing;
            setRemoving(null);
            await act(() => deletePurchaseOrder(target.id), `${target.po_number} deleted`);
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </section>
  );
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function PurchaseOrderModal({ onClose, onCreated }: { onClose: () => void; onCreated: (poNumber: string) => void }) {
  const [form, setForm] = useState({ order_date: today(), vendor_name: "", invoice_number: "", books_count: "", total_cost: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [fields, setFields] = useState<Record<string, string[]> | undefined>();
  const set = (name: keyof typeof form, value: string) => setForm((current) => ({ ...current, [name]: value }));
  const count = Number(form.books_count);
  const valid = form.vendor_name.trim() !== "" && Number.isInteger(count) && count >= 1 && isValidAmount(form.total_cost) && form.order_date !== "";

  const save = async () => {
    setBusy(true);
    setProblem("");
    setFields(undefined);
    try {
      const order = await createPurchaseOrder({
        order_date: form.order_date,
        vendor_name: form.vendor_name.trim(),
        invoice_number: form.invoice_number.trim(),
        books_count: count,
        total_cost: form.total_cost.trim(),
        notes: form.notes.trim(),
      });
      onCreated(order.po_number);
    } catch (err) {
      setFields(err instanceof LibraryApiError ? err.fieldErrors : undefined);
      setProblem(refusalMessage(err, "Could not create the purchase order."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New purchase order"
      onClose={onClose}
      width={520}
      footer={
        <>
          <Btn onClick={onClose} disabled={busy}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={busy || !valid}>{busy ? "Saving..." : "Create PO"}</Btn>
        </>
      }
    >
      <FormAlert text={problem} />
      <p style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 0 }}>The PO number is assigned when you save. The order counts against the current academic year.</p>
      <Field label="Vendor" error={firstError(fields, "vendor_name")}>
        <input style={inputStyle} value={form.vendor_name} maxLength={180} autoFocus onChange={(e) => set("vendor_name", e.target.value)} />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Order date" error={firstError(fields, "order_date")}>
          <input type="date" style={inputStyle} value={form.order_date} onChange={(e) => set("order_date", e.target.value)} />
        </Field>
        <Field label="Invoice number (optional)" error={firstError(fields, "invoice_number")}>
          <input style={inputStyle} value={form.invoice_number} maxLength={60} onChange={(e) => set("invoice_number", e.target.value)} />
        </Field>
        <Field label="Number of books" error={firstError(fields, "books_count")}>
          <input style={inputStyle} inputMode="numeric" value={form.books_count} onChange={(e) => set("books_count", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field label="Total cost" error={firstError(fields, "total_cost") ?? (form.total_cost && !isValidAmount(form.total_cost) ? "Enter an amount such as 1500 or 1500.50." : undefined)}>
          <input style={inputStyle} inputMode="decimal" value={form.total_cost} onChange={(e) => set("total_cost", e.target.value)} />
        </Field>
      </div>
      <Field label="Notes (optional)" error={firstError(fields, "notes")}>
        <input style={inputStyle} value={form.notes} maxLength={1000} onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </Modal>
  );
}

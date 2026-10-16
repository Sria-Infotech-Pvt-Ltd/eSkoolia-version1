"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { listBookCategories, listBooks } from "@/hooks/useLibraryApi";
import { usePermissions } from "@/hooks/usePermissions";
import { usePersistentPagination } from "@/hooks/usePersistentPagination";
import type { AvailabilityStatus, AgeBand, Book, BookCategory, BookListParams, CopyCondition } from "@/types/library";
import { AccessionWizard } from "./AccessionWizard";
import { BulkImportModal } from "./BulkImportModal";
import { CategoriesModal } from "./CategoriesModal";
import { colorVar } from "./colors";
import { CopiesRegisterModal } from "./CopiesRegisterModal";
import { ReserveModal } from "../issue-desk/ReserveModal";
import { LabelPrintView } from "./LabelPrintView";
import { ScannerSetupPanel } from "./ScannerSetupPanel";
import { Btn, describeError, Dot, inputStyle, Pill, SkeletonRows, StateBox, tdStyle, thStyle, useToast } from "./ui";
import { AGE_BAND_LABELS } from "./wizard";

type Reader = "" | "students" | "teachers" | "staff";

interface Filters {
  search: string;
  category: string;
  age_band: AgeBand | "";
  reader: Reader;
  condition: CopyCondition | "";
  availability: AvailabilityStatus | "";
}

const NO_FILTERS: Filters = { search: "", category: "", age_band: "", reader: "", condition: "", availability: "" };

const STATUS_PILL: Record<AvailabilityStatus, { tone: "ok" | "warn" | "danger"; label: string }> = {
  available: { tone: "ok", label: "Available" },
  low: { tone: "warn", label: "Low stock" },
  issued: { tone: "danger", label: "All issued" },
};

export function toListParams(filters: Filters, page: number, pageSize: number): BookListParams {
  return {
    page,
    page_size: pageSize,
    search: filters.search.trim() || undefined,
    category: filters.category ? Number(filters.category) : undefined,
    age_band: filters.age_band || undefined,
    for_students: filters.reader === "students" ? true : undefined,
    for_teachers: filters.reader === "teachers" ? true : undefined,
    for_staff: filters.reader === "staff" ? true : undefined,
    condition: filters.condition || undefined,
    availability: filters.availability || undefined,
    ordering: "title",
  };
}

export function CataloguePage() {
  const { me, can } = usePermissions();
  const { page, pageSize, setPage, setPageSize } = usePersistentPagination("library-catalogue", 1, 25);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [rows, setRows] = useState<Book[]>([]);
  const [count, setCount] = useState(0);
  const [categories, setCategories] = useState<BookCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizard, setWizard] = useState<{ bookId?: number } | null>(null);
  const [showCategories, setShowCategories] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [copiesFor, setCopiesFor] = useState<Book | null>(null);
  const [labelsFor, setLabelsFor] = useState<{ bookId: number; copyId?: number } | null>(null);
  const [reserveFor, setReserveFor] = useState<Book | null>(null);
  const { show, node: toastNode } = useToast();
  const latest = useRef(0);

  const canView = can("library.books.view");

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(handle);
  }, [filters.search]);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true);
    setError("");
    try {
      const data = await listBooks(toListParams({ ...filters, search: debouncedSearch }, page, pageSize));
      if (ticket !== latest.current) return; // a newer request superseded this one
      setRows(data.results);
      setCount(data.count);
    } catch (err) {
      if (ticket !== latest.current) return;
      const status = (err as { status?: number }).status;
      // A page past the end after filtering: go back to page one instead of showing an error.
      if (status === 404 && page > 1) {
        setPage(1);
        return;
      }
      setError(describeError(err, "Could not load the catalogue."));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.age_band, filters.reader, filters.condition, filters.availability, debouncedSearch, page, pageSize]);

  const loadCategories = useCallback(async () => {
    try {
      const data = await listBookCategories({ page_size: 200, ordering: "name" }, { silent401: true });
      setCategories(data.results);
    } catch {
      // Filters and the wizard simply have fewer options; the table error state covers real outages.
    }
  }, []);

  useEffect(() => {
    if (me && canView) {
      void load();
    }
  }, [me, canView, load]);

  useEffect(() => {
    if (me && canView) void loadCategories();
  }, [me, canView, loadCategories]);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const refreshAll = () => {
    void load();
    void loadCategories();
  };

  if (!me) {
    return (
      <Shell>
        <SkeletonRows rows={6} columns={6} />
      </Shell>
    );
  }
  if (!canView) {
    return (
      <Shell>
        <StateBox title="You do not have access to the catalogue">Ask an administrator to give your role the library books view permission.</StateBox>
      </Shell>
    );
  }

  const pages = Math.max(1, Math.ceil(count / pageSize));
  const filtered = Boolean(debouncedSearch || filters.category || filters.age_band || filters.reader || filters.condition || filters.availability);
  const colSpan = 9;

  return (
    <Shell
      actions={
        <>
          {can("library.book_categories.view") ? <Btn onClick={() => setShowCategories(true)}>Manage categories</Btn> : null}
          {can("library.books.import") ? <Btn onClick={() => setShowImport(true)}>Bulk import</Btn> : null}
          <Btn onClick={() => setShowScanner(true)}>Scanner setup</Btn>
          {can("library.books.create") ? (
            <Btn variant="primary" onClick={() => setWizard({})}>
              New accession
            </Btn>
          ) : null}
        </>
      }
    >
      <div role="search" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 14 }}>
        <input
          aria-label="Search titles"
          style={inputStyle}
          placeholder="Search title, author, ISBN, code"
          value={filters.search}
          onChange={(e) => setFilter("search", e.target.value)}
        />
        <select aria-label="Category" style={inputStyle} value={filters.category} onChange={(e) => setFilter("category", e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select aria-label="Age band" style={inputStyle} value={filters.age_band} onChange={(e) => setFilter("age_band", e.target.value as AgeBand | "")}>
          <option value="">All age bands</option>
          {Object.entries(AGE_BAND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Reader" style={inputStyle} value={filters.reader} onChange={(e) => setFilter("reader", e.target.value as Reader)}>
          <option value="">All readers</option>
          <option value="students">Students</option>
          <option value="teachers">Teachers</option>
          <option value="staff">Staff</option>
        </select>
        <select aria-label="Condition" style={inputStyle} value={filters.condition} onChange={(e) => setFilter("condition", e.target.value as CopyCondition | "")}>
          <option value="">Any condition</option>
          {["new", "good", "fair", "worn", "damaged"].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select aria-label="Status" style={inputStyle} value={filters.availability} onChange={(e) => setFilter("availability", e.target.value as AvailabilityStatus | "")}>
          <option value="">Any status</option>
          <option value="available">Available</option>
          <option value="low">Low stock</option>
          <option value="issued">All issued</option>
        </select>
      </div>

      {error ? (
        <StateBox tone="danger" title="Could not load the catalogue">
          {error} <Btn small onClick={load}>Retry</Btn>
        </StateBox>
      ) : (
        <div style={{ overflowX: "auto", background: "var(--bg-1)", border: "1px solid var(--bd)", borderRadius: 12, padding: "4px 8px" }}>
          {loading ? (
            <SkeletonRows rows={8} columns={7} />
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Call no.</th>
                  <th style={thStyle}>Category</th>
                  <th style={thStyle}>Readers</th>
                  <th style={thStyle}>Age band</th>
                  <th style={thStyle}>Cost</th>
                  <th style={thStyle}>Copies</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {rows.map((book) => {
                  const pill = STATUS_PILL[book.availability_status];
                  return (
                    <tr key={book.id}>
                      <td style={tdStyle}>
                        <div style={{ fontWeight: 600 }}>
                          {book.title}
                          {book.edition ? <span style={{ fontWeight: 400, color: "var(--ink-3)" }}> ({book.edition} ed.)</span> : null}
                          {book.part_label ? <span style={{ fontWeight: 400, color: "var(--ink-3)" }}> {book.part_label}</span> : null}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          <span style={{ fontFamily: "var(--font-mono)" }}>{book.accession_code}</span>
                          {book.author ? ` · ${book.author}` : ""}
                          {book.is_reference_only ? " · Reference only" : ""}
                        </div>
                      </td>
                      <td style={tdStyle}>{book.call_number || "-"}</td>
                      <td style={tdStyle}>
                        {book.category ? (
                          <>
                            <Dot color={colorVar(book.category.color_key)} />
                            {book.category.name}
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td style={tdStyle}>{[book.for_students && "Students", book.for_teachers && "Teachers", book.for_staff && "Staff"].filter(Boolean).join(", ")}</td>
                      <td style={tdStyle}>{AGE_BAND_LABELS[book.age_band]}</td>
                      <td style={tdStyle}>{book.cost_per_copy}</td>
                      <td style={tdStyle}>
                        {book.copies_available} of {book.copies_total}
                      </td>
                      <td style={tdStyle}>
                        <Pill tone={pill.tone}>{pill.label}</Pill>
                      </td>
                      <td style={{ ...tdStyle, textAlign: "right", whiteSpace: "nowrap" }}>
                        {can("library.books.update") ? (
                          <Btn small variant="ghost" onClick={() => setWizard({ bookId: book.id })}>
                            Edit
                          </Btn>
                        ) : null}
                        {can("library.book_copies.view") ? (
                          <Btn small variant="ghost" onClick={() => setCopiesFor(book)}>
                            Copies
                          </Btn>
                        ) : null}
                        {can("library.book_copies.view") ? (
                          <Btn small variant="ghost" onClick={() => setLabelsFor({ bookId: book.id })}>
                            Labels
                          </Btn>
                        ) : null}
                        {can("library.holds.create") && !book.is_reference_only ? (
                          <Btn small variant="ghost" onClick={() => setReserveFor(book)}>
                            Reserve
                          </Btn>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} style={{ padding: 28, textAlign: "center", color: "var(--ink-3)" }}>
                      {filtered ? (
                        <>
                          No titles match this filter. <Btn small variant="ghost" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>Clear filters</Btn>
                        </>
                      ) : (
                        "The catalogue is empty. Add the first title with New accession."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!error && count > 0 ? (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, fontSize: 13, color: "var(--ink-2)", flexWrap: "wrap" }}>
          <span>
            {count} title{count === 1 ? "" : "s"}
          </span>
          <Btn small disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
            Previous
          </Btn>
          <span>
            Page {page} of {pages}
          </span>
          <Btn small disabled={page >= pages || loading} onClick={() => setPage(page + 1)}>
            Next
          </Btn>
          <label>
            Per page{" "}
            <select aria-label="Page size" value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }} style={{ ...inputStyle, width: 70, height: 30, display: "inline-block" }}>
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {wizard ? (
        <AccessionWizard
          key={wizard.bookId ?? "new"}
          categories={categories}
          bookId={wizard.bookId}
          onClose={() => setWizard(null)}
          onSaved={refreshAll}
          onPrintLabels={(bookId) => {
            setWizard(null);
            setLabelsFor({ bookId });
          }}
        />
      ) : null}
      {showCategories ? <CategoriesModal categories={categories} can={can} onChanged={refreshAll} onClose={() => setShowCategories(false)} notify={show} /> : null}
      {showImport ? <BulkImportModal onClose={() => setShowImport(false)} onImported={refreshAll} /> : null}
      {showScanner ? <ScannerSetupPanel canLookup={can("library.book_copies.view")} onClose={() => setShowScanner(false)} /> : null}
      {copiesFor ? (
        <CopiesRegisterModal
          book={copiesFor}
          can={can}
          onClose={() => setCopiesFor(null)}
          onChanged={refreshAll}
          onPrintLabels={(bookId, copyId) => setLabelsFor({ bookId, copyId })}
          notify={show}
        />
      ) : null}
      {reserveFor ? <ReserveModal book={reserveFor} can={can} notify={show} onClose={() => setReserveFor(null)} /> : null}
      {labelsFor ? <LabelPrintView bookId={labelsFor.bookId} copyId={labelsFor.copyId} onClose={() => setLabelsFor(null)} /> : null}
      {toastNode}
    </Shell>
  );
}

function Shell({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 24px 40px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, color: "var(--ink-1)" }}>Catalogue</h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--ink-3)" }}>Titles, copies and accession codes</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>
      </div>
      {children}
    </div>
  );
}

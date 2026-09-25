"use client";

import { FormEvent, useEffect, useMemo, useState, useRef } from "react";
import { apiRequestWithRefresh } from "@/lib/api-auth";
import { ToastContainer, toast } from "react-toastify";
import s from "./VisitorBookPanel.module.css";
import { validateMeaningfulText } from "@/lib/meaningfulText";

type Tab = "add" | "filter" | "list";

// --- Icons ---
const ChevronIcon = ({open}:{open:boolean}) => (
  <svg className={`${s.chevron} ${open?s.chevronOpen:""}`} width="14" height="14" viewBox="0 0 14 14" fill="none">
    <path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
);
const CheckIcon = () => (<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.2 7.5L8 3" stroke="white" strokeWidth="1.6" strokeLinecap="round"/></svg>);
const PencilIcon = ({size=13}:{size?:number}) => (<svg width={size} height={size} viewBox="0 0 14 14" fill="none"><path d="M9.5 2.5L11.5 4.5L5 11H3V9L9.5 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>);
const FunnelIcon = () => (<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12l-4.5 5V14L6.5 13V8L2 3Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/></svg>);
const DocIcon = () => (<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="8" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M4.5 5H8M4.5 7.5H7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M9 4l2 2-2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>);
const PlusIcon = () => (<svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 2v9M2 6.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>);
const TrashIcon = () => (<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M5 3V2h2v1M4 3l.5 7h3L8 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>);
const LinkIcon = () => (<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6.5 3.5a2 2 0 112.83 2.83l-1.5 1.5a2 2 0 01-2.83 0m-2.83 2.83a2 2 0 11-2.83-2.83l1.5-1.5a2 2 0 012.83 0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>);

type ApiList<T> = T[] | { results?: T[]; count?: number; next?: string | null; previous?: string | null };

type AdminSetupRow = { id: number; type: "1" | "2" | "3" | "4"; name: string };
type SelectOption = { value: string; label: string };

type ComplaintRow = {
  id: number;
  complaint_by: string;
  complaint_type: number;
  complaint_source: number;
  complaint_type_name?: string;
  complaint_source_name?: string;
  phone?: string;
  date?: string;
  action_taken?: string;
  assigned_to?: number | null;
  assigned_to_name?: string;
  description?: string;
  file_url?: string;
};

type SortKey = "complaint_by" | "phone" | "date" | "complaint_type" | "complaint_source";
type SortDir = "asc" | "desc";

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message !== "[object Object]") return message;
  }
  return fallback;
}

function listData<T>(value: ApiList<T>): T[] {
  return Array.isArray(value) ? value : value.results || [];
}

function getTotalCount<T>(value: ApiList<T>): number {
  if (Array.isArray(value)) return value.length;
  if (typeof value.count === "number") return value.count;
  return (value.results || []).length;
}

async function apiGet<T>(path: string): Promise<T> {
  return apiRequestWithRefresh<T>(path, { headers: { "Content-Type": "application/json" } });
}

async function apiForm<T>(path: string, method: "POST" | "PATCH", formData: FormData): Promise<T> {
  return apiRequestWithRefresh<T>(path, { method, body: formData });
}

async function apiDelete(path: string): Promise<void> {
  await apiRequestWithRefresh<void>(path, { method: "DELETE", headers: { "Content-Type": "application/json" } });
}

function displayValue(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text || text === "-") return <span style={{ color: "#94a3b8", fontStyle: "italic" }}>N/A</span>;
  return text;
}

function sanitizePlain(value: string) {
  return value.replace(/[<>&"']/g, "");
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "").replace(/[<>]/g, "");
}

export function ComplaintPanel() {
  const [items, setItems] = useState<ComplaintRow[]>([]);
  const [typeOptions, setTypeOptions] = useState<SelectOption[]>([]);
  const [sourceOptions, setSourceOptions] = useState<SelectOption[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formBanner, setFormBanner] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  // Form Fields
  const [complaintBy, setComplaintBy] = useState("");
  const [complaintType, setComplaintType] = useState("");
  const [complaintSource, setComplaintSource] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState("");
  const [actionTaken, setActionTaken] = useState("");
  const [assigned, setAssigned] = useState("");
  const [description, setDescription] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [fileUpload, setFileUpload] = useState<File | null>(null);

  // Filters
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterSource, setFilterSource] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterChips, setFilterChips] = useState<string[]>([]);

  // Table
  const [tableBusy, setTableBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [deleteTarget, setDeleteTarget] = useState<ComplaintRow | null>(null);

  // Nav Tabs
  const [activeTab, setActiveTab] = useState<Tab>("add");
  const [filterOpen, setFilterOpen] = useState(false);
  const addSecRef = useRef<HTMLDivElement | null>(null);
  const filterSecRef = useRef<HTMLDivElement | null>(null);
  const listSecRef = useRef<HTMLDivElement | null>(null);

  // Field Refs for scrollToFirstError
  const complaintByRef = useRef<HTMLInputElement | null>(null);
  const complaintTypeRef = useRef<HTMLSelectElement | null>(null);
  const complaintSourceRef = useRef<HTMLSelectElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const actionTakenRef = useRef<HTMLInputElement | null>(null);
  const assignedRef = useRef<HTMLInputElement | null>(null);
  const descriptionRef = useRef<HTMLInputElement | null>(null);
  const attachmentRef = useRef<HTMLInputElement | null>(null);

  const scrollToTab = (id: Tab) => {
    const el = id === "add" ? addSecRef.current : id === "filter" ? filterSecRef.current : listSecRef.current;
    if (el) {
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  };

  const scrollToFirstError = (errors: Record<string, string>) => {
    const fieldRefMap: Record<string, React.RefObject<any>> = {
      complaintBy: complaintByRef,
      complaintType: complaintTypeRef,
      complaintSource: complaintSourceRef,
      phone: phoneRef,
      date: dateRef,
      actionTaken: actionTakenRef,
      description: descriptionRef,
      attachment: attachmentRef,
    };

    const fieldOrder = ["complaintBy", "complaintType", "complaintSource", "phone", "date", "actionTaken", "description", "attachment"];
    
    for (const field of fieldOrder) {
      if (errors[field] && fieldRefMap[field]?.current) {
        fieldRefMap[field].current?.focus();
        fieldRefMap[field].current?.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      }
    }
  };

  const todayDate = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [complaintData, typeData, sourceData] = await Promise.all([
        apiGet<ApiList<ComplaintRow>>(`/api/v1/admissions/complaints/`),
        apiGet<ApiList<{ id: number; name: string }>>("/api/v1/admissions/complaint-types/"),
        apiGet<ApiList<{ id: number; name: string }>>("/api/v1/admissions/complaint-sources/"),
      ]);
      const rows = listData(complaintData);
      const count = getTotalCount(complaintData);
      setItems(rows);
      setTotalRecords(count);
      setTotalPages(Math.max(1, Math.ceil(count / pageSize)));
      
      const types = listData(typeData);
      const sources = listData(sourceData);
      setTypeOptions(types.map((row) => ({ value: String(row.id), label: String(row.name || "").trim() })));
      setSourceOptions(sources.map((row) => ({ value: String(row.id), label: String(row.name || "").trim() })));
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Unable to load complaints.");
      setError(message);
      toast.error(message, { autoClose: 5000 });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setDate(todayDate);
  }, [todayDate]);

  useEffect(() => {
    void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    if (!formBanner) return;
    const timer = window.setTimeout(() => setFormBanner(""), 5000);
    return () => window.clearTimeout(timer);
  }, [formBanner]);

  useEffect(() => {
    if (loading) {
      setTableBusy(true);
      return;
    }
    setTableBusy(true);
    const timer = window.setTimeout(() => setTableBusy(false), 250);
    return () => window.clearTimeout(timer);
  }, [loading, search, items, sortKey, sortDir, page, pageSize, filterType, filterSource, filterDate]);

  const resetForm = () => {
    setEditingId(null);
    setComplaintBy("");
    setComplaintType("");
    setComplaintSource("");
    setPhone("");
    setDate(todayDate);
    setActionTaken("");
    setAssigned("");
    setDescription("");
    setFileUrl("");
    setFileUpload(null);
    setFieldErrors({});
    setFormBanner("");
  };

  const editRow = (row: ComplaintRow) => {
    const matchedType = typeOptions.find((option) => option.value === String(row.complaint_type));
    const matchedSource = sourceOptions.find((option) => option.value === String(row.complaint_source));
    setEditingId(row.id);
    setComplaintBy(sanitizePlain(row.complaint_by || ""));
    setComplaintType(matchedType?.value || "");
    setComplaintSource(matchedSource?.value || "");
    setPhone((row.phone || "").replace(/\D/g, "").slice(0, 10));
    setDate(row.date || todayDate);
    setActionTaken(stripHtml(row.action_taken || ""));
    setAssigned(stripHtml(row.assigned_to ? String(row.assigned_to) : ""));
    setDescription(stripHtml(row.description || ""));
    setFileUrl(row.file_url || "");
    setFieldErrors({});
    setFormBanner("");
    setActiveTab("add");
    scrollToTab("add");
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  const validateMeaningfulField = (value: string, field: string) => {
    if (!value.trim()) return "";
    const check = validateMeaningfulText(value, field);
    return check.valid ? "" : (check.error || "Please enter meaningful text.");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    
    if (!complaintBy.trim()) nextErrors.complaintBy = "Complaint By is required.";
    else if (complaintBy.trim().length < 2) nextErrors.complaintBy = "Minimum 2 characters required.";
    else if (!/^[A-Za-z\s\-']+$/.test(complaintBy.trim())) nextErrors.complaintBy = "Only letters, spaces, hyphens, apostrophes allowed.";
    else {
      const check = validateMeaningfulText(complaintBy, "Complaint By");
      if (!check.valid) nextErrors.complaintBy = "Only letters, spaces, hyphens, apostrophes allowed.";
    }

    if (!complaintType) nextErrors.complaintType = "Please select a complaint type.";
    if (!complaintSource) nextErrors.complaintSource = "Please select a complaint source.";
    
    if (phone.trim() && !/^[6-9]\d{9}$/.test(phone)) nextErrors.phone = "Please enter a valid 10-digit mobile number.";

    if (!date) nextErrors.date = "Please select a date.";
    else if (date > todayDate) nextErrors.date = "Date cannot be in the future.";

    if (actionTaken.trim() && !validateMeaningfulText(actionTaken, "Action Taken").valid) nextErrors.actionTaken = "Please enter meaningful text.";
    
    if (description.trim() && description.trim().length < 10) nextErrors.description = "Description must be at least 10 characters.";
    else if (description.trim() && !validateMeaningfulText(description, "Description").valid) nextErrors.description = "Please enter meaningful text.";

    if (fileUpload) {
      const fileName = fileUpload.name.toLowerCase();
      const allowed = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"];
      const ext = "." + (fileName.includes(".") ? fileName.split(".").pop() : "");
      if (!allowed.includes(ext)) nextErrors.attachment = "Invalid file type. Allowed: PDF, DOC, JPG, PNG.";
      else if (fileUpload.size > 5 * 1024 * 1024) nextErrors.attachment = "File size exceeds 5MB limit.";
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setFormBanner("Please fix the errors below before submitting.");
      setError("Please fix the errors below before submitting.");
      scrollToFirstError(nextErrors);
      return;
    }

    const payload: any = {
      complaint_by: complaintBy.trim() || "",
      complaint_type: complaintType ? parseInt(String(complaintType)) : null,
      complaint_source: complaintSource ? parseInt(String(complaintSource)) : null,
      phone: phone.trim() || "",
      date: date || "",
      action_taken: actionTaken.trim() || "",
      description: description.trim() || "",
    };

    try {
      setSaving(true);
      setError("");
      setSuccess("");
      setFieldErrors({});
      setFormBanner("");
      
      let response;
      if (fileUpload) {
        // Use FormData only when there's a file upload
        const formData = new FormData();
        formData.append("complaint_by", payload.complaint_by);
        if (payload.complaint_type !== null) formData.append("complaint_type", String(payload.complaint_type));
        if (payload.complaint_source !== null) formData.append("complaint_source", String(payload.complaint_source));
        formData.append("phone", payload.phone);
        if (payload.date) formData.append("date", payload.date);
        formData.append("action_taken", payload.action_taken);
        formData.append("description", payload.description);
        formData.append("file_upload", fileUpload);
        
        if (editingId) {
          response = await apiRequestWithRefresh(`/api/v1/admissions/complaints/${editingId}/`, { method: "PATCH", body: formData });
        } else {
          response = await apiRequestWithRefresh("/api/v1/admissions/complaints/", { method: "POST", body: formData });
        }
      } else {
        // Use JSON when no file upload - don't pass headers, apiRequestWithRefresh handles it
        const jsonBody = JSON.stringify(payload);

        if (editingId) {
          response = await apiRequestWithRefresh(`/api/v1/admissions/complaints/${editingId}/`, { method: "PATCH", body: jsonBody });
        } else {
          response = await apiRequestWithRefresh("/api/v1/admissions/complaints/", { method: "POST", body: jsonBody });
        }
      }
      
      setSuccess("Record created successfully.");
      toast.success("Record created successfully.", { autoClose: 4000 });
      resetForm();
      await load();
      setActiveTab("list");
      scrollToTab("list");
    } catch (err: unknown) {
      // Handle API response errors with field_errors
      if (err instanceof Error) {
        try {
          const response = JSON.parse(err.message);
          if (response.field_errors && typeof response.field_errors === 'object') {
            setFieldErrors(response.field_errors);
            setFormBanner("Please fix the validation errors below.");
            scrollToFirstError(response.field_errors);
          } else {
            const message = response.message || err.message;
            setError(message);
            toast.error(message, { autoClose: 6000 });
          }
        } catch {
          const message = getErrorMessage(err, editingId ? "Unable to update complaint." : "Unable to add complaint.");
          setError(message);
          toast.error(message, { autoClose: 6000 });
        }
      } else {
        const message = getErrorMessage(err, editingId ? "Unable to update complaint." : "Unable to add complaint.");
        setError(message);
        toast.error(message, { autoClose: 6000 });
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      setBusyId(id);
      setError("");
      setSuccess("");
      await apiDelete(`/api/v1/admissions/complaints/${id}/`);
      setSuccess("Record deleted successfully.");
      toast.success("Record deleted successfully.", { autoClose: 4000 });
      await load();
    } catch (err: unknown) {
      const message = getErrorMessage(err, "Unable to delete complaint record.");
      setError(message);
      toast.error(message, { autoClose: 6000 });
    } finally {
      setBusyId(null);
    }
  };

  const applyFilters = () => {
    const chips: string[] = [];
    if (search.trim()) chips.push(`Search: ${search}`);
    if (filterType) {
      const tLabel = typeOptions.find(o => o.value === filterType)?.label || filterType;
      chips.push(`Type: ${tLabel}`);
    }
    if (filterSource) {
      const sLabel = sourceOptions.find(o => o.value === filterSource)?.label || filterSource;
      chips.push(`Source: ${sLabel}`);
    }
    if (filterDate) chips.push(`Date: ${filterDate}`);
    setFilterChips(chips);
    setFilterOpen(false);
  };

  const clearFilters = () => {
    setSearch("");
    setFilterType("");
    setFilterSource("");
    setFilterDate("");
    setFilterChips([]);
  };

  const filteredSorted = useMemo(() => {
    let next = [...items];
    const q = search.trim().toLowerCase();
    if (q) {
      next = next.filter((row) => [row.complaint_by, row.phone || "", row.complaint_type, row.complaint_source].join(" ").toLowerCase().includes(q));
    }
    if (filterType) {
      next = next.filter(row => String(row.complaint_type) === filterType);
    }
    if (filterSource) {
      next = next.filter(row => String(row.complaint_source) === filterSource);
    }
    if (filterDate) {
      next = next.filter(row => row.date === filterDate);
    }

    next.sort((a, b) => {
      const mult = sortDir === "asc" ? 1 : -1;
      if (sortKey === "complaint_by") return String(a.complaint_by || "").localeCompare(String(b.complaint_by || "")) * mult;
      if (sortKey === "phone") return String(a.phone || "").localeCompare(String(b.phone || "")) * mult;
      if (sortKey === "date") return String(a.date || "").localeCompare(String(b.date || "")) * mult;
      if (sortKey === "complaint_type") return String(a.complaint_type || "").localeCompare(String(b.complaint_type || "")) * mult;
      return String(a.complaint_source || "").localeCompare(String(b.complaint_source || "")) * mult;
    });
    return next;
  }, [items, search, sortKey, sortDir, filterType, filterSource, filterDate, typeOptions, sourceOptions]);

  const safePage = Math.min(page, totalPages);
  const pageStart = (safePage - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const pageRows = filteredSorted.slice(pageStart, pageEnd);

  return (
    <div className={s.root} style={{ padding: "16px 24px" }}>
      <ToastContainer position="top-right" newestOnTop closeOnClick pauseOnHover />
      
      <div className={s.pageCard}>
        <div className={s.pageBody} style={{ padding: "20px" }}>
          
          {/* Action Nav */}
          <div className={s.actionNav}>
            {[
              { id: "add" as Tab, step: "01", label: editingId ? "Edit Complaint" : "Add Complaint", icon: <PlusIcon /> },
              { id: "filter" as Tab, step: "02", label: "Smart Filter", icon: <FunnelIcon /> },
              { id: "list" as Tab, step: "03", label: "Complaints List", icon: <DocIcon /> }
            ].map(t => (
              <button key={t.id} type="button" className={`${s.navTab} ${activeTab === t.id ? s.navTabActive : ""}`}
                onClick={() => { setActiveTab(t.id); if (t.id === "filter") setFilterOpen(true); scrollToTab(t.id); }}>
                <span className={s.navTabStep}>{t.step}</span>{t.icon} {t.label}
              </button>
            ))}
          </div>

          {/* Section 01: Add/Edit Complaint */}
          <div className={s.assignCard} ref={addSecRef}>
            <div className={s.assignCardTop}>
              <div>
                <div className={s.assignCardTitle}>{editingId ? "Edit Complaint Details" : "Register New Complaint"}</div>
                <div className={s.assignCardSub}>Fields marked with * are mandatory. Please provide accurate details for resolution tracking.</div>
              </div>
              {editingId && <span className={s.enrollChip}><LinkIcon/> Editing Complaint By: {complaintBy}</span>}
            </div>
            
            {formBanner && (
              <div style={{ background: "#fff5f5", border: "1px solid #ffd0cc", color: "var(--red)", padding: "10px 14px", borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600 }}>
                {formBanner}
              </div>
            )}

            <form onSubmit={submit}>
              <div className={s.roGrid} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px 16px" }}>
                
                <div className={s.roField}>
                  <label>Complaint By *</label>
                  <input ref={complaintByRef} type="text" required minLength={2} maxLength={100} value={complaintBy} onChange={(e) => { 
                    const val = e.target.value; 
                    setComplaintBy(val); 
                    const result = validateMeaningfulText(val, "Complaint By");
                    if (!result.valid && val.trim()) {
                      setFieldErrors(p => ({ ...p, complaintBy: result.error || "" }));
                    } else {
                      setFieldErrors(p => ({ ...p, complaintBy: "" }));
                    }
                  }} className={fieldErrors.complaintBy ? s.roInputError : s.roInput} placeholder="e.g. Parent of Rahul" />
                  {fieldErrors.complaintBy && <span className={s.fieldError}>{fieldErrors.complaintBy}</span>}
                </div>
                
                <div className={s.roField}>
                  <label>Complaint Type *</label>
                  <select ref={complaintTypeRef} required value={complaintType} onChange={(e) => { setComplaintType(e.target.value); if (fieldErrors.complaintType) setFieldErrors(p => ({ ...p, complaintType: "" })); }} className={fieldErrors.complaintType ? s.roInputError : s.roInput}>
                    <option value="" disabled hidden>Select Type</option>
                    {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  {fieldErrors.complaintType && <span className={s.fieldError}>{fieldErrors.complaintType}</span>}
                </div>

                <div className={s.roField}>
                  <label>Complaint Source *</label>
                  <select ref={complaintSourceRef} required value={complaintSource} onChange={(e) => { setComplaintSource(e.target.value); if (fieldErrors.complaintSource) setFieldErrors(p => ({ ...p, complaintSource: "" })); }} className={fieldErrors.complaintSource ? s.roInputError : s.roInput}>
                    <option value="" disabled hidden>Select Source</option>
                    {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  {fieldErrors.complaintSource && <span className={s.fieldError}>{fieldErrors.complaintSource}</span>}
                </div>

                <div className={s.roField}>
                  <label>Phone No.</label>
                  <input ref={phoneRef} type="tel" inputMode="numeric" maxLength={10} value={phone} onChange={(e) => { setPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); if (fieldErrors.phone) setFieldErrors(p => ({ ...p, phone: "" })); }} className={fieldErrors.phone ? s.roInputError : s.roInput} placeholder="e.g. 9876543210" />
                  {fieldErrors.phone && <span className={s.fieldError}>{fieldErrors.phone}</span>}
                </div>
                
                <div className={s.roField}>
                  <label>Date *</label>
                  <input ref={dateRef} type="date" required max={todayDate} value={date} onChange={(e) => { setDate(e.target.value); if (fieldErrors.date) setFieldErrors(p => ({ ...p, date: "" })); }} className={fieldErrors.date ? s.roInputError : s.roInput} />
                  {fieldErrors.date && <span className={s.fieldError}>{fieldErrors.date}</span>}
                </div>
                
                <div className={s.roField}>
                  <label>Assigned To</label>
                  <input ref={assignedRef} type="text" maxLength={100} value={assigned} onChange={(e) => { setAssigned(e.target.value); if (fieldErrors.assignedTo) setFieldErrors(p => ({ ...p, assignedTo: "" })); }} className={fieldErrors.assignedTo ? s.roInputError : s.roInput} placeholder="e.g. Mr. Sharma" />
                  {fieldErrors.assignedTo && <span className={s.fieldError}>{fieldErrors.assignedTo}</span>}
                </div>

                <div className={s.roField} style={{ gridColumn: "1 / -1" }}>
                  <label>Action Taken</label>
                  <input ref={actionTakenRef} type="text" maxLength={500} value={actionTaken} onChange={(e) => { 
                    const val = e.target.value; 
                    setActionTaken(val); 
                    const result = validateMeaningfulText(val, "Action Taken");
                    if (!result.valid && val.trim()) {
                      setFieldErrors(p => ({ ...p, actionTaken: result.error || "" }));
                    } else {
                      setFieldErrors(p => ({ ...p, actionTaken: "" }));
                    }
                  }} className={fieldErrors.actionTaken ? s.roInputError : s.roInput} placeholder="e.g. Called parent for discussion" />
                  {fieldErrors.actionTaken && <span className={s.fieldError}>{fieldErrors.actionTaken}</span>}
                </div>

                <div className={s.roField} style={{ gridColumn: "1 / -1" }}>
                  <label>Description</label>
                  <input ref={descriptionRef} type="text" maxLength={2000} value={description} onChange={(e) => { 
                    const val = e.target.value; 
                    setDescription(val); 
                    const result = validateMeaningfulText(val, "Description");
                    if (!result.valid && val.trim()) {
                      setFieldErrors(p => ({ ...p, description: result.error || "" }));
                    } else {
                      setFieldErrors(p => ({ ...p, description: "" }));
                    }
                  }} className={fieldErrors.description ? s.roInputError : s.roInput} placeholder="e.g. Parent reported broken fence near playground" />
                  {fieldErrors.description && <span className={s.fieldError}>{fieldErrors.description}</span>}
                </div>

                <div className={s.roField}>
                  <label>Attachment</label>
                  <input ref={attachmentRef} type="file" accept=".jpg,.jpeg,.png,.pdf,.doc,.docx" onChange={(e) => { setFileUpload(e.target.files?.[0] ?? null); if (fieldErrors.attachment) setFieldErrors(p => ({ ...p, attachment: "" })); }} className={fieldErrors.attachment ? s.roInputError : s.roInput} style={{ padding: "4px 8px" }} />
                  {fieldErrors.attachment && <span className={s.fieldError}>{fieldErrors.attachment}</span>}
                </div>
                
              </div>

              <hr className={s.previewDivider} style={{ marginTop: 20 }} />
              <div className={s.saveRow}>
                <div>
                  <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>All records are securely saved into the complaint tracking module.</span>
                </div>
                <div className={s.saveButtons}>
                  <button type="button" className={s.btnReset} onClick={resetForm}>{editingId ? "Cancel" : "Reset"}</button>
                  <button type="submit" disabled={saving} className={s.btnSave} style={{ minWidth: 140, justifyContent: "center" }}>
                    <CheckIcon /> {saving ? "Saving..." : editingId ? "Update Complaint" : "Save Complaint"}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Section 02 Smart Filter */}
          <div className={s.filterCard} ref={filterSecRef}>
            <div className={`${s.filterTrigger} ${filterOpen ? s.filterTriggerOpen : ""}`} onClick={() => setFilterOpen(v => !v)}>
              <span className={s.stepBadge}>02</span>
              <span className={s.filterIconBox}><FunnelIcon /></span>
              <div>
                <div className={s.filterTitle}>Smart filters</div>
                <div className={s.filterSub}>Find complaints easily by search, type, source, or date.</div>
              </div>
              <div className={s.triggerRight}>
                {filterChips.map(c => (
                  <span key={c} className={s.darkChip}>{c} <span className={s.darkChipX} onClick={(e) => { e.stopPropagation(); setFilterChips(fc => fc.filter(x => x !== c)); }}>&#215;</span></span>
                ))}
                {filterChips.length > 0 && (
                  <button type="button" className={s.btnGhost} style={{ fontSize: 11, padding: "4px 8px" }} onClick={(e) => { e.stopPropagation(); clearFilters(); }}>Clear</button>
                )}
                <ChevronIcon open={filterOpen} />
              </div>
            </div>
            {filterOpen && (
              <div className={s.filterBody}>
                <div className={s.filterGrid8} style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
                  <label className={s.fLbl}>
                    <span>Search</span>
                    <input className={s.filterInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Phone..." />
                  </label>
                  <label className={s.fLbl}>
                    <span>Complaint Type</span>
                    <select className={s.filterInput} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                      <option value="">All Types</option>
                      {typeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className={s.fLbl}>
                    <span>Complaint Source</span>
                    <select className={s.filterInput} value={filterSource} onChange={(e) => setFilterSource(e.target.value)}>
                      <option value="">All Sources</option>
                      {sourceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label className={s.fLbl}>
                    <span>Date</span>
                    <input type="date" className={s.filterInput} value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
                  </label>
                </div>
                <div className={s.filterBottom}>
                  <div style={{ display: "flex", gap: 6 }}>
                    {filterChips.map(c => <span key={c} className={s.darkChip}>{c} <span className={s.darkChipX} onClick={() => setFilterChips(fc => fc.filter(x => x !== c))}>&#215;</span></span>)}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className={s.btnGhost} onClick={clearFilters}>Clear filters</button>
                    <button type="button" className={s.btnPrimary} onClick={applyFilters}>Apply Filters</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Section 03 Browse */}
          <div className={s.browseSection} ref={listSecRef}>
            <div className={s.sectionHeading}>
              <span className={s.stepBadge}>03</span>
              <span className={s.sectionTitle}>Browse Complaints</span>
              <span className={s.sectionSub}>&mdash; view, edit, or delete existing records.</span>
            </div>

            <div style={{ background: "#fff", border: "1px solid var(--line)", borderRadius: "12px", overflow: "hidden" }}>
              <div className={s.tblWrap}>
                <div className={s.tblHead} style={{ gridTemplateColumns: "40px 1.5fr 1fr 1.5fr 1.5fr 1fr 100px", background: "#f8f8fc" }}>
                  <span>SL</span>
                  <span onClick={() => toggleSort("complaint_by")} style={{ cursor: "pointer" }}>Complaint By {sortKey === "complaint_by" ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                  <span>Phone</span>
                  <span onClick={() => toggleSort("complaint_type")} style={{ cursor: "pointer" }}>Type {sortKey === "complaint_type" ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                  <span onClick={() => toggleSort("complaint_source")} style={{ cursor: "pointer" }}>Source {sortKey === "complaint_source" ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                  <span onClick={() => toggleSort("date")} style={{ cursor: "pointer" }}>Date {sortKey === "date" ? (sortDir === "asc" ? "↑" : "↓") : ""}</span>
                  <span style={{ textAlign: "right" }}>Actions</span>
                </div>
                
                {!loading && filteredSorted.length === 0 && (
                  <div style={{ padding: "32px", textAlign: "center", color: "var(--ink-mute)", fontSize: 13 }}>No complaints found matching criteria.</div>
                )}

                {pageRows.map((row, index) => (
                  <div key={row.id} className={s.tblRow} style={{ gridTemplateColumns: "40px 1.5fr 1fr 1.5fr 1.5fr 1fr 100px" }}>
                    <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>{(page - 1) * pageSize + index + 1}</span>
                    <div className={s.studentCell}>
                      <span className={s.studentName}>{row.complaint_by}</span>
                    </div>
                    <span className={s.admNo}>{displayValue(row.phone)}</span>
                    <span className={s.admNo}>{displayValue(row.complaint_type_name)}</span>
                    <span className={s.admNo}>{displayValue(row.complaint_source_name)}</span>
                    <span className={s.admNo}>{row.date}</span>
                    <div className={s.tblLastCol}>
                      <button type="button" className={s.editBtn} onClick={() => editRow(row)} title="Edit"><PencilIcon /></button>
                      <button type="button" className={s.editBtn} onClick={() => setDeleteTarget(row)} title="Delete" style={{ color: "var(--red)", borderColor: "rgba(229, 83, 75, 0.2)" }}><TrashIcon /></button>
                    </div>
                  </div>
                ))}
                
                <div className={s.tblFooter}>
                  <span className={s.tblFooterTxt}>
                    Showing page {page} of {totalPages} ({totalRecords} total records)
                  </span>
                  
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "var(--ink-mute)" }}>Page size:</span>
                      <select value={pageSize} onChange={(e) => { setPage(1); setPageSize(Number(e.target.value)); }} style={{ padding: "4px 8px", fontSize: 11, borderRadius: 6, border: "1px solid var(--line)", background: "#fff", outline: "none" }}>
                        {[5, 10, 20, 30, 40, 50].map(sz => <option key={sz} value={sz}>{sz}</option>)}
                      </select>
                    </div>
                    <div className={s.pager}>
                      <button type="button" className={s.pagerBtn} disabled={loading || page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</button>
                      <button type="button" className={s.pagerBtn} disabled={loading || page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>›</button>
                    </div>
                  </div>
                </div>
              </div>
              {tableBusy && <div style={{ height: 3, background: "var(--primary)", width: "100%", animation: "pulse 1s infinite" }} />}
            </div>
          </div>
          
        </div>
      </div>
      
      {deleteTarget && (
        <div className={s.backdrop} onClick={() => setDeleteTarget(null)}>
          <div className={s.modal} style={{ maxWidth: 400, padding: 24, textAlign: "center" }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 48, height: 48, background: "#fff5f5", borderRadius: "50%", color: "var(--red)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <TrashIcon />
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, color: "var(--ink)" }}>Confirm Delete</h3>
            <p style={{ margin: "0 0 24px", color: "var(--ink-mute)", fontSize: 13 }}>Are you sure you want to delete this complaint record? This action cannot be undone.</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button type="button" className={s.btnReset} style={{ flex: 1 }} onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className={s.btnSave} style={{ flex: 1, background: "var(--red)", justifyContent: "center", boxShadow: "none" }} onClick={async () => { const id = deleteTarget.id; setDeleteTarget(null); await remove(id); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

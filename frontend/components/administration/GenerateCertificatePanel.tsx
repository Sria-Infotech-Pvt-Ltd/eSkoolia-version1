"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequestWithRefresh } from "@/lib/api-auth";

type Paginated<T> = { count?: number; next?: string | null; previous?: string | null; results?: T[] };
type ApiList<T> = T[] | Paginated<T>;

type RoleOption = { id: number; name: string };
type ClassRow = { id: number; name?: string; class_name?: string };
type SectionRow = { id: number; school_class: number; name?: string; section_name?: string };
type CertificateTemplate = {
  id: number;
  title: string;
  type: "School" | "Lms";
  applicable_role_id?: number | null;
  body: string;
  background_height?: string | number;
  background_width?: string | number;
  padding_top?: string | number;
  padding_right?: string | number;
  padding_bottom?: string | number;
  pading_left?: string | number;
  background_url?: string;
};
type StudentRow = {
  id: number;
  admission_no?: string;
  roll_no?: string;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  gender?: string;
  current_class?: number | null;
  current_section?: number | null;
};
type UserRoleRow = {
  id: number;
  user: number;
  role: number;
  user_name?: string;
  role_name?: string;
};

type Recipient = {
  id: number;
  label: string;
  admission_no?: string;
  roll_no?: string;
  className?: string;
  sectionName?: string;
  gender?: string;
  dateOfBirth?: string | null;
};

function fieldStyle() {
  return {
    width: "100%",
    height: 36,
    border: "1px solid var(--line)",
    borderRadius: 8,
    padding: "0 10px",
  } as const;
}

function buttonStyle(color = "var(--primary)") {
  return {
    height: 36,
    border: `1px solid ${color}`,
    background: color,
    color: "#fff",
    borderRadius: 8,
    padding: "0 12px",
    cursor: "pointer",
    fontSize: 13,
  } as const;
}

function boxStyle() {
  return {
    background: "var(--surface)",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius)",
    padding: 16,
  } as const;
}

function listData<T>(value: ApiList<T>): T[] {
  return Array.isArray(value) ? value : value.results || [];
}

function toText(value: unknown) {
  return value == null ? "" : String(value);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function mm(value: string | number | null | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function replacePlaceholders(body: string, recipient: Recipient) {
  const values: Record<string, string> = {
    student_name: recipient.label,
    name: recipient.label,
    class: recipient.className || "",
    admission_no: recipient.admission_no || "",
    roll_no: recipient.roll_no || "",
    class_name: recipient.className || "",
    section_name: recipient.sectionName || "",
    school_name: (recipient as Recipient & { school_name?: string }).school_name || "",
    course_name: (recipient as Recipient & { course_name?: string }).course_name || "",
    course_program_name: (recipient as Recipient & { course_program_name?: string }).course_program_name || "",
    gender: recipient.gender || "",
    date_of_birth: recipient.dateOfBirth || "",
    date: new Date().toISOString().slice(0, 10),
    today: new Date().toISOString().slice(0, 10),
  };

  // Remove markdown emphasis markers users often paste from docs.
  let out = body.replace(/\*\*/g, "");

  // Replace common placeholder styles: [student_name], [Student Name], [Course/Program Name], {{ student_name }}.
  const aliases: Array<[string, string[]]> = [
    ["student_name", ["student_name", "student name", "student"]],
    ["name", ["name"]],
    ["class", ["class", "class_name", "class name"]],
    ["admission_no", ["admission_no", "admission no", "admission number"]],
    ["roll_no", ["roll_no", "roll no", "roll number"]],
    ["section_name", ["section_name", "section name", "section"]],
    ["school_name", ["school_name", "school name"]],
    ["course_name", ["course_name", "course name"]],
    ["course_program_name", ["course_program_name", "course/program name", "course program name"]],
    ["gender", ["gender"]],
    ["date_of_birth", ["date_of_birth", "date of birth", "dob"]],
    ["date", ["date", "today"]],
  ];

  aliases.forEach(([key, patterns]) => {
    const value = values[key] || "";
    patterns.forEach((pattern) => {
      const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
      const brace = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "gi");
      const bracket = new RegExp(`\\[\\s*${escaped}\\s*\\]`, "gi");
      out = out.replace(brace, value).replace(bracket, value);
    });
  });

  // Normalize excess spacing after replacements.
  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

async function apiGet<T>(path: string): Promise<T> {
  return apiRequestWithRefresh<T>(path, { headers: { "Content-Type": "application/json" } });
}

type GenerateSetupResponse = {
  roles: RoleOption[];
  classes: ClassRow[];
  sections: SectionRow[];
  templates: CertificateTemplate[];
};

type RecipientsResponse = {
  is_student_role: boolean;
  recipients?: Recipient[];
  results?: Recipient[];
  count?: number;
  next?: string | null;
  previous?: string | null;
};

export function GenerateCertificatePanel() {
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [templates, setTemplates] = useState<CertificateTemplate[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [sections, setSections] = useState<SectionRow[]>([]);

  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [recipientPage, setRecipientPage] = useState(1);
  const [recipientPageSize, setRecipientPageSize] = useState(10);
  const [recipientTotal, setRecipientTotal] = useState(0);

  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [roleId, setRoleId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [gridGap, setGridGap] = useState("14");
  const [roleError, setRoleError] = useState(false);
  const [templateError, setTemplateError] = useState(false);
  const [gridGapError, setGridGapError] = useState(false);

  const selectedRole = useMemo(() => roles.find((r) => String(r.id) === roleId) || null, [roles, roleId]);
  const selectedTemplate = useMemo(() => templates.find((t) => String(t.id) === templateId) || null, [templates, templateId]);

  const isStudentRole = useMemo(() => {
    if (!selectedRole) return false;
    return String(selectedRole.id) === "2" || selectedRole.name.toLowerCase().includes("student");
  }, [selectedRole]);

  const classNameById = useMemo(() => {
    return new Map(classes.map((c) => [c.id, c.class_name || c.name || `Class ${c.id}`]));
  }, [classes]);

  const sectionNameById = useMemo(() => {
    return new Map(sections.map((s) => [s.id, s.section_name || s.name || `Section ${s.id}`]));
  }, [sections]);

  const availableTemplates = useMemo(() => {
    if (!roleId) return templates;
    const rid = Number(roleId);
    const matched = templates.filter((t) => !t.applicable_role_id || t.applicable_role_id === rid);
    return matched.length > 0 ? matched : templates;
  }, [templates, roleId]);

  const filteredSections = useMemo(() => {
    if (!classId) return sections;
    return sections.filter((s) => String(s.school_class) === classId);
  }, [sections, classId]);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError("");
        const data = await apiGet<GenerateSetupResponse>("/api/v1/admissions/certificate-templates/generate-setup/");
        setRoles(data.roles || []);
        setTemplates(data.templates || []);
        setClasses(data.classes || []);
        setSections(data.sections || []);
      } catch {
        setError("Unable to load generate certificate data.");
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, []);

  useEffect(() => {
    setTemplateId("");
  }, [roleId]);

  useEffect(() => {
    if (isStudentRole) return;
    setClassId("");
    setSectionId("");
  }, [isStudentRole]);

  useEffect(() => {
    setSectionId("");
  }, [classId]);

  const loadRecipients = async (targetPage = recipientPage, targetPageSize = recipientPageSize) => {
    if (!roleId) {
      setError("Select a role first.");
      return;
    }

    try {
      setSearching(true);
      setError("");
      setSuccess("");
      setSelectedIds([]);

      const params = new URLSearchParams();
      params.set("role", roleId);
      params.set("page", String(targetPage));
      params.set("page_size", String(targetPageSize));
      if (classId) params.set("class", classId);
      if (sectionId) params.set("section", sectionId);

      const data = await apiGet<RecipientsResponse>(`/api/v1/admissions/certificate-templates/recipients/?${params.toString()}`);
      const rows = (data.recipients || data.results || []).map((row) => ({
        ...row,
        className: row.className || classNameById.get(Number((row as Recipient & { current_class?: number }).current_class || -1)) || row.className,
        sectionName: row.sectionName || sectionNameById.get(Number((row as Recipient & { current_section?: number }).current_section || -1)) || row.sectionName,
      }));

      setRecipients(rows);
      setRecipientTotal(data.count ?? rows.length);
      setRecipientPage(targetPage);
      if (!rows.length) {
        setSuccess(data.is_student_role ? "No student recipients found." : "No recipients found for this role.");
      }
    } catch {
      setError("Unable to load recipients.");
    } finally {
      setSearching(false);
    }
  };

  const toggleAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(recipients.map((r) => r.id));
      return;
    }
    setSelectedIds([]);
  };

  const toggleOne = (id: number, checked: boolean) => {
    if (checked) {
      setSelectedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      return;
    }
    setSelectedIds((prev) => prev.filter((item) => item !== id));
  };

  const printCertificates = () => {
    if (!roleId) {
      setRoleError(true);
      setError("Select a role first.");
      return;
    }
    if (!selectedTemplate) {
      setTemplateError(true);
      setError("Please select a certificate template.");
      return;
    }

    const targets = recipients.filter((r) => selectedIds.includes(r.id));
    if (!targets.length) {
      setError("Please select at least one recipient.");
      return;
    }

    const widthMm = mm(selectedTemplate.background_width, 165);
    const heightMm = mm(selectedTemplate.background_height, 144);
    const pt = mm(selectedTemplate.padding_top, 5);
    const pr = mm(selectedTemplate.padding_right, 5);
    const pb = mm(selectedTemplate.padding_bottom, 5);
    const pl = mm(selectedTemplate.pading_left, 5);

    const pages = targets
      .map((recipient) => {
        const bodyText = replacePlaceholders(selectedTemplate.body || "", recipient);
        const bgUrl = escapeHtml(selectedTemplate.background_url || "");
        const classLabel = escapeHtml(recipient.className || "-");
        const sectionLabel = escapeHtml(recipient.sectionName || "-");
        const dateLabel = escapeHtml(new Date().toISOString().slice(0, 10));
        const contentHtml = escapeHtml(bodyText).replace(/\n/g, "<br />");
        return `
          <article class="certificate">
            ${bgUrl ? `<img class="bg" src="${bgUrl}" alt="" />` : ""}
            <div class="certificate-inner">
              <div class="content-main">
                <div class="content-body">${contentHtml}</div>
              </div>
              <div class="content-footer">
                <div><strong>Class/Section:</strong> ${classLabel} ${sectionLabel !== "-" ? `(${sectionLabel})` : ""}</div>
                <div><strong>Date:</strong> ${dateLabel}</div>
                <div><strong>Authorized Signature:</strong> __________________</div>
              </div>
            </div>
          </article>
        `;
      })
      .join("\n");

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Generate Certificate</title>
        <style>
          * { box-sizing: border-box; }
          @page {
            size: ${widthMm}mm ${heightMm}mm;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
            font-family: Arial, sans-serif;
            background: #fff;
          }
          .sheet {
            margin: 0;
            padding: 0;
          }
          .certificate {
            position: relative;
            width: ${widthMm}mm;
            height: ${heightMm}mm;
            border: 1px solid #d1d5db;
            padding: ${pt}mm ${pr}mm ${pb}mm ${pl}mm;
            overflow: hidden;
            margin: 0 auto;
            page-break-inside: avoid;
            break-inside: avoid;
            page-break-after: always;
          }
          .certificate:last-child {
            page-break-after: auto;
          }
          .bg {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: center;
            z-index: 0;
            pointer-events: none;
          }
          .certificate-inner {
            position: relative;
            z-index: 1;
            height: 100%;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }
          .content-main {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
          }
          .content-body {
            max-width: 88%;
            font-size: 13px;
            color: #111827;
            line-height: 1.6;
            white-space: normal;
          }
          .content-footer {
            display: flex;
            justify-content: space-between;
            gap: 10mm;
            align-items: center;
            font-size: 11px;
            color: #111827;
            padding-top: 4mm;
          }
          @media print {
            body { padding: 0; }
            .certificate {
              border: none;
              margin: 0;
            }
            html, body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          }
        </style>
      </head>
      <body>
        <div class="sheet">${pages}</div>
        <script>
          window.onload = function() {
            setTimeout(function() {
              window.print();
            }, 500);
          };
        </script>
      </body>
      </html>
    `;

    const popup = window.open("", "_blank", "width=1200,height=850");
    if (!popup) {
      setError("Popup blocked. Allow popups to print certificates.");
      return;
    }

    popup.document.open();
    popup.document.write(html);
    popup.document.close();

    setError("");
    setSuccess("Print view opened for selected certificates.");
  };

  const handleGridGapChange = (value: string) => {
    setGridGap(value);
    const parsed = Number(value);
    setGridGapError(value !== "" && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100));
  };

  const validateGridGap = () => {
    const parsed = Number(gridGap);
    setGridGapError(gridGap !== "" && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100));
  };

  return (
    <div className="legacy-panel">
      <section className="sms-breadcrumb mb-20">
        <div className="container-fluid">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h1 style={{ margin: 0, fontSize: 24 }}>Generate Certificate</h1>
            <div style={{ display: "flex", gap: 8, color: "var(--text-muted)", fontSize: 13 }}>
              <span>Dashboard</span>
              <span>/</span>
              <span>Admin Section</span>
              <span>/</span>
              <span>Generate Certificate</span>
            </div>
          </div>
        </div>
      </section>

      <section className="admin-visitor-area up_admin_visitor">
        <div className="container-fluid p-0">
          <div className="white-box">
            <h3>Select Criteria</h3>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div className="cert-field-group">
                <label className="cert-label">Role<span className="required-star"> *</span></label>
                <select
                  value={roleId}
                  onChange={(e) => {
                    setRoleId(e.target.value);
                    setRoleError(!e.target.value);
                  }}
                  onBlur={() => setRoleError(!roleId)}
                  className={roleError ? "has-error" : roleId ? "is-valid" : ""}
                >
                  <option value="">Select role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>{role.name}</option>
                  ))}
                </select>
                <div className={`cert-error ${roleError ? "visible" : ""}`}>Please select a role</div>
                <div className="cert-hint">Select the role type for recipients</div>
              </div>

              <div className="cert-field-group">
                <label className="cert-label">Certificate<span className="required-star"> *</span></label>
                <select
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setTemplateError(!e.target.value);
                  }}
                  onBlur={() => setTemplateError(!templateId)}
                  className={templateError ? "has-error" : templateId ? "is-valid" : ""}
                >
                  <option value="">Select certificate</option>
                  {availableTemplates.map((t) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
                <div className={`cert-error ${templateError ? "visible" : ""}`}>Please select a certificate</div>
                <div className="cert-hint">Choose the certificate template</div>
              </div>

              {isStudentRole ? (
                <div className="cert-field-group">
                  <label className="cert-label">Class</label>
                  <select
                    value={classId}
                    onChange={(e) => {
                      setClassId(e.target.value);
                      setSectionId("");
                    }}
                    className={classId ? "is-valid" : ""}
                  >
                    <option value="">Select class</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>{c.class_name || c.name || `Class ${c.id}`}</option>
                    ))}
                  </select>
                  <div className="cert-error" />
                  <div className="cert-hint">Filter by class (optional)</div>
                </div>
              ) : null}

              {isStudentRole ? (
                <div className="cert-field-group">
                  <label className="cert-label">Section</label>
                  <select
                    value={sectionId}
                    onChange={(e) => setSectionId(e.target.value)}
                    className={sectionId ? "is-valid" : ""}
                  >
                    <option value="">Select section</option>
                    {filteredSections.map((s) => (
                      <option key={s.id} value={s.id}>{s.section_name || s.name || `Section ${s.id}`}</option>
                    ))}
                  </select>
                  <div className="cert-error" />
                  <div className="cert-hint">Filter by section (optional)</div>
                </div>
              ) : null}

              <div className="cert-field-group">
                <label className="cert-label">Grid Gap (px)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={gridGap}
                  onChange={(e) => setGridGap(e.target.value)}
                  onBlur={validateGridGap}
                  className={gridGapError ? "has-error" : gridGap ? "is-valid" : ""}
                  placeholder="14"
                />
                <div className={`cert-error ${gridGapError ? "visible" : ""}`}>Must be between 0 and 100</div>
                <div className="cert-hint">Spacing between certificates (0-100)</div>
              </div>
            </div>

            <div className="cert-btn-group">
              <button className="cert-btn-search" type="button" onClick={() => void loadRecipients()} disabled={loading || searching}>
                {searching ? "Loading..." : "Search"}
              </button>
              <button className="cert-btn-print" type="button" onClick={printCertificates}>Print Selected</button>
            </div>
          </div>

          <div className="white-box">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Recipient List</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={!!recipients.length && selectedIds.length === recipients.length}
                    onChange={(e) => toggleAll(e.target.checked)}
                  />
                  Select all
                </label>
                <label style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                  Rows per page
                  <select
                    value={recipientPageSize}
                    onChange={(e) => {
                      const size = Number(e.target.value);
                      setRecipientPageSize(size);
                      void loadRecipients(1, size);
                    }}
                    style={{ ...fieldStyle(), width: 92 }}
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Showing {recipientTotal === 0 ? 0 : (recipientPage - 1) * recipientPageSize + 1}-{Math.min(recipientPage * recipientPageSize, recipientTotal)} of {recipientTotal}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  style={buttonStyle("#64748b")}
                  disabled={recipientPage <= 1 || searching}
                  onClick={() => void loadRecipients(Math.max(1, recipientPage - 1), recipientPageSize)}
                >
                  Previous
                </button>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Page {recipientPage} of {Math.max(1, Math.ceil(recipientTotal / recipientPageSize))}</span>
                <button
                  type="button"
                  style={buttonStyle("#64748b")}
                  disabled={recipientPage * recipientPageSize >= recipientTotal || searching}
                  onClick={() => void loadRecipients(recipientPage + 1, recipientPageSize)}
                >
                  Next
                </button>
              </div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--line)", textAlign: "left" }}>Select</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--line)", textAlign: "left" }}>Name</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--line)", textAlign: "left" }}>Admission</th>
                    <th style={{ padding: 8, borderBottom: "1px solid var(--line)", textAlign: "left" }}>Class/Section</th>
                  </tr>
                </thead>
                <tbody>
                  {!recipients.length ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, color: "var(--text-muted)" }}>
                        {loading ? "Loading..." : "No recipients loaded. Click Search."}
                      </td>
                    </tr>
                  ) : (
                    recipients.map((recipient) => (
                      <tr key={recipient.id}>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(recipient.id)}
                            onChange={(e) => toggleOne(recipient.id, e.target.checked)}
                          />
                        </td>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>{recipient.label}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>{recipient.admission_no || "-"}</td>
                        <td style={{ padding: 8, borderBottom: "1px solid var(--line)" }}>
                          {recipient.className ? `${recipient.className} (${recipient.sectionName || "-"})` : "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <style jsx global>{`
            .admin-visitor-area .container-fluid.p-0 {
              display: grid;
              grid-template-columns: 300px 1fr;
              gap: 16px;
              align-items: start;
            }

            .admin-visitor-area .white-box:first-child {
              background: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 10px;
              padding: 12px;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
            }
            .admin-visitor-area .white-box:first-child h3 {
              font-size: 14px;
              font-weight: 600;
              color: #1e293b;
              margin: 0 0 10px 0;
              padding-bottom: 6px;
              border-bottom: 2px solid #7c83db;
            }
            .admin-visitor-area .white-box:first-child > div:first-of-type {
              display: flex;
              flex-direction: column;
              gap: 0;
            }

            .cert-field-group {
              margin-bottom: 6px;
            }
            .cert-field-group label.cert-label {
              display: block;
              font-size: 11px;
              font-weight: 600;
              color: #475569;
              margin-bottom: 2px;
              letter-spacing: 0.02em;
            }
            .cert-field-group .required-star {
              color: #e8849a;
              margin-left: 2px;
            }
            .cert-field-group .cert-hint {
              font-size: 9.5px;
              color: #94a3b8;
              margin-top: 1px;
              line-height: 1.3;
            }
            .cert-field-group .cert-error {
              font-size: 10.5px;
              color: #dc2626;
              margin-top: 2px;
              display: none;
              line-height: 1.3;
            }
            .cert-field-group .cert-error.visible {
              display: block;
            }
            .cert-field-group select,
            .cert-field-group input {
              width: 100%;
              padding: 4px 8px;
              border: 1.5px solid #e2e8f0;
              border-radius: 6px;
              font-size: 12px;
              color: #334155;
              background: #f8fafc;
              transition: all 0.2s ease;
              outline: none;
              box-sizing: border-box;
              height: 30px;
            }
            .cert-field-group select:focus,
            .cert-field-group input:focus {
              border-color: #7c83db;
              box-shadow: 0 0 0 2px rgba(124, 131, 219, 0.12);
              background: #ffffff;
            }
            .cert-field-group select.has-error,
            .cert-field-group input.has-error {
              border-color: #dc2626;
              box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.08);
            }
            .cert-field-group select.is-valid,
            .cert-field-group input.is-valid {
              border-color: #5ab88d;
            }
            .cert-field-group input[type="number"] {
              width: 90px;
            }

            .cert-btn-group {
              display: flex;
              gap: 8px;
              margin-top: 4px;
              padding-top: 6px;
              border-top: 1px solid #f1f5f9;
            }
            .cert-btn-group button {
              padding: 6px 14px;
              border-radius: 6px;
              font-size: 11.5px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s ease;
              border: none;
            }
            .cert-btn-search {
              background: linear-gradient(135deg, #7c83db 0%, #6366f1 100%);
              color: white;
            }
            .cert-btn-search:hover {
              box-shadow: 0 3px 10px rgba(124, 131, 219, 0.35);
            }
            .cert-btn-print {
              background: linear-gradient(135deg, #5ab88d 0%, #34d399 100%);
              color: white;
            }
            .cert-btn-print:hover {
              box-shadow: 0 3px 10px rgba(90, 184, 141, 0.35);
            }

            .admin-visitor-area .white-box:last-child {
              background: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 10px;
              padding: 16px;
              box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
            }
            .admin-visitor-area .white-box:last-child h3 {
              font-size: 15px;
              font-weight: 600;
              color: #1e293b;
            }
            .admin-visitor-area .white-box:last-child > div:first-child {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 10px;
              padding-bottom: 8px;
              border-bottom: 2px solid #5ab88d;
            }

            .admin-visitor-area table {
              width: 100%;
              border-collapse: separate;
              border-spacing: 0;
            }
            .admin-visitor-area table thead th {
              background: #f8fafc;
              color: #64748b;
              font-size: 10.5px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              padding: 8px 10px;
              border-bottom: 2px solid #e2e8f0;
            }
            .admin-visitor-area table tbody td {
              padding: 8px 10px;
              font-size: 12.5px;
              color: #475569;
              border-bottom: 1px solid #f1f5f9;
            }
            .admin-visitor-area table tbody tr:hover {
              background: #f8fafc;
            }

            @media (max-width: 1100px) {
              .admin-visitor-area .container-fluid.p-0 {
                grid-template-columns: 1fr;
              }
            }
          `}</style>

          {error && <p style={{ color: "var(--warning)", margin: 0 }}>{error}</p>}
          {success && <p style={{ color: "#0f766e", margin: 0 }}>{success}</p>}
        </div>
      </section>
    </div>
  );
}

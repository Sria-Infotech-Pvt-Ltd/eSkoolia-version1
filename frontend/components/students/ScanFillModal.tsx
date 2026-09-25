"use client";
import React, { useMemo, useRef, useState } from "react";

// ─── field definitions ────────────────────────────────────────────────────────
export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  type?: string;
  /** Extra OCR label synonyms to search for besides `label` (e.g. lastName → "SURNAME"). */
  aliases?: string[];
  /**
   * Shape the extracted value must match for a strict field — phone/pincode/aadhaar
   * numbers and emails. findAfterLabel grabs "whatever text sits near the matched
   * label", which on a real ID document (as opposed to a neatly labeled admission
   * form) is often instructional boilerplate that happens to contain the word
   * "mobile"/"phone"/etc (e.g. an Aadhaar letter's "please keep your mobile number
   * and email ID updated" notice). Without this, that boilerplate — or a real
   * value with boilerplate glued onto it by messy OCR line-breaks — got stored
   * verbatim. With it, only a substring actually matching the expected shape is
   * kept; anything else is left blank rather than filled with garbage.
   */
  extractAs?: "phone" | "pincode" | "aadhaar" | "email";
}

export type FieldGroup = { section: string; fields: FieldDef[] };

export const STUDENT_FIELD_GROUPS: FieldGroup[] = [
  {
    section: "Section A — Student Identity",
    fields: [
      { key: "firstName",    label: "First Name",    required: true,  hint: "As per birth certificate", aliases: ["GIVEN NAME"] },
      { key: "lastName",     label: "Last Name",     required: true,  aliases: ["SURNAME"] },
      { key: "dateOfBirth",  label: "Date of Birth", required: true,  hint: "DD / MM / YYYY", type: "text", aliases: ["DOB", "D.O.B"] },
      { key: "gender",       label: "Gender",        required: true,  hint: "MALE / FEMALE / OTHER", aliases: ["SEX"] },
      { key: "bloodGroup",   label: "Blood Group",   required: false, hint: "e.g. A+", aliases: ["BLOOD TYPE"] },
      { key: "religion",     label: "Religion",      required: false },
      { key: "nationality",  label: "Nationality",   required: false },
      { key: "motherTongue", label: "Mother Tongue", required: false },
    ],
  },
  {
    section: "Section B — Contact & Address",
    fields: [
      { key: "phone",       label: "Mobile Phone",  required: true,  hint: "10-digit", aliases: ["MOBILE", "PHONE"], extractAs: "phone" },
      { key: "email",       label: "Email",         required: false, extractAs: "email" },
      { key: "addressLine", label: "Address Line",  required: true,  aliases: ["ADDRESS"] },
      { key: "city",        label: "City",          required: true,  aliases: ["TOWN"] },
      { key: "district",    label: "District",      required: true  },
      { key: "stateName",   label: "State",         required: true  },
      { key: "pincode",     label: "Pincode",       required: true,  hint: "6-digit", aliases: ["PIN CODE", "POSTAL CODE"], extractAs: "pincode" },
    ],
  },
  {
    section: "Section C — Parent / Guardian",
    fields: [
      { key: "guardianName",       label: "Guardian Full Name",   required: true,  aliases: ["GUARDIAN NAME", "FATHER", "MOTHER"] },
      { key: "guardianRelation",   label: "Relationship",         required: false, hint: "Father / Mother / Guardian" },
      { key: "guardianPhone",      label: "Guardian Mobile",      required: true,  hint: "10-digit", aliases: ["GUARDIAN PHONE"], extractAs: "phone" },
      { key: "guardianEmail",      label: "Guardian Email",       required: false, extractAs: "email" },
      { key: "guardianOccupation", label: "Guardian Occupation",  required: false },
    ],
  },
  {
    section: "Section D — Government Identity",
    fields: [
      { key: "aadhaarNo", label: "Aadhaar Number", required: false, hint: "12 digits", aliases: ["AADHAR", "UID"], extractAs: "aadhaar" },
    ],
  },
];

function requiredKeysOf(fieldGroups: FieldGroup[]): string[] {
  return fieldGroups.flatMap(g => g.fields.filter(f => f.required).map(f => f.key));
}
function fieldLabelMapOf(fieldGroups: FieldGroup[]): Record<string, string> {
  return Object.fromEntries(fieldGroups.flatMap(g => g.fields.map(f => [f.key, f.label])));
}

// ─── typed errors for precise user-facing messages ───────────────────────────
class ScanError extends Error {
  constructor(
    public readonly code:
      | "file_type"
      | "file_size"
      | "pdf_corrupt"
      | "pdf_protected"
      | "pdf_empty"
      | "pdf_render"
      | "ocr_engine"
      | "no_text",
    message: string
  ) {
    super(message);
    this.name = "ScanError";
  }
}

const SCAN_ERROR_MESSAGES: Record<ScanError["code"], { title: string; detail: string; tip: string }> = {
  file_type: {
    title: "Unsupported file type",
    detail: "Only PDF, JPG, PNG, and WEBP files are accepted.",
    tip: "If the form was filled in Word or Excel, export it as a PDF first (File → Save As → PDF).",
  },
  file_size: {
    title: "File is too large",
    detail: "Maximum file size is 20 MB.",
    tip: "Compress the PDF at smallpdf.com, or reduce image resolution before uploading.",
  },
  pdf_corrupt: {
    title: "PDF could not be opened",
    detail: "The file appears to be corrupted or incomplete.",
    tip: "Try re-saving the PDF (Open in any PDF viewer → File → Print → Save as PDF) and upload again.",
  },
  pdf_protected: {
    title: "PDF is password-protected",
    detail: "This PDF has security restrictions that prevent reading its contents.",
    tip: "Remove the password in Adobe Acrobat or any PDF viewer (usually under Document Properties → Security) and try again.",
  },
  pdf_empty: {
    title: "PDF has no pages",
    detail: "The uploaded PDF appears to be empty.",
    tip: "Verify the file opens correctly in a PDF viewer, then try uploading again.",
  },
  pdf_render: {
    title: "PDF page could not be rendered",
    detail: "The browser could not draw this PDF page for scanning.",
    tip: "Try refreshing the page and uploading again. If the problem persists, export the PDF to a JPG image and upload that instead.",
  },
  ocr_engine: {
    title: "Text recognition failed",
    detail: "The OCR engine could not process this file.",
    tip: "Try again. If the error repeats, export the PDF as a JPG (using any PDF viewer's Print → Save as Image) and upload the image.",
  },
  no_text: {
    title: "No form fields detected",
    detail: "The file was read but no recognisable form fields were found.",
    tip: "Ensure the uploaded file matches the expected form. For handwritten or scanned forms, check that all text is clearly visible and written in BLOCK LETTERS.",
  },
};

// ─── field extraction from text ──────────────────────────────────────────────
// Search terms for each field are derived from its `label` (uppercased) plus any
// `aliases` — this is what lets the same extractor serve any fieldGroups list.
function extractFieldsFromText(text: string, fieldGroups: FieldGroup[]): Record<string, string> {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const findAfterLabel = (label: string): string => {
    const idx = lines.findIndex(l => l.toUpperCase().includes(label.toUpperCase()));
    if (idx < 0) return "";

    // Prefer an inline "Label: Value" match on the label's own line — this is
    // unambiguous, whereas blindly grabbing the next line (below) can swallow
    // a *different* field's "Label: Value" line whole (e.g. "First Name: Test"
    // followed by "Last Name: Sharma" was filling First Name with "Last Name:
    // Sharma" because the next-line fallback ran first and had no way to tell
    // that line belonged to another field).
    const inline = lines[idx].match(/[:=]\s*(.+)$/);
    if (inline && inline[1].trim().length > 0) return inline[1].trim();

    if (idx + 1 < lines.length) {
      const nextLine = lines[idx + 1];
      const val = nextLine.replace(/^[-:_\s]+/, "").trim();
      // Guard against the next line being itself another field's "Label: value"
      // line (short leading word(s) then a colon) rather than this field's value.
      const looksLikeAnotherLabel = /^[A-Za-z][A-Za-z\s/]{1,30}[:=]/.test(nextLine);
      if (val && !looksLikeAnotherLabel && !val.toUpperCase().includes("SECTION") && !val.toUpperCase().includes("STUDENT"))
        return val;
    }
    return "";
  };

  const pick = (...labels: string[]) => {
    for (const lbl of labels) { const v = findAfterLabel(lbl); if (v) return v; }
    return "";
  };

  // Extracts only the substring of `candidate` that actually matches the
  // field's expected shape, discarding the rest — see FieldDef.extractAs.
  // Returns "" (never the raw garbage) when nothing matching is found, so a
  // strict field is left blank for the admin to fill in rather than populated
  // with whatever boilerplate text sat near the matched label.
  const sanitizeExtracted = (candidate: string, extractAs: FieldDef["extractAs"]): string => {
    if (!extractAs) return candidate;
    switch (extractAs) {
      case "phone": {
        const m = candidate.match(/[6-9]\d{9}/);
        return m ? m[0] : "";
      }
      case "pincode": {
        const m = candidate.match(/\d{6}/);
        return m ? m[0] : "";
      }
      case "aadhaar": {
        const m = candidate.replace(/\s+/g, "").match(/\d{12}/);
        return m ? m[0] : "";
      }
      case "email": {
        const m = candidate.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        return m ? m[0] : "";
      }
      default:
        return candidate;
    }
  };

  const raw: Record<string, string> = {};
  for (const group of fieldGroups) {
    for (const f of group.fields) {
      const candidate = pick(f.label.toUpperCase(), ...(f.aliases ?? []));
      raw[f.key] = sanitizeExtracted(candidate, f.extractAs);
    }
  }

  Object.keys(raw).forEach(k => { if (!raw[k]) delete raw[k]; });
  return raw;
}

// ─── OCR extraction ───────────────────────────────────────────────────────────
// Returns extracted fields + the mode used (for progress text)
type ScanMode = "pdf-text" | "pdf-ocr" | "image-ocr";

async function runOcr(
  file: File,
  fieldGroups: FieldGroup[],
  onProgress: (p: number) => void,
  onPreview?: (url: string) => void,
  onMode?: (m: ScanMode) => void
): Promise<Record<string, string>> {
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    let pdfjsLib: typeof import("pdfjs-dist");
    try {
      pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    } catch {
      throw new ScanError("pdf_corrupt", "pdfjs-dist failed to load");
    }
    onProgress(10);

    const arrayBuffer = await file.arrayBuffer();
    let pdfDoc: Awaited<ReturnType<typeof pdfjsLib.getDocument>["promise"]>;
    try {
      pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (msg.includes("password")) throw new ScanError("pdf_protected", "PDF is password protected");
      throw new ScanError("pdf_corrupt", "Could not open PDF");
    }

    if (pdfDoc.numPages === 0) throw new ScanError("pdf_empty", "PDF has 0 pages");
    onProgress(20);

    // Try text layer first (digital/typed PDFs — fast & accurate)
    let allText = "";
    for (let pageNum = 1; pageNum <= Math.min(pdfDoc.numPages, 5); pageNum++) {
      const page = await pdfDoc.getPage(pageNum);
      const content = await page.getTextContent();
      const sorted = [...content.items].sort((a, b) => {
        const ay = (a as { transform: number[] }).transform[5];
        const by = (b as { transform: number[] }).transform[5];
        const ax = (a as { transform: number[] }).transform[4];
        const bx = (b as { transform: number[] }).transform[4];
        if (Math.abs(ay - by) > 5) return by - ay;
        return ax - bx;
      });
      allText += sorted.map(item => (item as { str: string }).str).join("\n") + "\n";
    }
    onProgress(40);

    // Render page 1 for preview
    let canvas: HTMLCanvasElement;
    try {
      const page1 = await pdfDoc.getPage(1);
      const vp = page1.getViewport({ scale: 1.5 });
      canvas = document.createElement("canvas");
      canvas.width = vp.width; canvas.height = vp.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new ScanError("pdf_render", "Canvas 2D context unavailable");
      await page1.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
      onPreview?.(canvas.toDataURL("image/png"));
    } catch (e) {
      if (e instanceof ScanError) throw e;
      throw new ScanError("pdf_render", "Failed to render PDF page");
    }
    onProgress(55);

    if (allText.replace(/\s/g, "").length > 80) {
      // Digital PDF — text layer is rich, no OCR needed
      onMode?.("pdf-text");
      onProgress(95);
      return extractFieldsFromText(allText, fieldGroups); // may be empty if PDF isn't the expected form — review step shows why
    }

    // Scanned PDF — fall back to Tesseract on rendered canvas
    onMode?.("pdf-ocr");
    let Tesseract: typeof import("tesseract.js");
    try {
      Tesseract = await import("tesseract.js");
    } catch {
      throw new ScanError("ocr_engine", "Tesseract.js failed to load");
    }
    const worker = await Tesseract.createWorker("eng", 1, {
      logger: (m: { status: string; progress?: number }) => {
        if (m.status === "recognizing text" && m.progress)
          onProgress(55 + Math.round(m.progress * 40));
      },
    });
    let ocrResult: { data: { text: string } };
    try {
      ocrResult = await worker.recognize(canvas!);
    } catch {
      await worker.terminate().catch(() => {});
      throw new ScanError("ocr_engine", "Tesseract OCR recognition failed");
    }
    await worker.terminate();
    onProgress(95);
    const scannedResult = extractFieldsFromText(ocrResult.data.text, fieldGroups);
    return scannedResult; // may be empty — review step will show the "no fields detected" message
  }

  // Image file (JPEG / PNG / WEBP)
  onMode?.("image-ocr");
  let Tesseract: typeof import("tesseract.js");
  try {
    Tesseract = await import("tesseract.js");
  } catch {
    throw new ScanError("ocr_engine", "Tesseract.js failed to load");
  }
  onProgress(10);
  const worker = await Tesseract.createWorker("eng", 1, {
    logger: (m: { status: string; progress?: number }) => {
      if (m.status === "recognizing text" && m.progress)
        onProgress(10 + Math.round(m.progress * 80));
    },
  });
  let ocrResult: { data: { text: string } };
  try {
    ocrResult = await worker.recognize(file);
  } catch {
    await worker.terminate().catch(() => {});
    throw new ScanError("ocr_engine", "Tesseract OCR recognition failed");
  }
  await worker.terminate();
  onProgress(95);
  const imageResult = extractFieldsFromText(ocrResult.data.text, fieldGroups);
  return imageResult; // may be empty — review step will show the "no fields detected" message
}

// ─── component ────────────────────────────────────────────────────────────────
interface ScanFillModalProps {
  onClose: () => void;
  onApply: (results: Record<string, string>) => void;
  fieldGroups: FieldGroup[];
  /** What kind of form this is, used in a couple of on-screen hints (default: "admission form"). */
  documentLabel?: string;
}

type Step = "pick" | "scanning" | "review";

export function ScanFillModal({ onClose, onApply, fieldGroups, documentLabel = "admission form" }: ScanFillModalProps) {
  const REQUIRED_KEYS = useMemo(() => requiredKeysOf(fieldGroups), [fieldGroups]);
  const FIELD_LABEL_MAP = useMemo(() => fieldLabelMapOf(fieldGroups), [fieldGroups]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("pick");
  const [previewUrl, setPreviewUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [progress, setProgress] = useState(0);
  const [scanError, setScanError] = useState<ScanError | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [showMissingPrompt, setShowMissingPrompt] = useState(false);

  const missingRequired = REQUIRED_KEYS.filter(k => !fields[k]?.trim());
  const filledCount = Object.values(fields).filter(v => v?.trim()).length;

  const ACCEPTED_TYPES = new Set([
    "application/pdf",
    "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  ]);
  const MAX_SIZE_MB = 20;

  const handleFile = async (file: File) => {
    setScanError(null);
    setFileName(file.name);

    // ── File validation ──
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isPdf = file.type === "application/pdf" || ext === "pdf";
    const isImage = file.type.startsWith("image/") || ["jpg","jpeg","png","webp","gif"].includes(ext);

    if (!ACCEPTED_TYPES.has(file.type) && !isPdf && !isImage) {
      setScanError(new ScanError("file_type", `Unsupported type: ${file.type || ext}`));
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      setScanError(new ScanError("file_size", `File is ${sizeMb} MB`));
      return;
    }

    if (!isPdf) setPreviewUrl(URL.createObjectURL(file));
    setStep("scanning");
    setProgress(5);
    setScanMode(null);
    setShowMissingPrompt(false);
    try {
      const extracted = await runOcr(file, fieldGroups, setProgress, setPreviewUrl, setScanMode);
      setFields(extracted);
      setProgress(100);
      setStep("review");
    } catch (e) {
      console.error(e);
      if (e instanceof ScanError) {
        setScanError(e);
      } else {
        setScanError(new ScanError("pdf_corrupt", String(e)));
      }
      setStep("pick");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleApply = () => {
    if (missingRequired.length > 0) {
      setShowMissingPrompt(true);
      return;
    }
    onApply(fields);
    onClose();
  };

  const handleFillManually = () => {
    // Apply whatever was successfully extracted — admin fills the rest in the enrollment form
    onApply(fields);
    onClose();
  };

  const handleScanAgain = () => {
    setShowMissingPrompt(false);
    setStep("pick");
    setFields({});
    setPreviewUrl("");
    setFileName("");
    setScanMode(null);
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 10100,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
      onClick={onClose}
    >
      <div
        style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 1000,
          maxHeight: "92vh", display: "flex", flexDirection: "column",
          boxShadow: "0 32px 80px rgba(0,0,0,0.3)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #e5e7eb",
          background: "linear-gradient(135deg,#1a0540,#3b1d8a)", borderRadius: "16px 16px 0 0",
          display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: "#fff" }}>
              📷 Scan & Fill — Auto extract from filled form
            </h2>
            <p style={{ margin: "3px 0 0", fontSize: 12, color: "#c4b5fd" }}>
              {step === "pick" && `Select or drop a scanned / photographed ${documentLabel}`}
              {step === "scanning" && `Reading "${fileName}"…`}
              {step === "review" && `${filledCount} fields extracted. Review & correct before applying.`}
            </p>
          </div>
          <button type="button" onClick={onClose}
            style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff",
              borderRadius: "50%", width: 32, height: 32, fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

          {/* ── STEP: PICK ── */}
          {step === "pick" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", padding: 40 }}>
              <div
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                style={{ border: `2.5px dashed ${dragging ? "#6c3ce1" : "#d1d5db"}`,
                  borderRadius: 16, padding: "48px 60px", textAlign: "center", width: "100%",
                  maxWidth: 520, background: dragging ? "#f5f3ff" : "#fafafa",
                  transition: "all 0.2s", cursor: "pointer" }}
                onClick={() => fileInputRef.current?.click()}
              >
                <div style={{ fontSize: 52, marginBottom: 12 }}>📄</div>
                <p style={{ fontSize: 17, fontWeight: 700, color: "#111827", marginBottom: 6 }}>
                  Drop the scanned form here
                </p>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20 }}>
                  Accepts PDF (typed or scanned), JPEG, PNG, WEBP — or use the button below
                </p>
                <button type="button"
                  style={{ padding: "10px 28px", background: "#6c3ce1", color: "#fff",
                    border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600,
                    cursor: "pointer" }}>
                  📁 Browse file
                </button>
                <p style={{ fontSize: 11, color: "#9ca3af", marginTop: 12 }}>
                  For best results: good lighting, all 4 corners visible, text in BLOCK LETTERS
                </p>
              </div>
              {scanError && (() => {
                const info = SCAN_ERROR_MESSAGES[scanError.code];
                return (
                  <div style={{ marginTop: 16, background: "#fef2f2", border: "1.5px solid #fca5a5",
                    borderRadius: 10, padding: "14px 18px", maxWidth: 520, width: "100%" }}>
                    <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 13, color: "#dc2626" }}>
                      ⚠ {info.title}
                    </p>
                    <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "#7f1d1d" }}>
                      {info.detail}
                    </p>
                    <p style={{ margin: 0, fontSize: 12, color: "#92400e",
                      background: "#fffbeb", borderRadius: 6, padding: "7px 10px",
                      border: "1px solid #fde68a" }}>
                      💡 {info.tip}
                    </p>
                  </div>
                );
              })()}
              <input ref={fileInputRef} type="file" accept="*/*"
                style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }} />
            </div>
          )}

          {/* ── STEP: SCANNING ── */}
          {step === "scanning" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", padding: 40 }}>
              <div style={{ textAlign: "center", maxWidth: 440 }}>
                {previewUrl && (
                  <img src={previewUrl} alt="Scanning preview"
                    style={{ maxWidth: "100%", maxHeight: 260, borderRadius: 10,
                      objectFit: "contain", marginBottom: 24, border: "1px solid #e5e7eb",
                      boxShadow: "0 4px 16px rgba(0,0,0,0.1)" }} />
                )}
                <p style={{ fontSize: 16, fontWeight: 700, color: "#111827", marginBottom: 10 }}>
                  🔍 Reading the form…
                </p>
                <div style={{ background: "#e9e4ff", borderRadius: 100, height: 10,
                  width: "100%", overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ background: "#6c3ce1", height: "100%", width: `${progress}%`,
                    transition: "width 0.3s ease", borderRadius: 100 }} />
                </div>
                <p style={{ fontSize: 12, color: "#6b7280" }}>
                  {progress}% —{" "}
                  {scanMode === "pdf-text" && "Reading text layer from PDF…"}
                  {scanMode === "pdf-ocr" && "Running OCR on scanned PDF…"}
                  {scanMode === "image-ocr" && "Running OCR on image…"}
                  {!scanMode && "Preparing file…"}
                </p>
              </div>
            </div>
          )}

          {/* ── STEP: REVIEW ── */}
          {step === "review" && (
            <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>

              {/* Left — scanned image */}
              <div style={{ width: 360, flexShrink: 0, borderRight: "1px solid #e5e7eb",
                background: "#f8f7ff", display: "flex", flexDirection: "column",
                alignItems: "center", padding: 16, gap: 10, overflowY: "auto" }}>
                <p style={{ fontSize: 11, fontWeight: 600, color: "#6b7280",
                  textTransform: "uppercase", letterSpacing: "0.5px", margin: 0 }}>
                  {scanMode === "pdf-text" ? "PDF preview" : "Original scan"}
                </p>
                <img src={previewUrl} alt="Scanned form"
                  style={{ width: "100%", borderRadius: 8, border: "1px solid #e5e7eb",
                    objectFit: "contain", boxShadow: "0 2px 12px rgba(0,0,0,0.08)" }} />
                <p style={{ fontSize: 11, color: "#9ca3af", textAlign: "center" }}>
                  {fileName}
                </p>
                <button type="button"
                  onClick={() => { setStep("pick"); setFields({}); setPreviewUrl(""); setFileName(""); }}
                  style={{ padding: "6px 14px", background: "none", border: "1px solid #d1d5db",
                    borderRadius: 6, fontSize: 12, color: "#6b7280", cursor: "pointer" }}>
                  ↩ Scan a different file
                </button>
              </div>

              {/* Right — editable extracted form */}
              <div style={{ flex: 1, overflowY: "auto", padding: "16px 24px" }}>
                <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 16 }}>
                  {scanMode === "pdf-text"
                    ? <><strong style={{ color: "#059669" }}>✓ Digital PDF</strong> — text read directly, {filledCount} fields extracted. No OCR was needed.</>
                    : scanMode === "pdf-ocr"
                    ? <><strong style={{ color: "#d97706" }}>Scanned PDF</strong> — OCR processed the scan, {filledCount} fields extracted. Review carefully for misreads.</>
                    : <><strong style={{ color: "#d97706" }}>Image OCR</strong> — {filledCount} fields extracted. Correct any recognition errors below.</>
                  }
                </p>

                {fieldGroups.map(group => (
                  <div key={group.section} style={{ marginBottom: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#6c3ce1",
                        textTransform: "uppercase", letterSpacing: "0.8px", whiteSpace: "nowrap",
                        padding: "0 8px" }}>{group.section}</span>
                      <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 16px" }}>
                      {group.fields.map(f => {
                        const val = fields[f.key] ?? "";
                        const isEmpty = !val.trim();
                        const isMissingRequired = f.required && isEmpty;
                        return (
                          <div key={f.key}
                            style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                            <label style={{ fontSize: 11, fontWeight: 600,
                              color: isMissingRequired ? "#dc2626" : "#374151",
                              display: "flex", alignItems: "center", gap: 4 }}>
                              {f.label}
                              {f.required && <span style={{ color: "#dc2626" }}>*</span>}
                              {f.hint && <span style={{ fontWeight: 400, color: "#9ca3af" }}>— {f.hint}</span>}
                            </label>
                            <input
                              type={f.type || "text"}
                              value={val}
                              placeholder={isEmpty ? (f.required ? "⚠ Required — fill manually" : "Not extracted") : ""}
                              onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                              style={{
                                padding: "7px 10px",
                                border: `1.5px solid ${isMissingRequired ? "#fca5a5" : val.trim() ? "#a7f3d0" : "#e5e7eb"}`,
                                borderRadius: 6,
                                fontSize: 13,
                                fontFamily: "'Courier New', monospace",
                                fontWeight: 600,
                                color: "#111827",
                                background: isMissingRequired ? "#fff5f5" : val.trim() ? "#f0fdf4" : "#fff",
                                outline: "none",
                                width: "100%",
                                boxSizing: "border-box",
                              }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                {/* Missing fields summary — compact inline indicator only; prompt appears on Apply */}
                {missingRequired.length > 0 && !showMissingPrompt && (
                  <div style={{ marginTop: 8, background: "#fff5f5", border: "1px solid #fecaca",
                    borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>⚠</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#dc2626", margin: "0 0 5px" }}>
                        {missingRequired.length} required field{missingRequired.length > 1 ? "s" : ""} not found in the scan:
                      </p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 6 }}>
                        {missingRequired.map(k => (
                          <span key={k} style={{ background: "#fee2e2", color: "#b91c1c",
                            padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                            {FIELD_LABEL_MAP[k]}
                          </span>
                        ))}
                      </div>
                      <p style={{ fontSize: 11, color: "#6b7280", margin: 0 }}>
                        Click <strong>Apply to form</strong> below — you&apos;ll be asked whether to scan again or fill them manually.
                      </p>
                    </div>
                  </div>
                )}

                {filledCount === 0 && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8,
                    padding: "14px 16px", color: "#92400e", fontSize: 13 }}>
                    <p style={{ margin: "0 0 8px", fontWeight: 700 }}>⚠ No fields could be extracted</p>
                    {scanMode === "pdf-text" ? (
                      <>
                        <p style={{ margin: "0 0 6px" }}>The PDF text layer was read but no form fields were recognised. This can happen if:</p>
                        <ul style={{ margin: "0 0 8px", paddingLeft: 18, lineHeight: 1.8 }}>
                          <li>The uploaded file is not the expected {documentLabel}</li>
                          <li>The form labels are in a language or format the extractor doesn&apos;t recognise</li>
                        </ul>
                        <p style={{ margin: 0 }}>💡 Try uploading the correct Eskoolia blank form filled with the details.</p>
                      </>
                    ) : (
                      <>
                        <p style={{ margin: "0 0 6px" }}>The image was scanned but no text was recognised. Common causes:</p>
                        <ul style={{ margin: "0 0 8px", paddingLeft: 18, lineHeight: 1.8 }}>
                          <li>Image is blurry, too dark, or has shadows / glare</li>
                          <li>Form is not filled — text fields are blank</li>
                          <li>Handwriting is too faint or not in BLOCK LETTERS</li>
                        </ul>
                        <p style={{ margin: 0 }}>💡 Retake the photo in good natural light with all 4 corners of the form visible.</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === "review" && (
          <div style={{ borderTop: "1px solid #e5e7eb", borderRadius: "0 0 16px 16px", overflow: "hidden" }}>

            {/* ── Missing fields decision prompt ── */}
            {showMissingPrompt && (
              <div style={{ background: "linear-gradient(135deg,#1a0540,#3b1d8a)", padding: "20px 28px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 16, marginBottom: 18 }}>
                  <div style={{ fontSize: 28, lineHeight: 1, flexShrink: 0 }}>🔍</div>
                  <div>
                    <p style={{ margin: "0 0 4px", fontWeight: 700, fontSize: 14, color: "#fff" }}>
                      {missingRequired.length} required field{missingRequired.length > 1 ? "s were" : " was"} not found in the scan
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 8 }}>
                      {missingRequired.map(k => (
                        <span key={k} style={{ background: "rgba(254,202,202,0.25)", color: "#fca5a5",
                          border: "1px solid rgba(254,202,202,0.4)",
                          padding: "2px 9px", borderRadius: 12, fontSize: 11, fontWeight: 600 }}>
                          {FIELD_LABEL_MAP[k]}
                        </span>
                      ))}
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: "#c4b5fd" }}>
                      What would you like to do?
                    </p>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button type="button" onClick={handleScanAgain}
                    style={{ flex: 1, minWidth: 180, padding: "11px 16px",
                      background: "rgba(255,255,255,0.12)", border: "1.5px solid rgba(255,255,255,0.3)",
                      borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                    <span style={{ fontSize: 16 }}>🔄</span>
                    <span>
                      <span style={{ display: "block" }}>Scan again</span>
                      <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.75 }}>Upload a clearer version of the form</span>
                    </span>
                  </button>
                  <button type="button" onClick={handleFillManually}
                    style={{ flex: 1, minWidth: 180, padding: "11px 16px",
                      background: "#10b981", border: "none",
                      borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: "pointer", color: "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                    <span style={{ fontSize: 16 }}>✏️</span>
                    <span>
                      <span style={{ display: "block" }}>Apply &amp; fill manually</span>
                      <span style={{ fontSize: 11, fontWeight: 400, opacity: 0.85 }}>
                        Apply {filledCount} extracted field{filledCount !== 1 ? "s" : ""} · complete the rest in the form
                      </span>
                    </span>
                  </button>
                  <button type="button" onClick={() => setShowMissingPrompt(false)}
                    style={{ padding: "11px 14px", background: "none",
                      border: "1.5px solid rgba(255,255,255,0.2)", borderRadius: 9,
                      fontSize: 12, cursor: "pointer", color: "rgba(255,255,255,0.6)" }}>
                    ← Back to review
                  </button>
                </div>
              </div>
            )}

            {/* ── Normal footer ── */}
            {!showMissingPrompt && (
              <div style={{ padding: "14px 24px", background: "#f9fafb",
                display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  <strong style={{ color: "#111827" }}>{filledCount}</strong> fields filled &nbsp;·&nbsp;
                  <strong style={{ color: missingRequired.length > 0 ? "#dc2626" : "#10b981" }}>
                    {missingRequired.length}</strong> required still empty
                </span>
                <div style={{ display: "flex", gap: 10 }}>
                  <button type="button" onClick={onClose}
                    style={{ padding: "9px 18px", background: "#fff", border: "1px solid #d1d5db",
                      borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer", color: "#374151" }}>
                    Cancel
                  </button>
                  <button type="button" onClick={handleApply}
                    style={{ padding: "9px 22px",
                      background: missingRequired.length === 0 ? "#10b981" : "#6c3ce1",
                      color: "#fff", border: "none", borderRadius: 8, fontSize: 13,
                      fontWeight: 700, cursor: "pointer" }}>
                    {missingRequired.length === 0
                      ? `✓ Apply all ${filledCount} fields to form`
                      : `Apply to form →`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

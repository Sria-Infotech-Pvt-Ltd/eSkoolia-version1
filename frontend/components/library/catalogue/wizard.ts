import type { AgeBand, BookFormat, BookInput, BookSource, CopyCondition } from "@/types/library";

/** Everything the accession wizard collects. Numbers are kept as strings while typing. */
export interface WizardData {
  title: string;
  author: string;
  isbn: string;
  publisher: string;
  publication_year: string;
  language: string;
  category: string; // category id, "" when unset
  age_band: AgeBand | "";
  for_students: boolean;
  for_teachers: boolean;
  for_staff: boolean;
  format: BookFormat;
  is_reference_only: boolean;
  copies_count: string;
  cost_per_copy: string;
  edition: string;
  part_label: string;
  condition: CopyCondition;
  source: BookSource;
  vendor_name: string;
  donor_name: string;
  call_number: string;
  rack: string;
  remarks: string;
}

export const WIZARD_STEPS = ["Identity", "Who it is for", "Copies and cost", "Source and code", "Review"] as const;
export const LAST_STEP = WIZARD_STEPS.length - 1;

export const AGE_BAND_LABELS: Record<AgeBand, string> = {
  early_years: "Early years",
  primary: "Primary",
  middle: "Middle",
  senior: "Senior",
  staff_adult: "Staff and adult",
};

export const FORMAT_LABELS: Record<BookFormat, string> = {
  fiction: "Fiction",
  non_fiction: "Non-fiction",
  textbook: "Textbook",
  reference: "Reference",
  periodical: "Periodical",
};

export function emptyWizard(): WizardData {
  return {
    title: "",
    author: "",
    isbn: "",
    publisher: "",
    publication_year: "",
    language: "English",
    category: "",
    age_band: "",
    for_students: true,
    for_teachers: true,
    for_staff: true,
    format: "non_fiction",
    is_reference_only: false,
    copies_count: "1",
    cost_per_copy: "0",
    edition: "",
    part_label: "",
    condition: "new",
    source: "purchased",
    vendor_name: "",
    donor_name: "",
    call_number: "",
    rack: "",
    remarks: "",
  };
}

export type WizardErrors = Partial<Record<keyof WizardData | "audience", string>>;

/** The wizard step each field is entered on. Used to send the user back to a server-reported error. */
export const FIELD_STEP: Record<keyof WizardData | "audience", number> = {
  title: 0, author: 0, isbn: 0, publisher: 0, publication_year: 0, language: 0,
  category: 1, age_band: 1, for_students: 1, for_teachers: 1, for_staff: 1, audience: 1, format: 1, is_reference_only: 1,
  copies_count: 2, cost_per_copy: 2, edition: 2, part_label: 2, condition: 2,
  source: 3, vendor_name: 3, donor_name: 3, call_number: 3, rack: 3, remarks: 3,
};

export function stepForField(field: string): number | null {
  return field in FIELD_STEP ? FIELD_STEP[field as keyof typeof FIELD_STEP] : null;
}

/**
 * Required-field rules per step, mirroring the backend (blueprint 1.1 row 3, R12, R13):
 * title; category, age band and at least one reader; copies at least 1. The server stays
 * the authority and its field errors replace these.
 *
 * `editing` relaxes the copies rule: an existing title can add 0 more copies.
 */
export function validateWizardStep(step: number, data: WizardData, options: { editing?: boolean } = {}): WizardErrors {
  const errors: WizardErrors = {};
  if (step === 0) {
    if (!data.title.trim()) errors.title = "Title is required.";
    const year = data.publication_year.trim();
    if (year && (!/^\d{4}$/.test(year) || Number(year) > new Date().getFullYear() + 1 || Number(year) < 1000)) {
      errors.publication_year = "Enter a four-digit year.";
    }
  }
  if (step === 1) {
    if (!data.category) errors.category = "Choose a category.";
    if (!data.age_band) errors.age_band = "Choose an age band.";
    if (!data.for_students && !data.for_teachers && !data.for_staff) errors.audience = "Select at least one reader group.";
  }
  if (step === 2) {
    const copies = data.copies_count.trim();
    const min = options.editing ? 0 : 1;
    if (!/^\d+$/.test(copies) || Number(copies) < min || Number(copies) > 500) {
      errors.copies_count = options.editing ? "Enter 0 to 500." : "Copies must be a whole number from 1 to 500.";
    }
    const cost = data.cost_per_copy.trim();
    if (cost !== "" && (!/^\d+(\.\d{1,2})?$/.test(cost) || Number(cost) > 9999999999.99)) {
      errors.cost_per_copy = "Cost must be a number of 0 or more, with at most two decimals.";
    }
  }
  return errors;
}

export function firstInvalidStep(data: WizardData, options: { editing?: boolean } = {}): number | null {
  for (let step = 0; step <= 2; step += 1) {
    if (Object.keys(validateWizardStep(step, data, options)).length) return step;
  }
  return null;
}

/** Request body for createBook / updateBook. Blank optional text is sent as "", numbers as numbers. */
export function toBookInput(data: WizardData): BookInput {
  return {
    title: data.title.trim(),
    author: data.author.trim(),
    isbn: data.isbn.trim(),
    publisher: data.publisher.trim(),
    publication_year: data.publication_year.trim() ? Number(data.publication_year) : null,
    language: data.language.trim() || "English",
    category: Number(data.category),
    age_band: (data.age_band || undefined) as AgeBand | undefined,
    for_students: data.for_students,
    for_teachers: data.for_teachers,
    for_staff: data.for_staff,
    format: data.format,
    is_reference_only: data.is_reference_only,
    cost_per_copy: (data.cost_per_copy.trim() || "0"),
    edition: data.edition.trim(),
    part_label: data.part_label.trim(),
    source: data.source,
    vendor_name: data.source === "purchased" ? data.vendor_name.trim() : "",
    donor_name: data.source === "donated" ? data.donor_name.trim() : "",
    call_number: data.call_number.trim(),
    rack: data.rack.trim(),
    remarks: data.remarks.trim(),
  };
}

/** Total collection value shown in the review step. Display only; the server never takes it. */
export function totalValue(data: WizardData): string {
  const copies = Number(data.copies_count) || 0;
  const cost = Number(data.cost_per_copy) || 0;
  return (copies * cost).toFixed(2);
}

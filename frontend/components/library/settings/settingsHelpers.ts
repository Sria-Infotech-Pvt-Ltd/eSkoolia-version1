import type { LibrarySettings, LibrarySettingsInput } from "@/types/library";

/** Everything the form edits, as strings while typing. The counters are shown but never sent. */
export interface SettingsForm {
  fine_per_day: string;
  fine_grace_days: string;
  fine_cap: string; // blank means no cap
  cap_fine_at_replacement_cost: boolean;
  limit_student: string;
  limit_teacher: string;
  limit_staff: string;
  student_min_due_days: string;
  flat_loan_days: string;
  max_renewals: string;
  replacement_processing_fee: string;
  replacement_default_cost: string;
  registration_fee_junior: string;
  registration_fee_senior: string;
  junior_class_ids: number[];
  notify_sms_email_enabled: boolean;
  low_stock_ratio: string;
  unscanned_flag_minutes: string;
  undo_return_minutes: string;
}

export type SettingsErrors = Partial<Record<keyof SettingsForm, string>>;

export const MONEY_FIELDS = [
  "fine_per_day", "fine_cap", "replacement_processing_fee", "replacement_default_cost",
  "registration_fee_junior", "registration_fee_senior",
] as const;

export const COUNT_FIELDS = [
  "fine_grace_days", "limit_student", "limit_teacher", "limit_staff", "student_min_due_days", "flat_loan_days",
  "max_renewals", "unscanned_flag_minutes", "undo_return_minutes",
] as const;

export function toForm(settings: LibrarySettings): SettingsForm {
  return {
    fine_per_day: settings.fine_per_day,
    fine_grace_days: String(settings.fine_grace_days),
    fine_cap: settings.fine_cap ?? "",
    cap_fine_at_replacement_cost: settings.cap_fine_at_replacement_cost,
    limit_student: String(settings.limit_student),
    limit_teacher: String(settings.limit_teacher),
    limit_staff: String(settings.limit_staff),
    student_min_due_days: String(settings.student_min_due_days),
    flat_loan_days: String(settings.flat_loan_days),
    max_renewals: String(settings.max_renewals),
    replacement_processing_fee: settings.replacement_processing_fee,
    replacement_default_cost: settings.replacement_default_cost,
    registration_fee_junior: settings.registration_fee_junior,
    registration_fee_senior: settings.registration_fee_senior,
    junior_class_ids: [...settings.junior_class_ids],
    notify_sms_email_enabled: settings.notify_sms_email_enabled,
    low_stock_ratio: settings.low_stock_ratio,
    unscanned_flag_minutes: String(settings.unscanned_flag_minutes),
    undo_return_minutes: String(settings.undo_return_minutes),
  };
}

/** Client-side checks that mirror the server (amounts and counts at least 0, ratio 0 to 1). The server's field errors win. */
export function validateSettings(form: SettingsForm): SettingsErrors {
  const errors: SettingsErrors = {};
  for (const field of MONEY_FIELDS) {
    const value = form[field].trim();
    if (field === "fine_cap" && value === "") continue;
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) errors[field] = "Enter an amount of 0 or more, with at most two decimals.";
  }
  for (const field of COUNT_FIELDS) {
    if (!/^\d{1,5}$/.test(form[field].trim())) errors[field] = "Enter a whole number of 0 or more.";
  }
  const ratio = form.low_stock_ratio.trim();
  if (!/^(0(\.\d{1,2})?|1(\.0{1,2})?)$/.test(ratio)) errors.low_stock_ratio = "Enter a number from 0 to 1, for example 0.34.";
  return errors;
}

export function toSettingsInput(form: SettingsForm): LibrarySettingsInput {
  return {
    fine_per_day: form.fine_per_day.trim(),
    fine_grace_days: Number(form.fine_grace_days),
    fine_cap: form.fine_cap.trim() === "" ? null : form.fine_cap.trim(),
    cap_fine_at_replacement_cost: form.cap_fine_at_replacement_cost,
    limit_student: Number(form.limit_student),
    limit_teacher: Number(form.limit_teacher),
    limit_staff: Number(form.limit_staff),
    student_min_due_days: Number(form.student_min_due_days),
    flat_loan_days: Number(form.flat_loan_days),
    max_renewals: Number(form.max_renewals),
    replacement_processing_fee: form.replacement_processing_fee.trim(),
    replacement_default_cost: form.replacement_default_cost.trim(),
    registration_fee_junior: form.registration_fee_junior.trim(),
    registration_fee_senior: form.registration_fee_senior.trim(),
    junior_class_ids: form.junior_class_ids,
    notify_sms_email_enabled: form.notify_sms_email_enabled,
    low_stock_ratio: form.low_stock_ratio.trim(),
    unscanned_flag_minutes: Number(form.unscanned_flag_minutes),
    undo_return_minutes: Number(form.undo_return_minutes),
  };
}

export function isDirty(a: SettingsForm, b: SettingsForm): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

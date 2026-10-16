import { isValidFee, registerFormError, toMemberInput, type RegisterForm } from "@/components/library/members/memberHelpers";
import { isDirty, toForm, toSettingsInput, validateSettings } from "@/components/library/settings/settingsHelpers";
import type { LibrarySettings } from "@/types/library";

const form = (over: Partial<RegisterForm> = {}): RegisterForm => ({ type: "student", personId: 7, fee: "", cardNo: "", collectNow: false, ...over });

describe("registration form helpers", () => {
  it("accepts blank (school default) and amounts with up to two decimals", () => {
    for (const ok of ["", "0", "300", "300.5", "300.50"]) expect(isValidFee(ok)).toBe(true);
    for (const bad of ["-1", "abc", "1.234", "1,5"]) expect(isValidFee(bad)).toBe(false);
  });

  it("needs a person and a valid fee", () => {
    expect(registerFormError(form({ personId: null }))).toMatch(/choose a person/i);
    expect(registerFormError(form({ fee: "x" }))).toMatch(/fee/i);
    expect(registerFormError(form())).toBeNull();
  });

  it("builds a student request and omits a blank fee so the server default applies", () => {
    expect(toMemberInput(form())).toEqual({ student: 7 });
    expect(toMemberInput(form({ fee: "250", cardNo: " C-1 ", collectNow: true }))).toEqual({
      student: 7, registration_fee_amount: "250", card_no: "C-1", collect_fee_now: true,
    });
  });

  it("builds a staff request with the chosen type", () => {
    expect(toMemberInput(form({ type: "teacher", personId: 3 }))).toEqual({ staff: 3, member_type: "teacher" });
  });

  it("keeps a typed zero fee (waived), unlike a blank one", () => {
    expect(toMemberInput(form({ fee: "0" })).registration_fee_amount).toBe("0");
  });
});

const settings: LibrarySettings = {
  id: 1, school: 1, fine_per_day: "10.00", fine_grace_days: 0, fine_cap: null, cap_fine_at_replacement_cost: true,
  limit_student: 2, limit_teacher: 5, limit_staff: 3, student_min_due_days: 10, flat_loan_days: 14, max_renewals: 2,
  replacement_processing_fee: "50.00", replacement_default_cost: "150.00", registration_fee_junior: "300.00",
  registration_fee_senior: "500.00", junior_class_ids: [4, 5], notify_sms_email_enabled: false, low_stock_ratio: "0.34",
  unscanned_flag_minutes: 5, undo_return_minutes: 10, po_sequence: 0, donation_receipt_sequence: 0,
  created_at: "", updated_at: "", created_by: null, updated_by: null, created_by_name: null, updated_by_name: null,
};

describe("settings form helpers", () => {
  it("round-trips the server values", () => {
    const body = toSettingsInput(toForm(settings));
    expect(body).toMatchObject({ fine_per_day: "10.00", fine_cap: null, limit_student: 2, junior_class_ids: [4, 5], low_stock_ratio: "0.34" });
    expect("po_sequence" in body).toBe(false);
  });

  it("treats a blank cap as no cap and a typed cap as a string", () => {
    expect(toSettingsInput({ ...toForm(settings), fine_cap: "" }).fine_cap).toBeNull();
    expect(toSettingsInput({ ...toForm(settings), fine_cap: "100" }).fine_cap).toBe("100");
  });

  it("accepts the defaults", () => {
    expect(validateSettings(toForm(settings))).toEqual({});
  });

  it("rejects negative or malformed amounts, counts and ratios", () => {
    const errors = validateSettings({ ...toForm(settings), fine_per_day: "-1", fine_grace_days: "x", limit_staff: "-2", low_stock_ratio: "1.5", registration_fee_junior: "1.234" });
    expect(Object.keys(errors).sort()).toEqual(["fine_grace_days", "fine_per_day", "limit_staff", "low_stock_ratio", "registration_fee_junior"]);
  });

  it("allows a ratio of 0 and 1", () => {
    expect(validateSettings({ ...toForm(settings), low_stock_ratio: "0" })).toEqual({});
    expect(validateSettings({ ...toForm(settings), low_stock_ratio: "1" })).toEqual({});
  });

  it("notices edits", () => {
    const base = toForm(settings);
    expect(isDirty(base, toForm(settings))).toBe(false);
    expect(isDirty({ ...base, junior_class_ids: [4] }, base)).toBe(true);
  });
});

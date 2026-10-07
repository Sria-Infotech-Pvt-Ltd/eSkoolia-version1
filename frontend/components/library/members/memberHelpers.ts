import type { MemberInput, MemberType, RegistrationStatus, Standing } from "@/types/library";

export const MEMBER_TYPE_LABEL: Record<MemberType, string> = { student: "Student", teacher: "Teacher", staff: "Staff" };

export const REGISTRATION_PILL: Record<RegistrationStatus, { tone: "ok" | "warn" | "neutral"; label: string }> = {
  paid: { tone: "ok", label: "Paid" },
  unpaid: { tone: "warn", label: "Unpaid" },
  waived: { tone: "neutral", label: "Waived" },
};

export const STANDING_PILL: Record<Standing, { tone: "ok" | "danger"; label: string }> = {
  active: { tone: "ok", label: "Active" },
  suspended: { tone: "danger", label: "Suspended" },
};

/** "300" or "300.5" or "300.50". Blank is allowed and means "use the school default". */
export function isValidFee(value: string): boolean {
  const text = value.trim();
  return text === "" || /^\d{1,10}(\.\d{1,2})?$/.test(text);
}

export function isZeroMoney(value: string): boolean {
  return Number(value) === 0;
}

export interface RegisterForm {
  type: MemberType;
  personId: number | null;
  fee: string;
  cardNo: string;
  collectNow: boolean;
}

/** Request body for createMember. A blank fee is omitted so the server applies the D6 default. */
export function toMemberInput(form: RegisterForm): MemberInput {
  const body: MemberInput = form.type === "student" ? { student: form.personId ?? undefined } : { staff: form.personId ?? undefined, member_type: form.type };
  if (form.fee.trim() !== "") body.registration_fee_amount = form.fee.trim();
  if (form.cardNo.trim()) body.card_no = form.cardNo.trim();
  if (form.collectNow) body.collect_fee_now = true;
  return body;
}

export function registerFormError(form: RegisterForm): string | null {
  if (form.personId === null) return "Choose a person to register.";
  if (!isValidFee(form.fee)) return "Fee must be a number of 0 or more, with at most two decimals.";
  return null;
}

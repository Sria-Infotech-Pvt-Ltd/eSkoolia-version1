/**
 * Transport palette for inline styles (Master Prompt §1). Brand values match
 * styles/tokens.css + the HR tokens in app/globals.css; the `ex*` hub values
 * match lib/examTheme.ts. Keep new Transport UI importing this instead of
 * re-declaring colors.
 */
export const T = {
  pu: "#6D4AFF", puDeep: "#4F35CC", puSoft: "#EEEAFF", puTint: "#F6F3FF",
  rowSel: "#F4F1FF", filterBg: "#FBFAFF", hlBg: "#F8F6FF", hlBd: "#DDD6FE", softBd: "#ddd6fe",
  exPu: "#5B4FCF", exPuSoft: "#EEF0FF",

  ink: "#15172A", inkTop: "#0F1222", ink2: "#5A607A", inkChip: "#5B5E72", ink3: "#9197AE", ink4: "#BCC0D0",
  muted: "#64748B", label: "#94A3B8", th: "#53627A", ghost: "#374151", kpiInk: "#111827",
  exInk1: "#1A1D1F", exInk2: "#6F767E", exInk3: "#9FA6AD",

  page: "#FAFAFB", surface2: "#F4F4F8", cardBd: "#E8E8EE", rowBd: "#EEF0F4", exBd: "#E8ECEF", exBdStrong: "#D2D7DC",
  modalBd: "#dbe4f0", shellBd: "#ECECF2", dashed: "#EEF2F7", track: "#F0F2F5",

  ok: "#15803D", okSoft: "#ECFDF5",
  green: "#059669", greenSoft: "#ecfdf5",
  warn: "#B45309", warnSoft: "#FFFBEB",
  amber: "#F59E0B", amberSoft: "#fffbeb",
  danger: "#DC2626", dangerSoft: "#FEF2F2",
  red: "#E0463A", redSoft: "#fff1f2", redBd: "#fecdd3",
  info: "#2563EB", infoSoft: "#EFF6FF",
  grey: "#64748b", greySoft: "#f1f5f9",
  dotOk: "#16A34A", dotWarn: "#D97706", dotDanger: "#DC2626",
  confirmIcon: "#EA580C",

  shadow1: "0 1px 2px rgba(15,18,34,0.04)",
  shadow2: "0 4px 12px -4px rgba(15,18,34,0.08)",
  shadow3: "0 14px 32px -10px rgba(14,16,32,0.18)",
  shadowAcc: "0 12px 28px -24px rgba(15,23,42,.38)",
  shadowModal: "0 20px 60px -10px rgba(14,16,32,0.28)",
  shadowDrawer: "-20px 0 45px -26px rgba(15,23,42,.55)",
  shadowBulk: "0 18px 40px -12px rgba(15,23,42,.5)",

  mono: '"JetBrains Mono", ui-monospace, monospace',
  serif: '"Playfair Display", Georgia, serif',
} as const;

/** Z-index scale (§1.7). */
export const Z = {
  menu: 30, bulk: 80, drawer: 100, modal: 110, confirm: 120, toast: 1100,
} as const;

/** Category colours. The API stores only a token key; tokens live in styles/tokens.css as --cat-<key>. */
export const CATEGORY_COLOR_KEYS = [
  "rose",
  "orange",
  "amber",
  "lime",
  "emerald",
  "teal",
  "sky",
  "indigo",
  "violet",
  "slate",
] as const;

export type CategoryColorKey = (typeof CATEGORY_COLOR_KEYS)[number];

export function isColorKey(key: string): key is CategoryColorKey {
  return (CATEGORY_COLOR_KEYS as readonly string[]).includes(key);
}

/** CSS colour for a stored key. Unknown or empty keys fall back to a neutral ink token. */
export function colorVar(key: string | null | undefined): string {
  return key && isColorKey(key) ? `var(--cat-${key})` : "var(--ink-4)";
}

/** The first key no existing category uses, or the least used one when all ten are taken. */
export function nextColorKey(used: (string | null | undefined)[]): CategoryColorKey {
  const counts = new Map<string, number>();
  for (const key of used) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  const free = CATEGORY_COLOR_KEYS.find((key) => !counts.has(key));
  if (free) return free;
  return [...CATEGORY_COLOR_KEYS].sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0];
}

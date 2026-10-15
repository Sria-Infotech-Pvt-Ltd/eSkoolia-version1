/**
 * Combined Transport pages (components/transport/ui/sections.tsx): which
 * screen now lives as a section of which page. The absorbed routes redirect
 * with `sectionHref`, so old links and bookmarks keep working.
 */

/** URL of a combined page targeting one section, keeping any `?id=` / `?new=` from the old route. */
export function sectionHref(path: string, section: string, query: Record<string, string | string[] | undefined> = {}): string {
  const qs = new URLSearchParams({ section });
  for (const [k, v] of Object.entries(query)) {
    if (k === "section" || v === undefined) continue;
    (Array.isArray(v) ? v : [v]).forEach((x) => qs.append(k, x));
  }
  return `${path}?${qs.toString()}`;
}

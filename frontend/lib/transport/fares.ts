/**
 * Default monthly fare for a new stop / pickup point: the saved fare slab that
 * covers a typical 3 km stop distance (§7.14 "fare slabs → new pickup-point
 * fares"); the first slab otherwise, 0 when no slabs are saved.
 */
export function defaultStopFare(slabs: { from: number; to: number; fare: number }[]): number {
  return slabs.find((s) => s.from <= 3 && 3 < s.to)?.fare ?? slabs[0]?.fare ?? 0;
}

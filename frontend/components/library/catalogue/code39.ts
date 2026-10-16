/**
 * Minimal Code 39 encoder so copy labels carry a scannable barcode without adding a dependency.
 * Copy codes (LIB-FIC-0001/C1) use only characters Code 39 supports: A-Z, 0-9, "-", "." and "/".
 */

// n = narrow, w = wide; 9 elements per character, alternating bar and space, starting with a bar.
const PATTERNS: Record<string, string> = {
  "0": "nnnwwnwnn", "1": "wnnwnnnnw", "2": "nnwwnnnnw", "3": "wnwwnnnnn", "4": "nnnwwnnnw",
  "5": "wnnwwnnnn", "6": "nnwwwnnnn", "7": "nnnwnnwnw", "8": "wnnwnnwnn", "9": "nnwwnnwnn",
  A: "wnnnnwnnw", B: "nnwnnwnnw", C: "wnwnnwnnn", D: "nnnnwwnnw", E: "wnnnwwnnn",
  F: "nnwnwwnnn", G: "nnnnnwwnw", H: "wnnnnwwnn", I: "nnwnnwwnn", J: "nnnnwwwnn",
  K: "wnnnnnnww", L: "nnwnnnnww", M: "wnwnnnnwn", N: "nnnnwnnww", O: "wnnnwnnwn",
  P: "nnwnwnnwn", Q: "nnnnnnwww", R: "wnnnnnwwn", S: "nnwnnnwwn", T: "nnnnwnwwn",
  U: "wwnnnnnnw", V: "nwwnnnnnw", W: "wwwnnnnnn", X: "nwnnwnnnw", Y: "wwnnwnnnn",
  Z: "nwwnwnnnn", "-": "nwnnnnwnw", ".": "wwnnnnwnn", " ": "nwwnnnwnn", "*": "nwnnwnwnn",
  $: "nwnwnwnnn", "/": "nwnwnnnwn", "+": "nwnnnwnwn", "%": "nnnwnwnwn",
};

export function isEncodable(text: string): boolean {
  return text.length > 0 && [...text.toUpperCase()].every((ch) => ch !== "*" && ch in PATTERNS);
}

export interface Bar {
  x: number;
  width: number;
}

/** Bars for `*TEXT*`, in module units (narrow = 1, wide = 3, one narrow space between characters). */
export function code39Bars(text: string): { bars: Bar[]; width: number } {
  if (!isEncodable(text)) return { bars: [], width: 0 };
  const bars: Bar[] = [];
  let x = 0;
  const chars = ["*", ...text.toUpperCase(), "*"];
  chars.forEach((ch, index) => {
    [...PATTERNS[ch]].forEach((element, position) => {
      const width = element === "w" ? 3 : 1;
      if (position % 2 === 0) bars.push({ x, width });
      x += width;
    });
    if (index < chars.length - 1) x += 1;
  });
  return { bars, width: x };
}

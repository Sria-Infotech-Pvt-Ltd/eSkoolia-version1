import type { BulkImportInputRow } from "@/types/library";

export const MAX_BULK_ROWS = 500;

function unquote(cell: string): string {
  return cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1).replace(/""/g, '"') : cell;
}

/** Split one line into cells. Tab-separated if the line has a tab, otherwise comma-separated with "quoted, cells". */
export function splitLine(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((cell) => unquote(cell.trim()));
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

/**
 * One title per line: Title, Author, Category, Copies, Cost. A first line that starts with "title"
 * is treated as a header. Blank lines are skipped. Missing trailing cells stay undefined so the
 * server applies its defaults (copies 1, cost 0). No cleaning happens here: the server validates
 * and neutralises every cell.
 */
export function parseBulkText(text: string): BulkImportInputRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length && /^\s*"?title"?\s*[,\t]/i.test(lines[0])) lines.shift();
  return lines.map((line) => {
    const [title, author, category, copies, cost] = splitLine(line);
    return { title, author, category, copies, cost };
  });
}

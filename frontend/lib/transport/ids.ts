/** Sequential record ids: VH-019, DR-117, AL-5413, … (Master Prompt §5). */
export function nextIdFrom(ids: string[], prefix: string, width: number): string {
  const max = ids.reduce((m, id) => {
    const n = Number(id.replace(/\D/g, ""));
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

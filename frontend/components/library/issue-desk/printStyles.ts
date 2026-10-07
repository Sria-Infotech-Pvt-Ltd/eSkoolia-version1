/** Print rules for the desk documents: everything except `.lib-print-sheet` is hidden while printing. */
export const DOCUMENT_PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .lib-print-sheet, .lib-print-sheet * { visibility: visible !important; }
  .lib-print-sheet { position: absolute; left: 0; top: 0; width: 100%; }
  .lib-no-print { display: none !important; }
}
`;

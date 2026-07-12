// PLT-7: printable label markup (SPEC.md §6 "Printable label sheets (A4 grids + single-label
// sizes)"). A label = QR + entity code + entity name; 'a4' tiles the same label into a cut-out
// grid for bulk printing.

export interface LabelContent {
  qrDataUrl: string;
  entityCode: string;
  entityName: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelCell(content: LabelContent): string {
  return `
    <div class="label">
      <img class="qr" src="${content.qrDataUrl}" alt="QR" />
      <div class="text">
        <div class="code">${escapeHtml(content.entityCode)}</div>
        <div class="name">${escapeHtml(content.entityName)}</div>
      </div>
    </div>`;
}

const SHARED_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; }
  .label {
    display: flex; align-items: center; gap: 3mm;
    width: 62mm; height: 29mm; padding: 2mm; overflow: hidden;
  }
  .qr { width: 24mm; height: 24mm; }
  .text { min-width: 0; }
  .code { font-size: 11pt; font-weight: bold; }
  .name { font-size: 8pt; color: #333; margin-top: 1mm; word-break: break-word; }
`;

export function singleLabelHtml(content: LabelContent): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${SHARED_STYLES}
    @page { size: 62mm 29mm; margin: 0; }
  </style></head><body>${labelCell(content)}</body></html>`;
}

const A4_GRID_COLUMNS = 3;
const A4_GRID_ROWS = 9;

export function a4GridLabelHtml(content: LabelContent): string {
  const cells = Array.from({ length: A4_GRID_COLUMNS * A4_GRID_ROWS }, () => labelCell(content)).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    ${SHARED_STYLES}
    @page { size: A4; margin: 8mm; }
    .grid { display: grid; grid-template-columns: repeat(${A4_GRID_COLUMNS}, 1fr); gap: 1mm; }
    .label { border: 0.2mm dashed #999; }
  </style></head><body><div class="grid">${cells}</div></body></html>`;
}

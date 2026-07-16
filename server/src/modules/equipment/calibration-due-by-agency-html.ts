import type { CalibrationDueByAgencyEntryData } from '@pharmaqms/shared';

// EQP-11 (c): agency-wise due list as a PDF — same puppeteer HTML->PDF seam as EQP-10's
// equipmentHistoryReportHtml / TRN-4's employeeRecordHtml, grouped by agency for QA to send on.
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function groupByAgency(entries: CalibrationDueByAgencyEntryData[]): Map<string, CalibrationDueByAgencyEntryData[]> {
  const groups = new Map<string, CalibrationDueByAgencyEntryData[]>();
  for (const entry of entries) {
    const key = `${entry.agencyId}::${entry.agencyName}`;
    const existing = groups.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      groups.set(key, [entry]);
    }
  }
  return groups;
}

function agencySection(agencyName: string, accreditationExpired: boolean, entries: CalibrationDueByAgencyEntryData[]): string {
  const rows = entries
    .map(
      (entry) =>
        `<tr><td>${escapeHtml(entry.equipmentCode)}</td><td>${escapeHtml(entry.equipmentName)}</td>` +
        `<td><span class="${entry.calibrationStatus === 'overdue' ? 'bad' : 'warn'}">${escapeHtml(entry.calibrationStatus.replace(/_/g, ' ').toUpperCase())}</span></td>` +
        `<td>${entry.nextDueDate.slice(0, 10)}</td></tr>`,
    )
    .join('');

  return `<section>
    <h2>${escapeHtml(agencyName)} ${accreditationExpired ? '<span class="bad">— ACCREDITATION EXPIRED</span>' : ''}</h2>
    <table><thead><tr><th>Equipment</th><th>Name</th><th>Status</th><th>Next due</th></tr></thead><tbody>${rows}</tbody></table>
  </section>`;
}

export function calibrationDueByAgencyHtml(entries: CalibrationDueByAgencyEntryData[]): string {
  const groups = groupByAgency(entries);
  const sections =
    groups.size === 0
      ? '<p class="empty">No calibrations are due or overdue against an external agency.</p>'
      : [...groups.entries()]
          .map(([key, groupEntries]) => agencySection(key.split('::')[1], groupEntries[0].accreditationExpired, groupEntries))
          .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; padding: 12mm; font-size: 9pt; color: #0f172a; }
      h1 { font-size: 15pt; } h2 { font-size: 11pt; margin: 6mm 0 2mm; border-bottom: 0.3mm solid #94a3b8; padding-bottom: 1mm; }
      .meta { color: #475569; margin: 1mm 0 4mm; }
      .empty { color: #94a3b8; font-style: italic; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
      th, td { text-align: left; padding: 1.5mm 2.5mm; border-bottom: 0.2mm solid #cbd5e1; }
      th { background: #f1f5f9; }
      .warn { color: #b45309; font-weight: 600; } .bad { color: #dc2626; font-weight: 600; }
      @page { size: A4; margin: 0; }
    </style></head><body>
      <h1>Calibration Due — By External Agency</h1>
      <p class="meta">Generated ${new Date().toISOString().slice(0, 10)} — EQP-11 (SPEC.md §7.3).</p>
      ${sections}
    </body></html>`;
}

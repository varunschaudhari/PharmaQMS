import type {
  CalibrationRecordData,
  CalibrationScheduleData,
  LogbookEntryData,
  MaintenanceTaskData,
  PmPlanData,
  PmTaskData,
  QualificationRecordData,
} from '@pharmaqms/shared';
import type { EquipmentHistoryReport } from './equipment-history-report.service';

// EQP-10: full-lifecycle equipment history — puppeteer HTML->PDF (PdfRenderService), same
// rendering seam as TRN-4's employeeRecordHtml / DOC-4's controlled-copy cover sheet.
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function dateOnly(value: string | null): string {
  return value ? value.slice(0, 10) : '—';
}

function section(title: string, bodyHtml: string): string {
  return `<section><h2>${escapeHtml(title)}</h2>${bodyHtml}</section>`;
}

function table(headers: string[], rows: string[][], emptyLabel: string): string {
  if (rows.length === 0) {
    return `<p class="empty">${escapeHtml(emptyLabel)}</p>`;
  }
  const headHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('');
  const rowsHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${headHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

function qualificationSection(records: QualificationRecordData[]): string {
  const rows = records.map((r) => [
    escapeHtml(r.qualificationType.toUpperCase()),
    dateOnly(r.performedDate),
    `<span class="${r.result === 'fail' ? 'bad' : 'good'}">${escapeHtml(r.result.toUpperCase())}</span>`,
    r.requalificationFrequencyMonths ? `${r.requalificationFrequencyMonths} month(s)` : '—',
    escapeHtml(r.notes ?? '—'),
  ]);
  return section(
    'Qualification (EQP-8)',
    table(['Type', 'Performed', 'Result', 'Requal. frequency', 'Notes'], rows, 'No qualification records.'),
  );
}

function calibrationSection(schedule: CalibrationScheduleData | null, records: CalibrationRecordData[]): string {
  const scheduleHtml = schedule
    ? `<p class="meta">Schedule: every ${schedule.frequencyMonths} month(s) — ${escapeHtml(schedule.parameters)} — next due ${dateOnly(schedule.nextDueDate)}</p>`
    : `<p class="empty">No calibration schedule configured.</p>`;
  const rows = records.map((r) => [
    dateOnly(r.performedDate),
    `<span class="${r.result === 'fail' ? 'bad' : 'good'}">${escapeHtml(r.result.toUpperCase())}</span>`,
    escapeHtml(r.status.replace(/_/g, ' ')),
    escapeHtml(r.impactAssessmentNote ?? r.toleranceNotes ?? '—'),
    escapeHtml(r.deviationRef ?? '—'),
  ]);
  return section(
    'Calibration (EQP-4/EQP-5)',
    scheduleHtml + table(['Performed', 'Result', 'Status', 'Notes', 'Deviation ref'], rows, 'No calibration records.'),
  );
}

function pmSection(plan: PmPlanData | null, tasks: PmTaskData[]): string {
  const planHtml = plan
    ? `<p class="meta">Plan: every ${plan.frequencyMonths} month(s) — ${escapeHtml(plan.checklistText)} — next due ${dateOnly(plan.nextDueDate)}</p>`
    : `<p class="empty">No PM plan configured.</p>`;
  const rows = tasks.map((t) => [
    dateOnly(t.dueDate),
    escapeHtml(t.status),
    t.completedAt ? dateOnly(t.completedAt) : '—',
    escapeHtml(t.completionNote ?? '—'),
  ]);
  return section('Preventive Maintenance (EQP-9)', planHtml + table(['Due', 'Status', 'Completed', 'Completion note'], rows, 'No PM tasks.'));
}

function logbookSection(entries: LogbookEntryData[]): string {
  const rows = entries.map((e) => [
    escapeHtml(e.entryType.replace(/_/g, ' ')),
    new Date(e.occurredAt).toISOString().slice(0, 16).replace('T', ' '),
    escapeHtml(e.performedByUserFullName),
    escapeHtml(e.description ?? e.productBatchRef ?? e.cleaningType ?? '—'),
  ]);
  return section('Digital Logbook (EQP-6)', table(['Type', 'Occurred', 'By', 'Detail'], rows, 'No logbook entries.'));
}

function maintenanceSection(tasks: MaintenanceTaskData[]): string {
  const rows = tasks.map((t) => [
    dateOnly(t.createdAt),
    escapeHtml(t.status.replace(/_/g, ' ')),
    escapeHtml(t.engineerCompletionNote ?? '—'),
    t.verifiedAt ? dateOnly(t.verifiedAt) : '—',
  ]);
  return section(
    'Breakdown Maintenance (EQP-7)',
    table(['Reported', 'Status', 'Completion note', 'Verified'], rows, 'No maintenance tasks.'),
  );
}

export function equipmentHistoryReportHtml(report: EquipmentHistoryReport): string {
  const { equipment } = report;
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; padding: 12mm; font-size: 9pt; color: #0f172a; }
      h1 { font-size: 15pt; } h2 { font-size: 11pt; margin: 6mm 0 2mm; border-bottom: 0.3mm solid #94a3b8; padding-bottom: 1mm; }
      .meta { color: #475569; margin: 1mm 0 2mm; }
      .empty { color: #94a3b8; font-style: italic; margin-bottom: 2mm; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 3mm; }
      th, td { text-align: left; padding: 1.5mm 2.5mm; border-bottom: 0.2mm solid #cbd5e1; }
      th { background: #f1f5f9; }
      .good { color: #059669; font-weight: 600; } .bad { color: #dc2626; font-weight: 600; }
      @page { size: A4; margin: 0; }
    </style></head><body>
      <h1>Equipment History Report — ${escapeHtml(equipment.equipmentCode)}: ${escapeHtml(equipment.name)}</h1>
      <p class="meta">
        Generated ${new Date().toISOString().slice(0, 10)} — EQP-10 full-lifecycle report (SPEC.md §7.3).
        Location: ${escapeHtml(equipment.location)}. Status: ${escapeHtml(equipment.status.replace(/_/g, ' '))}.
        ${equipment.isGmpCritical ? 'GMP-critical.' : ''}
      </p>
      ${qualificationSection(report.qualificationRecords)}
      ${calibrationSection(report.calibrationSchedule, report.calibrationRecords)}
      ${pmSection(report.pmPlan, report.pmTasks)}
      ${logbookSection(report.logbookEntries)}
      ${maintenanceSection(report.maintenanceTasks)}
    </body></html>`;
}

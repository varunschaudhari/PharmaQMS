import type { TrainingAssignmentData } from '@pharmaqms/shared';

// TRN-4: per-employee training record — puppeteer HTML->PDF (PdfRenderService), same rendering
// seam as DOC-4's controlled-copy cover sheet. "The first thing auditors ask for" (SPEC §7.2) —
// every assignment ever created for this person, completed or not, with signature timestamps.
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function employeeRecordHtml(userFullName: string, assignments: TrainingAssignmentData[]): string {
  const rows = assignments
    .map((a) => {
      // TRN-6: "Retraining required" is derived (an assessment attempt exists, but hasn't passed
      // yet), the same "derive, don't store" precedent as isOverdue below.
      const statusLabel =
        a.status === 'completed'
          ? 'Completed'
          : a.assessment && a.assessment.attemptCount > 0 && !a.assessment.passed
            ? 'Retraining required'
            : a.isOverdue
              ? 'Overdue'
              : 'Pending';
      const statusColor = a.status === 'completed' ? '#059669' : a.isOverdue ? '#dc2626' : '#64748b';
      const assessmentCell = a.assessment
        ? `${a.assessment.attemptCount} attempt(s)${a.assessment.bestScorePercentage !== null ? `, best ${a.assessment.bestScorePercentage}%` : ''}`
        : '—';
      return `<tr>
        <td>${escapeHtml(a.docNumber)}</td>
        <td>${escapeHtml(a.documentTitle)}</td>
        <td>v${escapeHtml(a.versionLabel)}</td>
        <td style="color:${statusColor};font-weight:600">${statusLabel}</td>
        <td>${a.assignedAt.slice(0, 10)}</td>
        <td>${a.completedAt ? a.completedAt.slice(0, 10) : '—'}</td>
        <td>${assessmentCell}</td>
      </tr>`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; padding: 15mm; font-size: 10pt; }
      h1 { font-size: 14pt; } .meta { color: #475569; margin-top: 2mm; }
      table { width: 100%; border-collapse: collapse; margin-top: 8mm; }
      th, td { text-align: left; padding: 2mm 3mm; border-bottom: 0.2mm solid #cbd5e1; }
      th { background: #f1f5f9; }
      @page { size: A4; margin: 0; }
    </style></head><body>
      <h1>Training Record — ${escapeHtml(userFullName)}</h1>
      <p class="meta">Generated ${new Date().toISOString().slice(0, 10)} — TRN-4 per-employee training record (SPEC.md §7.2)</p>
      <table>
        <thead><tr><th>Document</th><th>Title</th><th>Version</th><th>Status</th><th>Assigned</th><th>Completed</th><th>Assessment</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">No training assigned.</td></tr>'}</tbody>
      </table>
    </body></html>`;
}

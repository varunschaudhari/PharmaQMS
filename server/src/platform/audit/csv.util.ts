import type { AuditEventData } from '@pharmaqms/shared';

const COLUMNS = ['occurredAt', 'actorName', 'action', 'entityType', 'entityId', 'reason', 'changes'] as const;

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

// PLT-2: audit-trail export for inspections (SPEC.md §5.5) — one row per event.
export function auditEventsToCsv(events: AuditEventData[]): string {
  const header = COLUMNS.join(',');
  const rows = events.map((event) =>
    COLUMNS.map((column) =>
      escapeCsvValue(column === 'changes' ? JSON.stringify(event.changes) : event[column]),
    ).join(','),
  );
  return [header, ...rows].join('\n');
}

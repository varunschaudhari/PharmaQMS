import { useState } from 'react';
import { downloadAuditModuleExport, downloadAuditRecordExport } from '../../lib/audit-api';

export interface ExportAuditButtonProps {
  entityType: string;
  // Omit for a per-module export (every event ever recorded for this entityType, tenant-wide);
  // provide for a per-record export (this one entity's history only).
  entityId?: string;
  label?: string;
}

// PLT-2: audit-trail CSV export button — reused both inside HistoryTab (per-record) and on each
// business module's list page (per-module), so the download logic lives in exactly one place.
export function ExportAuditButton({ entityType, entityId, label }: ExportAuditButtonProps) {
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    try {
      setError(null);
      if (entityId) {
        await downloadAuditRecordExport(entityType, entityId);
      } else {
        await downloadAuditModuleExport(entityType);
      }
    } catch {
      setError('Failed to export audit history.');
    }
  }

  return (
    <span>
      <button type="button" onClick={() => void handleClick()} className="text-xs text-slate-600 underline">
        {label ?? 'Export CSV'}
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  );
}

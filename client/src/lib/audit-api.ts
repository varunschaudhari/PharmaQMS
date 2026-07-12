import type { AuditEventData, PaginationMeta } from '@pharmaqms/shared';
import { apiClient } from './api-client';

export interface AuditHistoryResponse {
  data: AuditEventData[];
  meta: PaginationMeta;
}

export async function fetchAuditHistory(
  entityType: string,
  entityId: string,
  page = 1,
  limit = 20,
): Promise<AuditHistoryResponse> {
  const response = await apiClient.get(`/audit/${entityType}/${entityId}/history`, {
    params: { page, limit },
  });
  return response.data;
}

function downloadCsvBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// PLT-2: per-record audit-trail export — same blob-fetch pattern as downloadEquipmentLabel
// (the CSV is JWT-authenticated, so a plain <a href> can't carry the bearer token).
export async function downloadAuditRecordExport(entityType: string, entityId: string): Promise<void> {
  const response = await apiClient.get(`/audit/${entityType}/${entityId}/history/export`, { responseType: 'blob' });
  downloadCsvBlob(response.data as Blob, `${entityType}-${entityId}-history.csv`);
}

// PLT-2: per-module audit-trail export (every event ever recorded for an entityType, tenant-wide).
export async function downloadAuditModuleExport(entityType: string): Promise<void> {
  const response = await apiClient.get(`/audit/${entityType}/export`, { responseType: 'blob' });
  downloadCsvBlob(response.data as Blob, `${entityType}-history.csv`);
}

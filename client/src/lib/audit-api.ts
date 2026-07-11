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

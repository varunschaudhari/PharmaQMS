import type {
  CreateMaterialLotRequest,
  MaterialLotData,
  MaterialLotRejectedEntryData,
  MaterialLotScanData,
  MaterialLotStatus,
  PaginationMeta,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

export interface MaterialLotListResponse {
  data: MaterialLotData[];
  meta: PaginationMeta;
}

export async function fetchMaterialLotList(options?: {
  page?: number;
  limit?: number;
  status?: MaterialLotStatus;
  search?: string;
}): Promise<MaterialLotListResponse> {
  const response = await apiClient.get('/materials', {
    params: {
      page: options?.page ?? 1,
      limit: options?.limit ?? 20,
      ...(options?.status ? { status: options.status } : {}),
      ...(options?.search ? { search: options.search } : {}),
    },
  });
  return response.data;
}

export async function fetchMaterialLot(id: string): Promise<MaterialLotData> {
  const response = await apiClient.get(`/materials/${id}`);
  return response.data.data;
}

export async function createMaterialLot(payload: CreateMaterialLotRequest): Promise<MaterialLotData> {
  const response = await apiClient.post('/materials', payload);
  return response.data.data;
}

// QRX-2: reached by the mobile scan flow — any authenticated tenant user (view-only unless the
// actor holds materials:approve, reflected server-side in `availableActions`).
export async function fetchMaterialLotScanView(id: string): Promise<MaterialLotScanData> {
  const response = await apiClient.get(`/materials/${id}/scan-view`);
  return response.data.data;
}

// QRX-2 / Iron Rule 4: the ONLY way status changes — QA-permission-gated AND e-signed.
export async function dispositionMaterialLotStatus(
  id: string,
  signingToken: string,
  status: MaterialLotStatus,
  note?: string,
): Promise<MaterialLotData> {
  const response = await apiClient.post(`/materials/${id}/status`, { signingToken, status, note });
  return response.data.data;
}

export async function fetchRejectedMaterialLots(): Promise<MaterialLotRejectedEntryData[]> {
  const response = await apiClient.get('/materials/rejected');
  return response.data.data;
}

// QRX-2: label PDFs are JWT-authenticated — fetch as a blob, same pattern as downloadEquipmentLabel.
export async function downloadMaterialLotLabel(code: string, size: 'single' | 'a4'): Promise<void> {
  const response = await apiClient.get(`/qr/codes/${code}/label.pdf`, { params: { size }, responseType: 'blob' });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qr-label-${code}-${size}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

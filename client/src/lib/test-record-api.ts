import type { CreateTestRecordRequest, TestRecordData, UpdateTestRecordRequest } from '@pharmaqms/shared';
import { apiClient } from './api-client';

export async function fetchTestRecords(): Promise<TestRecordData[]> {
  const response = await apiClient.get('/test-records');
  return response.data.data;
}

export async function fetchTestRecord(id: string): Promise<TestRecordData> {
  const response = await apiClient.get(`/test-records/${id}`);
  return response.data.data;
}

export async function createTestRecord(payload: CreateTestRecordRequest): Promise<TestRecordData> {
  const response = await apiClient.post('/test-records', payload);
  return response.data.data;
}

export async function updateTestRecord(id: string, payload: UpdateTestRecordRequest): Promise<TestRecordData> {
  const response = await apiClient.patch(`/test-records/${id}`, payload);
  return response.data.data;
}

export async function downloadQrLabel(code: string, size: 'single' | 'a4'): Promise<void> {
  const response = await apiClient.get(`/qr/codes/${code}/label.pdf`, {
    params: { size },
    responseType: 'blob',
  });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `qr-label-${code}-${size}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

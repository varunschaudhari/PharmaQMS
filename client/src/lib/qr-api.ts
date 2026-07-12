import type { DocVersionCheckData, QrResolutionData } from '@pharmaqms/shared';
import { apiClient } from './api-client';

export async function resolveQrCode(code: string): Promise<QrResolutionData> {
  const response = await apiClient.get(`/qr/resolve/${code}`);
  return response.data.data;
}

// DOC-5: the public version check — requires NO session; returns null when the code is not a
// document-version code (those scans fall back to the authenticated resolution flow).
export async function checkDocVersion(code: string): Promise<DocVersionCheckData | null> {
  try {
    const response = await apiClient.get(`/public/doc-check/${code}`);
    return response.data.data;
  } catch {
    return null;
  }
}

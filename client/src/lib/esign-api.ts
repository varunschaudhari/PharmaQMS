import type { CreateSignatureRequest, SignatureChallengeResponse, SignatureData } from '@pharmaqms/shared';
import { apiClient } from './api-client';

export async function challengeSignature(credential: string): Promise<SignatureChallengeResponse> {
  const response = await apiClient.post('/esign/challenge', { credential });
  return response.data.data;
}

export async function createSignature(payload: CreateSignatureRequest): Promise<SignatureData> {
  const response = await apiClient.post('/esign/signatures', payload);
  return response.data.data;
}

export async function fetchSignatures(entityType: string, entityId: string): Promise<SignatureData[]> {
  const response = await apiClient.get(`/esign/${entityType}/${entityId}/signatures`);
  return response.data.data;
}

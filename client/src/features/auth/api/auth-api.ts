import type { LoginRequest, LoginResponseData, RefreshRequest } from '@pharmaqms/shared';
import { apiClient } from '../../../lib/api-client';

export async function loginRequest(payload: LoginRequest): Promise<LoginResponseData> {
  const response = await apiClient.post('/auth/login', payload);
  return response.data.data;
}

export async function refreshRequest(payload: RefreshRequest): Promise<LoginResponseData> {
  const response = await apiClient.post('/auth/refresh', payload);
  return response.data.data;
}

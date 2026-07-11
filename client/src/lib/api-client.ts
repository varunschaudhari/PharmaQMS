import axios, { type AxiosRequestConfig } from 'axios';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from './token-storage';

const AUTH_ENDPOINTS = ['/auth/login', '/auth/refresh'];

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1',
});

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

interface RetryableRequestConfig extends AxiosRequestConfig {
  _retry?: boolean;
}

// Shared across concurrent 401s so a burst of requests triggers exactly one refresh call.
let refreshPromise: Promise<string> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as RetryableRequestConfig | undefined;
    const isAuthEndpoint = AUTH_ENDPOINTS.some((path) => originalRequest?.url?.includes(path));

    if (error.response?.status !== 401 || !originalRequest || originalRequest._retry || isAuthEndpoint) {
      return Promise.reject(error);
    }

    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearTokens();
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = axios
          .post(`${apiClient.defaults.baseURL}/auth/refresh`, { refreshToken })
          .then((response) => {
            const tokens = response.data.data.tokens;
            setTokens(tokens);
            return tokens.accessToken as string;
          })
          .finally(() => {
            refreshPromise = null;
          });
      }
      const newAccessToken = await refreshPromise;
      originalRequest.headers = { ...originalRequest.headers, Authorization: `Bearer ${newAccessToken}` };
      return apiClient(originalRequest);
    } catch (refreshError) {
      clearTokens();
      return Promise.reject(refreshError);
    }
  },
);

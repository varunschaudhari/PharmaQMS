import { isAxiosError } from 'axios';

// Extracts the { error: { code, message } } shape produced by the server's AllExceptionsFilter.
export function extractErrorMessage(error: unknown): string | undefined {
  if (isAxiosError(error)) {
    return (error.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
  }
  return undefined;
}

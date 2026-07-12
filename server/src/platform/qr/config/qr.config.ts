import { registerAs } from '@nestjs/config';

export interface QrConfig {
  // Base URL of the CLIENT app — QR images encode {appBaseUrl}/s/{code} (SPEC.md §6 "short URLs
  // https://{app-domain}/s/{entityCode}").
  appBaseUrl: string;
}

export const qrConfig = registerAs<QrConfig>('qr', () => ({
  appBaseUrl: (process.env.APP_BASE_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
}));

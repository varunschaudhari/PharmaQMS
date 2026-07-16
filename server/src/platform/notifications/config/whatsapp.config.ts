import { registerAs } from '@nestjs/config';

export type WhatsAppTransportKind = 'console' | 'file' | 'meta';

export interface WhatsAppConfig {
  transport: WhatsAppTransportKind;
  // Only used by the file transport.
  outboxPath: string;
  // Meta WhatsApp Cloud API credentials — env-only, never hardcoded, never tenant-stored
  // (CLAUDE.md). Both are required for the 'meta' transport; validated at module init.
  apiBaseUrl: string;
  phoneNumberId: string | null;
  accessToken: string | null;
  // BCP-47 language code used when a tenant hasn't overridden it.
  defaultTemplateLanguage: string;
  // Verifies Meta's webhook subscription handshake (GET .../webhook?hub.verify_token=...).
  webhookVerifyToken: string | null;
  // Verifies the X-Hub-Signature-256 header on incoming status-callback POSTs; if unset, POSTs
  // are accepted unsigned (dev-only — the 'meta' transport should always set this in production).
  appSecret: string | null;
  // Rate limit applied to the WhatsApp send worker (messages per second).
  rateLimitPerSecond: number;
}

export const whatsappConfig = registerAs<WhatsAppConfig>('whatsapp', () => ({
  transport:
    process.env.WHATSAPP_TRANSPORT === 'meta' ? 'meta' : process.env.WHATSAPP_TRANSPORT === 'file' ? 'file' : 'console',
  outboxPath: process.env.WHATSAPP_OUTBOX_PATH ?? 'whatsapp-outbox.ndjson',
  apiBaseUrl: process.env.WHATSAPP_API_BASE_URL ?? 'https://graph.facebook.com/v20.0',
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? null,
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? null,
  defaultTemplateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en',
  webhookVerifyToken: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? null,
  appSecret: process.env.WHATSAPP_APP_SECRET ?? null,
  rateLimitPerSecond: Number(process.env.WHATSAPP_RATE_LIMIT_PER_SECOND ?? 20),
}));

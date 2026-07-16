// PLT-6-WA: provider-agnostic WhatsApp boundary, mirroring mailer/mailer.interface.ts's Mailer
// seam. Production binds the Meta WhatsApp Cloud API implementation behind this same interface;
// dev/test bind the console or file transport. Nothing outside whatsapp/ may import a concrete
// transport.
export interface WhatsAppMessage {
  // E.164 phone number, e.g. +919876543210.
  to: string;
  // The Meta-registered template name (already resolved per-tenant — see
  // tenant-settings.util.ts's resolveWhatsAppTemplateName).
  templateName: string;
  // BCP-47 language code Meta expects, e.g. 'en' or 'en_US'.
  templateLanguage: string;
  // Positional {{1}}, {{2}}, ... body parameters, in order.
  params: string[];
}

export interface WhatsAppSendResult {
  // Meta's message id (e.g. "wamid.xxx") — null for transports that don't produce one
  // (console/file dev transports). The delivery-status webhook matches on this id.
  providerMessageId: string | null;
  // Raw provider response, kept verbatim for support/debugging.
  raw: unknown;
}

export interface WhatsAppProvider {
  // Throws on failure (network error, non-2xx response, rejected template) so the caller
  // (WhatsAppDeliveryService) can mark the notification FAILED and let BullMQ's retry/backoff
  // config re-attempt the send.
  send(message: WhatsAppMessage): Promise<WhatsAppSendResult>;
}

export const WHATSAPP_PROVIDER = 'PLT6_WHATSAPP_PROVIDER';

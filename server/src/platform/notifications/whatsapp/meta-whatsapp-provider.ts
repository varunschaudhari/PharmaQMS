import { Injectable, Logger } from '@nestjs/common';
import type { WhatsAppMessage, WhatsAppProvider, WhatsAppSendResult } from './whatsapp-provider.interface';

export interface MetaWhatsAppProviderConfig {
  apiBaseUrl: string;
  phoneNumberId: string;
  accessToken: string;
}

interface MetaSendResponse {
  messages?: Array<{ id: string }>;
  error?: { message: string; type?: string; code?: number };
}

// PLT-6-WA: the Meta WhatsApp Cloud API implementation (SPEC.md §6 "WhatsApp — Cloud API, v1
// optional"). Credentials (phone number id, access token) are env-config only — see
// whatsapp.config.ts — never hardcoded and never tenant-stored (CLAUDE.md).
@Injectable()
export class MetaWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger(MetaWhatsAppProvider.name);

  constructor(private readonly config: MetaWhatsAppProviderConfig) {}

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    // Meta's Cloud API expects the recipient number without the leading '+'.
    const to = message.to.replace(/^\+/, '');
    const url = `${this.config.apiBaseUrl}/${this.config.phoneNumberId}/messages`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name: message.templateName,
          language: { code: message.templateLanguage },
          components: [
            {
              type: 'body',
              parameters: message.params.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
    });

    const raw = (await response.json().catch(() => null)) as MetaSendResponse | null;

    if (!response.ok || !raw?.messages?.[0]?.id) {
      const errorMessage = raw?.error?.message ?? `WhatsApp send failed with HTTP ${response.status}`;
      this.logger.error(`WhatsApp send to ${to} via template "${message.templateName}" failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    return { providerMessageId: raw.messages[0].id, raw };
  }
}

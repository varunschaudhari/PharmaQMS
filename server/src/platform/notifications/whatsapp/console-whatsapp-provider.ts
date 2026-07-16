import { Injectable, Logger } from '@nestjs/common';
import type { WhatsAppMessage, WhatsAppProvider, WhatsAppSendResult } from './whatsapp-provider.interface';

// PLT-6-WA: dev transport — prints outbound WhatsApp sends to the server log instead of sending
// them, mirroring mailer/console-mailer.ts.
@Injectable()
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  private readonly logger = new Logger('WhatsApp');

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    this.logger.log(
      `[whatsapp] to=${message.to} template=${message.templateName} lang=${message.templateLanguage} params=${JSON.stringify(message.params)}`,
    );
    return { providerMessageId: null, raw: { transport: 'console' } };
  }
}

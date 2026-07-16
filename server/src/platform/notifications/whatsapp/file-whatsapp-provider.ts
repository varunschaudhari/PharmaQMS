import { Injectable } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { WhatsAppMessage, WhatsAppProvider, WhatsAppSendResult } from './whatsapp-provider.interface';

// PLT-6-WA: dev/file transport — appends one JSON line per outbound WhatsApp send to an outbox
// file, so the full message stream is inspectable (and assertable in tests) without any Meta
// account, mirroring mailer/file-mailer.ts.
@Injectable()
export class FileWhatsAppProvider implements WhatsAppProvider {
  constructor(private readonly outboxPath: string) {}

  async send(message: WhatsAppMessage): Promise<WhatsAppSendResult> {
    await mkdir(dirname(this.outboxPath), { recursive: true });
    const line = JSON.stringify({ ...message, sentAt: new Date().toISOString() });
    await appendFile(this.outboxPath, `${line}\n`, 'utf8');
    return { providerMessageId: null, raw: { transport: 'file' } };
  }
}

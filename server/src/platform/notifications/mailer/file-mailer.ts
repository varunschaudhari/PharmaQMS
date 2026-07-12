import { Injectable } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Mailer, MailMessage } from './mailer.interface';

// PLT-6: dev/file transport — appends one JSON line per outbound mail to an outbox file, so the
// full mail stream is inspectable (and assertable in tests) without any provider account.
@Injectable()
export class FileMailer implements Mailer {
  constructor(private readonly outboxPath: string) {}

  async send(message: MailMessage): Promise<void> {
    await mkdir(dirname(this.outboxPath), { recursive: true });
    const line = JSON.stringify({ ...message, sentAt: new Date().toISOString() });
    await appendFile(this.outboxPath, `${line}\n`, 'utf8');
  }
}

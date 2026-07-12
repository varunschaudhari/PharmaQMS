import { Injectable, Logger } from '@nestjs/common';
import type { Mailer, MailMessage } from './mailer.interface';

// PLT-6: dev transport — prints outbound mail to the server log instead of sending it.
@Injectable()
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('Mailer');

  async send(message: MailMessage): Promise<void> {
    this.logger.log(`[mail] to=${message.to} subject="${message.subject}"\n${message.text}`);
  }
}

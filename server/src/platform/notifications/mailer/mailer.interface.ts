// PLT-6: provider-agnostic mailer boundary (SPEC.md §6 "email (transactional provider) in v1").
// Production will bind a real transactional provider behind this same interface; dev/test bind
// the console or file transport. Nothing outside mailer/ may import a concrete transport.
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const MAILER = 'PLT6_MAILER';

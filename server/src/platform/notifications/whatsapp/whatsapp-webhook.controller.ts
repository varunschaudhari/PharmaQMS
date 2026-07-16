import { Controller, Get, Header, HttpCode, HttpStatus, Inject, Logger, Post, Query, Req } from '@nestjs/common';
import { WhatsAppDeliveryStatus } from '@pharmaqms/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { whatsappConfig, type WhatsAppConfig } from '../config/whatsapp.config';
import { WhatsAppDeliveryService } from '../whatsapp-delivery.service';

interface MetaStatusEntry {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{ value?: { statuses?: MetaStatusEntry[] } }>;
  }>;
}

const META_STATUS_MAP: Record<MetaStatusEntry['status'], WhatsAppDeliveryStatus> = {
  sent: WhatsAppDeliveryStatus.SENT,
  delivered: WhatsAppDeliveryStatus.DELIVERED,
  read: WhatsAppDeliveryStatus.READ,
  failed: WhatsAppDeliveryStatus.FAILED,
};

// PLT-6-WA: Meta's WhatsApp Cloud API delivery-status callback — no login is possible here (Meta
// calls this URL directly), so it is @Public() and instead trusts (a) the GET verification
// handshake's shared verify_token and (b) the POST body's HMAC signature (X-Hub-Signature-256,
// verified against WHATSAPP_APP_SECRET). This is cross-tenant infrastructure by nature: Meta has
// no concept of our tenants, so status updates are matched purely by providerMessageId (already
// globally unique — assigned by Meta per message).
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly whatsAppDeliveryService: WhatsAppDeliveryService,
    @Inject(whatsappConfig.KEY) private readonly config: WhatsAppConfig,
  ) {}

  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && this.config.webhookVerifyToken && verifyToken === this.config.webhookVerifyToken) {
      return challenge;
    }
    throw new Error('WhatsApp webhook verification failed: verify_token mismatch.');
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', 'text/plain')
  @Post()
  async receive(@Req() request: RawBodyRequest<Request>): Promise<string> {
    if (!this.verifySignature(request)) {
      this.logger.warn('WhatsApp webhook: rejected a POST with an invalid or missing signature.');
      return 'ignored';
    }

    const payload = request.body as MetaWebhookPayload;
    const statuses = (payload.entry ?? []).flatMap((entry) =>
      (entry.changes ?? []).flatMap((change) => change.value?.statuses ?? []),
    );

    for (const status of statuses) {
      const mapped = META_STATUS_MAP[status.status];
      if (mapped) {
        await this.whatsAppDeliveryService.recordDeliveryStatus(status.id, mapped, status);
      }
    }

    // Meta requires a 200 response with any body to consider the webhook delivered.
    return 'ok';
  }

  // Dev convenience: if no app secret is configured, accept unsigned payloads (console/file
  // transports never receive real Meta callbacks anyway). Production ('meta' transport) should
  // always set WHATSAPP_APP_SECRET.
  private verifySignature(request: RawBodyRequest<Request>): boolean {
    if (!this.config.appSecret) {
      return true;
    }
    const signatureHeader = request.headers['x-hub-signature-256'];
    if (typeof signatureHeader !== 'string' || !request.rawBody) {
      return false;
    }
    const expected = `sha256=${createHmac('sha256', this.config.appSecret).update(request.rawBody).digest('hex')}`;
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signatureHeader);
    return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
  }
}

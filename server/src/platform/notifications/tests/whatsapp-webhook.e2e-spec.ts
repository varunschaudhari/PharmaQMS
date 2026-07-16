import { HttpStatus, INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEvent, WhatsAppDeliveryStatus, WhatsAppTemplateKey } from '@pharmaqms/shared';
import { createHmac } from 'node:crypto';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { AllExceptionsFilter } from '../../../common/filters/all-exceptions.filter';
import { Notification, NotificationDocument } from '../schemas/notification.schema';

const APP_SECRET = 'test-whatsapp-app-secret';
const VERIFY_TOKEN = 'test-verify-token';

function metaStatusPayload(providerMessageId: string, status: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              statuses: [{ id: providerMessageId, status, timestamp: '1700000000', recipient_id: '919876543210' }],
            },
          },
        ],
      },
    ],
  };
}

// PLT-6-WA: Meta's delivery-status webhook — the GET verification handshake, the POST status
// callback (raw-body HMAC signature verification), and end-to-end status recording via the real
// HTTP surface (unlike whatsapp-delivery.service.spec.ts's direct recordDeliveryStatus() tests).
describe('PLT-6-WA WhatsApp delivery-status webhook', () => {
  let app: INestApplication;
  let mongod: MongoMemoryServer;
  let notificationModel: Model<NotificationDocument>;

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    notificationModel = moduleFixture.get<Model<NotificationDocument>>(getModelToken(Notification.name));
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  });

  it('PLT-6-WA: GET verification handshake echoes the challenge back only for the correct verify_token', async () => {
    const correct = await request(server())
      .get('/api/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': 'challenge-123' });
    expect(correct.status).toBe(HttpStatus.OK);
    expect(correct.text).toBe('challenge-123');

    const wrong = await request(server())
      .get('/api/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'challenge-123' });
    expect(wrong.status).toBeGreaterThanOrEqual(400);
  });

  it('PLT-6-WA: a POST with a valid X-Hub-Signature-256 signature updates the matching notification\'s status', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const userId = new mongoose.Types.ObjectId().toString();
    const notification = await notificationModel.create({
      tenantId,
      userId,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'DocumentVersion',
      entityId: 'v-1',
      title: 'Approval task',
      body: 'Approval task body',
      whatsappTemplateKey: WhatsAppTemplateKey.TASK_ASSIGNED,
      whatsappStatus: WhatsAppDeliveryStatus.SENT,
      whatsappProviderMessageId: 'wamid.SIGNED_OK',
    });

    const rawBody = JSON.stringify(metaStatusPayload('wamid.SIGNED_OK', 'delivered'));
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;

    const response = await request(server())
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(rawBody);

    expect(response.status).toBe(HttpStatus.OK);
    const reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.DELIVERED);
  });

  it('PLT-6-WA: a POST with an invalid signature is rejected — the notification status is left untouched', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    const userId = new mongoose.Types.ObjectId().toString();
    const notification = await notificationModel.create({
      tenantId,
      userId,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'DocumentVersion',
      entityId: 'v-1',
      title: 'Approval task',
      body: 'Approval task body',
      whatsappTemplateKey: WhatsAppTemplateKey.TASK_ASSIGNED,
      whatsappStatus: WhatsAppDeliveryStatus.SENT,
      whatsappProviderMessageId: 'wamid.SIGNED_BAD',
    });

    const rawBody = JSON.stringify(metaStatusPayload('wamid.SIGNED_BAD', 'delivered'));

    const response = await request(server())
      .post('/api/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', 'sha256=0000000000000000000000000000000000000000000000000000000000000000')
      .send(rawBody);

    // Still 200 (Meta requires 200 to consider the webhook delivered) but the payload is ignored.
    expect(response.status).toBe(HttpStatus.OK);
    const reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.SENT);
  });
});

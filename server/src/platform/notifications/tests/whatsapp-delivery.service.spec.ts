import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEvent, WhatsAppDeliveryStatus, WhatsAppTemplateKey } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { Role, RoleDocument, RoleSchema } from '../../auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../auth/schemas/user.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { whatsappConfig } from '../config/whatsapp.config';
import { Notification, NotificationDocument, NotificationSchema } from '../schemas/notification.schema';
import type { WhatsAppMessage, WhatsAppSendResult } from '../whatsapp/whatsapp-provider.interface';
import { WHATSAPP_PROVIDER } from '../whatsapp/whatsapp-provider.interface';
import { WhatsAppDeliveryService } from '../whatsapp-delivery.service';

describe('PLT-6-WA WhatsAppDeliveryService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let whatsappDelivery: WhatsAppDeliveryService;
  let notificationModel: Model<NotificationDocument>;
  let userModel: Model<UserDocument>;
  let roleModel: Model<RoleDocument>;
  let tenantModel: Model<TenantDocument>;
  const send = jest.fn<Promise<WhatsAppSendResult>, [WhatsAppMessage]>();

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: Notification.name, schema: NotificationSchema },
          { name: User.name, schema: UserSchema },
          { name: Role.name, schema: RoleSchema },
          { name: Tenant.name, schema: TenantSchema },
        ]),
      ],
      providers: [
        WhatsAppDeliveryService,
        { provide: WHATSAPP_PROVIDER, useValue: { send } },
        {
          provide: whatsappConfig.KEY,
          useValue: {
            transport: 'console',
            outboxPath: 'unused.ndjson',
            apiBaseUrl: 'https://graph.facebook.com/v20.0',
            phoneNumberId: null,
            accessToken: null,
            defaultTemplateLanguage: 'en',
            webhookVerifyToken: null,
            appSecret: null,
            rateLimitPerSecond: 20,
          },
        },
      ],
    }).compile();

    whatsappDelivery = moduleRef.get(WhatsAppDeliveryService);
    notificationModel = moduleRef.get(getModelToken(Notification.name));
    userModel = moduleRef.get(getModelToken(User.name));
    roleModel = moduleRef.get(getModelToken(Role.name));
    tenantModel = moduleRef.get(getModelToken(Tenant.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await notificationModel.collection.deleteMany({});
    await userModel.collection.deleteMany({});
    await roleModel.collection.deleteMany({});
    await tenantModel.collection.deleteMany({});
    send.mockReset();
  });

  async function seedUser(
    tenantId: mongoose.Types.ObjectId,
    overrides: Partial<{ whatsappOptIn: boolean; whatsappPhoneNumber: string | null }> = {},
  ): Promise<UserDocument> {
    const role = await roleModel.create({ tenantId, name: `Role-${new mongoose.Types.ObjectId().toString()}`, permissions: [] });
    return userModel.create({
      tenantId,
      email: `user-${new mongoose.Types.ObjectId().toString()}@example.com`,
      fullName: 'Olive Operator',
      passwordHash: 'irrelevant-hash',
      roleId: role._id,
      whatsappOptIn: 'whatsappOptIn' in overrides ? overrides.whatsappOptIn : true,
      whatsappPhoneNumber: 'whatsappPhoneNumber' in overrides ? overrides.whatsappPhoneNumber : '+919876543210',
    });
  }

  async function seedNotification(
    tenantId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
    overrides: Partial<{ whatsappTemplateKey: WhatsAppTemplateKey | null; whatsappStatus: WhatsAppDeliveryStatus | null }> = {},
  ): Promise<NotificationDocument> {
    return notificationModel.create({
      tenantId,
      userId,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'DocumentVersion',
      entityId: 'v-1',
      title: 'Approval task',
      body: 'Approval task body',
      whatsappTemplateKey: 'whatsappTemplateKey' in overrides ? overrides.whatsappTemplateKey : WhatsAppTemplateKey.TASK_ASSIGNED,
      whatsappTemplateParams: ['DocumentVersion', 'v-1', 'Dept Head Review'],
      whatsappStatus: 'whatsappStatus' in overrides ? overrides.whatsappStatus : WhatsAppDeliveryStatus.PENDING,
    });
  }

  it('PLT-6-WA: sends via the provider for an opted-in user with a phone number, and marks the notification SENT', async () => {
    send.mockResolvedValue({ providerMessageId: 'wamid.ABC123', raw: { messages: [{ id: 'wamid.ABC123' }] } });
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-wa-1' });
    const user = await seedUser(tenant._id);
    const notification = await seedNotification(tenant._id, user._id);

    await whatsappDelivery.sendForNotification(notification._id.toString());

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      to: '+919876543210',
      templateName: 'pharmaqms_task_assigned',
      templateLanguage: 'en',
      params: ['DocumentVersion', 'v-1', 'Dept Head Review'],
    });

    const reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.SENT);
    expect(reloaded!.whatsappProviderMessageId).toBe('wamid.ABC123');
    expect(reloaded!.whatsappSentAt).not.toBeNull();
  });

  it('PLT-6-WA opt-out respected: a user who has not opted in is never sent to, silently', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-wa-2' });
    const user = await seedUser(tenant._id, { whatsappOptIn: false });
    const notification = await seedNotification(tenant._id, user._id);

    await whatsappDelivery.sendForNotification(notification._id.toString());

    expect(send).not.toHaveBeenCalled();
    const reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.PENDING); // untouched, not FAILED
  });

  it('PLT-6-WA opt-out respected: an opted-in user with no phone number on file is never sent to', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-wa-3' });
    const user = await seedUser(tenant._id, { whatsappOptIn: true, whatsappPhoneNumber: null });
    const notification = await seedNotification(tenant._id, user._id);

    await whatsappDelivery.sendForNotification(notification._id.toString());

    expect(send).not.toHaveBeenCalled();
  });

  it('PLT-6-WA failure retry: a provider failure marks the notification FAILED, increments attempts, and rethrows (so BullMQ retries)', async () => {
    send.mockRejectedValue(new Error('Meta rate limit exceeded'));
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-wa-4' });
    const user = await seedUser(tenant._id);
    const notification = await seedNotification(tenant._id, user._id);

    await expect(whatsappDelivery.sendForNotification(notification._id.toString())).rejects.toThrow('Meta rate limit exceeded');

    const reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.FAILED);
    expect(reloaded!.whatsappAttempts).toBe(1);
    expect(reloaded!.whatsappProviderResponse).toMatchObject({ message: 'Meta rate limit exceeded' });
  });

  it('PLT-6-WA: an already-SENT notification is never re-sent (idempotent, safe job retries)', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-wa-5' });
    const user = await seedUser(tenant._id);
    const notification = await seedNotification(tenant._id, user._id, { whatsappStatus: WhatsAppDeliveryStatus.SENT });

    await whatsappDelivery.sendForNotification(notification._id.toString());

    expect(send).not.toHaveBeenCalled();
  });

  it('PLT-6-WA: a notification with no WhatsApp template is a no-op (nothing to send)', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-wa-6' });
    const user = await seedUser(tenant._id);
    const notification = await seedNotification(tenant._id, user._id, { whatsappTemplateKey: null, whatsappStatus: null });

    await whatsappDelivery.sendForNotification(notification._id.toString());

    expect(send).not.toHaveBeenCalled();
  });

  it('PLT-6-WA delivery-status webhook support: recordDeliveryStatus() matches by providerMessageId and advances the status', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-wa-7' });
    const user = await seedUser(tenant._id);
    const notification = await notificationModel.create({
      tenantId: tenant._id,
      userId: user._id,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'DocumentVersion',
      entityId: 'v-1',
      title: 'Approval task',
      body: 'Approval task body',
      whatsappTemplateKey: WhatsAppTemplateKey.TASK_ASSIGNED,
      whatsappStatus: WhatsAppDeliveryStatus.SENT,
      whatsappProviderMessageId: 'wamid.XYZ789',
    });

    await whatsappDelivery.recordDeliveryStatus('wamid.XYZ789', WhatsAppDeliveryStatus.DELIVERED, { status: 'delivered' });
    let reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.DELIVERED);

    await whatsappDelivery.recordDeliveryStatus('wamid.XYZ789', WhatsAppDeliveryStatus.READ, { status: 'read' });
    reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.READ);

    // A late/out-of-order 'sent' echo must never regress a more-advanced status backwards.
    await whatsappDelivery.recordDeliveryStatus('wamid.XYZ789', WhatsAppDeliveryStatus.SENT, { status: 'sent' });
    reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.whatsappStatus).toBe(WhatsAppDeliveryStatus.READ);
  });

  it('PLT-6-WA: recordDeliveryStatus() for an unknown providerMessageId is silently ignored', async () => {
    await expect(whatsappDelivery.recordDeliveryStatus('wamid.does-not-exist', WhatsAppDeliveryStatus.DELIVERED, {})).resolves.toBeUndefined();
  });
});

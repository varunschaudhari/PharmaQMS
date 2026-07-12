import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { NotificationEmailMode, NotificationEvent } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Role, RoleDocument, RoleSchema } from '../../auth/schemas/role.schema';
import { User, UserDocument, UserSchema } from '../../auth/schemas/user.schema';
import { Tenant, TenantDocument, TenantSchema } from '../../tenant/schemas/tenant.schema';
import { EmailDeliveryService } from '../email-delivery.service';
import { FileMailer } from '../mailer/file-mailer';
import { MAILER, type MailMessage } from '../mailer/mailer.interface';
import { Notification, NotificationDocument, NotificationSchema } from '../schemas/notification.schema';

describe('PLT-6 EmailDeliveryService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let emailDelivery: EmailDeliveryService;
  let notificationModel: Model<NotificationDocument>;
  let userModel: Model<UserDocument>;
  let roleModel: Model<RoleDocument>;
  let tenantModel: Model<TenantDocument>;
  const send = jest.fn<Promise<void>, [MailMessage]>().mockResolvedValue(undefined);

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
      providers: [EmailDeliveryService, { provide: MAILER, useValue: { send } }],
    }).compile();

    emailDelivery = moduleRef.get(EmailDeliveryService);
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
    send.mockClear();
  });

  async function seedUser(tenantId: mongoose.Types.ObjectId, email: string): Promise<UserDocument> {
    const role = await roleModel.create({ tenantId, name: `Role-${email}`, permissions: [] });
    return userModel.create({
      tenantId,
      email,
      fullName: `User ${email}`,
      passwordHash: 'irrelevant-hash',
      roleId: role._id,
    });
  }

  async function seedNotification(
    tenantId: mongoose.Types.ObjectId,
    userId: mongoose.Types.ObjectId,
    title: string,
  ): Promise<NotificationDocument> {
    return notificationModel.create({
      tenantId,
      userId,
      event: NotificationEvent.TASK_ASSIGNED,
      entityType: 'Document',
      entityId: 'SOP-QA-001',
      title,
      body: `${title} — body`,
    });
  }

  it('PLT-6: sendForNotification() mails the recipient and stamps emailedAt; re-delivery is a no-op (safe job retries)', async () => {
    const tenant = await tenantModel.create({ name: 'Acme', slug: 'acme-mail-1' });
    const user = await seedUser(tenant._id, 'dana@example.com');
    const notification = await seedNotification(tenant._id, user._id, 'Approval task: SOP-QA-001');

    await emailDelivery.sendForNotification(notification._id.toString());

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dana@example.com', subject: 'Approval task: SOP-QA-001' }),
    );
    const reloaded = await notificationModel.findById(notification._id);
    expect(reloaded!.emailedAt).not.toBeNull();

    await emailDelivery.sendForNotification(notification._id.toString());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('PLT-6: sendDailyDigests() batches all unsent notifications into ONE email per user for digest-mode tenants only', async () => {
    const digestTenant = await tenantModel.create({
      name: 'Digest Ltd',
      slug: 'digest-mail-1',
      settings: { notificationEmailMode: NotificationEmailMode.DAILY_DIGEST },
    });
    const immediateTenant = await tenantModel.create({ name: 'Immediate Inc', slug: 'immediate-mail-1' });

    const alice = await seedUser(digestTenant._id, 'alice@example.com');
    const bob = await seedUser(digestTenant._id, 'bob@example.com');
    const carol = await seedUser(immediateTenant._id, 'carol@example.com');

    await seedNotification(digestTenant._id, alice._id, 'Task one');
    await seedNotification(digestTenant._id, alice._id, 'Task two');
    await seedNotification(digestTenant._id, bob._id, 'Task three');
    // Unsent notification in an immediate-mode tenant — the digest sweep must NOT touch it
    // (its own email path is the per-notification queue).
    await seedNotification(immediateTenant._id, carol._id, 'Task four');

    const sent = await emailDelivery.sendDailyDigests(new Date('2026-07-11T01:30:00.000Z'));

    expect(sent).toBe(2);
    expect(send).toHaveBeenCalledTimes(2);
    const aliceMail = send.mock.calls.map(([m]) => m).find((m) => m.to === 'alice@example.com');
    expect(aliceMail!.subject).toContain('2 updates');
    expect(aliceMail!.text).toContain('Task one');
    expect(aliceMail!.text).toContain('Task two');

    expect(await notificationModel.countDocuments({ tenantId: digestTenant._id, emailedAt: null })).toBe(0);
    expect(await notificationModel.countDocuments({ tenantId: immediateTenant._id, emailedAt: null })).toBe(1);

    // Second sweep: nothing left unsent — no more emails.
    send.mockClear();
    expect(await emailDelivery.sendDailyDigests()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('PLT-6 FileMailer transport', () => {
  const outbox = join(tmpdir(), `pharmaqms-test-outbox-${process.pid}.ndjson`);

  afterEach(async () => {
    await rm(outbox, { force: true });
  });

  it('PLT-6: appends one JSON line per message to the outbox file', async () => {
    const mailer = new FileMailer(outbox);
    await mailer.send({ to: 'a@example.com', subject: 'First', text: 'Body one' });
    await mailer.send({ to: 'b@example.com', subject: 'Second', text: 'Body two' });

    const lines = (await readFile(outbox, 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]);
    expect(first).toMatchObject({ to: 'a@example.com', subject: 'First', text: 'Body one' });
    expect(typeof first.sentAt).toBe('string');
  });
});

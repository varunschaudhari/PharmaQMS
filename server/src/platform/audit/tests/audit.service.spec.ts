import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AuditService } from '../audit.service';
import { AuditEvent, AuditEventDocument, AuditEventSchema } from '../schemas/audit-event.schema';

describe('PLT-2 AuditService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let auditService: AuditService;
  let auditEventModel: Model<AuditEventDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: AuditEvent.name, schema: AuditEventSchema }]),
      ],
      providers: [AuditService],
    }).compile();

    auditService = moduleRef.get(AuditService);
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await auditEventModel.collection.deleteMany({});
  });

  it('PLT-2: record() writes an event with the actor, entity, action, and field-level diff', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();

    await auditService.record({
      tenantId,
      actor: { userId: 'user-1', fullName: 'QA Head' },
      entityType: 'Document',
      entityId: 'doc-1',
      action: AuditAction.UPDATE,
      before: { title: 'Old Title' },
      after: { title: 'New Title' },
      reason: 'Corrected typo',
    });

    const { items, total } = await auditService.findHistory(tenantId, 'Document', 'doc-1', 1, 20);
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      tenantId,
      actorId: 'user-1',
      actorName: 'QA Head',
      entityType: 'Document',
      entityId: 'doc-1',
      action: AuditAction.UPDATE,
      changes: [{ field: 'title', oldValue: 'Old Title', newValue: 'New Title' }],
      reason: 'Corrected typo',
    });
    expect(typeof items[0].occurredAt).toBe('string');
  });

  it('PLT-2: record() defaults reason to null and changes to [] when before/after are omitted', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    await auditService.record({
      tenantId,
      actor: { userId: 'user-1', fullName: 'QA Head' },
      entityType: 'User',
      entityId: 'user-1',
      action: AuditAction.LOGIN_SUCCESS,
    });

    const { items } = await auditService.findHistory(tenantId, 'User', 'user-1', 1, 20);
    expect(items[0].reason).toBeNull();
    expect(items[0].changes).toEqual([]);
  });

  it('PLT-2: findHistory paginates and sorts newest-first', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await auditService.record({
        tenantId,
        actor: { userId: 'user-1', fullName: 'QA Head' },
        entityType: 'Document',
        entityId: 'doc-1',
        action: AuditAction.UPDATE,
        before: { version: i },
        after: { version: i + 1 },
      });
    }

    const page1 = await auditService.findHistory(tenantId, 'Document', 'doc-1', 1, 2);
    expect(page1.total).toBe(5);
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].changes).toEqual([{ field: 'version', oldValue: 4, newValue: 5 }]);

    const page3 = await auditService.findHistory(tenantId, 'Document', 'doc-1', 3, 2);
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0].changes).toEqual([{ field: 'version', oldValue: 0, newValue: 1 }]);
  });

  it('PLT-2: findHistory is scoped to tenant, entityType, and entityId (tenant isolation)', async () => {
    const tenantA = new mongoose.Types.ObjectId().toString();
    const tenantB = new mongoose.Types.ObjectId().toString();

    await auditService.record({
      tenantId: tenantA,
      actor: { userId: 'user-1', fullName: 'A' },
      entityType: 'Document',
      entityId: 'doc-1',
      action: AuditAction.CREATE,
    });
    await auditService.record({
      tenantId: tenantB,
      actor: { userId: 'user-2', fullName: 'B' },
      entityType: 'Document',
      entityId: 'doc-1',
      action: AuditAction.CREATE,
    });

    const tenantAHistory = await auditService.findHistory(tenantA, 'Document', 'doc-1', 1, 20);
    expect(tenantAHistory.total).toBe(1);
    expect(tenantAHistory.items[0].tenantId).toBe(tenantA);
  });

  it('PLT-2: findAllForModule returns every event for an entityType regardless of entityId', async () => {
    const tenantId = new mongoose.Types.ObjectId().toString();
    await auditService.record({
      tenantId,
      actor: { userId: 'user-1', fullName: 'A' },
      entityType: 'Document',
      entityId: 'doc-1',
      action: AuditAction.CREATE,
    });
    await auditService.record({
      tenantId,
      actor: { userId: 'user-1', fullName: 'A' },
      entityType: 'Document',
      entityId: 'doc-2',
      action: AuditAction.CREATE,
    });

    const events = await auditService.findAllForModule(tenantId, 'Document');
    expect(events).toHaveLength(2);
  });
});

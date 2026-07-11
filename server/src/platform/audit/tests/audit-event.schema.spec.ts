import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AuditAction } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AuditEvent, AuditEventDocument, AuditEventSchema } from '../schemas/audit-event.schema';

describe('PLT-2 auditEvents append-only enforcement', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let auditEventModel: Model<AuditEventDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: AuditEvent.name, schema: AuditEventSchema }]),
      ],
    }).compile();
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await auditEventModel.collection.deleteMany({});
  });

  function baseEvent() {
    return {
      tenantId: new mongoose.Types.ObjectId(),
      actorId: 'user-1',
      actorName: 'QA Head',
      entityType: 'User',
      entityId: 'user-1',
      action: AuditAction.LOGIN_SUCCESS,
      changes: [],
      reason: null,
    };
  }

  it('PLT-2: create() and find() succeed', async () => {
    await auditEventModel.create(baseEvent());
    const found = await auditEventModel.find({ entityType: 'User' });
    expect(found).toHaveLength(1);
  });

  it('PLT-2: updateOne() is rejected', async () => {
    await auditEventModel.create(baseEvent());
    await expect(
      auditEventModel.updateOne({ entityType: 'User' }, { $set: { reason: 'tampered' } }),
    ).rejects.toThrow('append-only');
  });

  it('PLT-2: updateMany() is rejected', async () => {
    await auditEventModel.create(baseEvent());
    await expect(
      auditEventModel.updateMany({ entityType: 'User' }, { $set: { reason: 'tampered' } }),
    ).rejects.toThrow('append-only');
  });

  it('PLT-2: findOneAndUpdate() is rejected', async () => {
    await auditEventModel.create(baseEvent());
    await expect(
      auditEventModel.findOneAndUpdate({ entityType: 'User' }, { $set: { reason: 'tampered' } }),
    ).rejects.toThrow('append-only');
  });

  it('PLT-2: deleteOne() is rejected', async () => {
    await auditEventModel.create(baseEvent());
    await expect(auditEventModel.deleteOne({ entityType: 'User' })).rejects.toThrow('append-only');
  });

  it('PLT-2: deleteMany() is rejected', async () => {
    await auditEventModel.create(baseEvent());
    await expect(auditEventModel.deleteMany({ entityType: 'User' })).rejects.toThrow('append-only');
  });

  it('PLT-2: findOneAndDelete() is rejected', async () => {
    await auditEventModel.create(baseEvent());
    await expect(auditEventModel.findOneAndDelete({ entityType: 'User' })).rejects.toThrow('append-only');
  });

  it('PLT-2: re-saving an already-persisted document is rejected', async () => {
    const created = await auditEventModel.create(baseEvent());
    created.reason = 'tampered';
    await expect(created.save()).rejects.toThrow('append-only');
  });

  it('PLT-2: document-level deleteOne()/updateOne() are also rejected', async () => {
    const created = await auditEventModel.create(baseEvent());
    await expect(created.deleteOne()).rejects.toThrow('append-only');
    await expect(created.updateOne({ $set: { reason: 'tampered' } })).rejects.toThrow('append-only');
  });
});

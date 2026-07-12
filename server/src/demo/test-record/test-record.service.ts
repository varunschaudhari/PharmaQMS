import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ErrorCode,
  type CreateTestRecordRequest,
  type TestRecordData,
  type UpdateTestRecordRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { QrService } from '../../platform/qr/qr.service';
import { WorkflowService } from '../../platform/workflow/workflow.service';
import { TestRecord, TestRecordDocument } from './schemas/test-record.schema';

// Phase 0 gate: the polymorphic identity every platform service keys this entity by.
export const TEST_RECORD_ENTITY_TYPE = 'TestRecord';
// PLT-5: numbering schemes are looked up by upper-cased entityType.
export const TEST_RECORD_NUMBERING_TYPE = 'TEST-RECORD';

@Injectable()
export class TestRecordService {
  constructor(
    @InjectModel(TestRecord.name) private readonly testRecordModel: Model<TestRecordDocument>,
    private readonly numberingService: NumberingService,
    private readonly qrService: QrService,
    private readonly workflowService: WorkflowService,
  ) {}

  async create(
    tenantId: string,
    actorUserId: string,
    dto: CreateTestRecordRequest,
  ): Promise<TestRecordData> {
    // PLT-5: gapless tenant-configured number (a TEST-RECORD scheme must exist).
    const recordNumber = await this.numberingService.generateNumber(tenantId, TEST_RECORD_NUMBERING_TYPE);

    const doc = await this.testRecordModel.create({
      tenantId,
      recordNumber,
      title: dto.title,
      description: dto.description,
      createdByUserId: actorUserId,
    });

    // PLT-7: every record gets its scannable identity at birth.
    await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: TEST_RECORD_ENTITY_TYPE,
      entityId: doc._id.toString(),
      entityCode: recordNumber,
      entityName: dto.title,
    });

    return this.toData(tenantId, doc);
  }

  async update(
    tenantId: string,
    recordId: string,
    dto: UpdateTestRecordRequest,
  ): Promise<{ before: Record<string, unknown>; after: TestRecordData }> {
    const doc = await this.findOrThrow(tenantId, recordId);
    const before = { title: doc.title, description: doc.description };

    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.description !== undefined) doc.description = dto.description;
    await doc.save();

    return { before, after: await this.toData(tenantId, doc) };
  }

  async list(tenantId: string): Promise<TestRecordData[]> {
    const docs = await this.testRecordModel.find({ tenantId }).sort({ createdAt: -1 });
    return Promise.all(docs.map((doc) => this.toData(tenantId, doc)));
  }

  async get(tenantId: string, recordId: string): Promise<TestRecordData> {
    const doc = await this.findOrThrow(tenantId, recordId);
    return this.toData(tenantId, doc);
  }

  private async findOrThrow(tenantId: string, recordId: string): Promise<TestRecordDocument> {
    const doc = await this.testRecordModel.findOne({ _id: recordId, tenantId });
    if (!doc) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Test record not found.', HttpStatus.NOT_FOUND);
    }
    return doc;
  }

  private async toData(tenantId: string, doc: TestRecordDocument): Promise<TestRecordData> {
    const entityId = doc._id.toString();
    // PLT-4: the workflow instance is the approval-state authority — joined, never denormalized.
    const workflow = await this.workflowService.findInstanceForEntity(tenantId, TEST_RECORD_ENTITY_TYPE, entityId);
    const { data: qr } = await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: TEST_RECORD_ENTITY_TYPE,
      entityId,
      entityCode: doc.recordNumber,
      entityName: doc.title,
    });

    return {
      id: entityId,
      tenantId: doc.tenantId.toString(),
      recordNumber: doc.recordNumber,
      title: doc.title,
      description: doc.description,
      createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
      workflow,
      qr: { code: qr.code, scanUrl: qr.scanUrl },
    };
  }
}

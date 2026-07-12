import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../../platform/audit/audit.module';
import { NumberingModule } from '../../platform/numbering/numbering.module';
import { QrModule } from '../../platform/qr/qr.module';
import { WorkflowModule } from '../../platform/workflow/workflow.module';
import { TestRecord, TestRecordSchema } from './schemas/test-record.schema';
import { TestRecordController } from './test-record.controller';
import { TestRecordService } from './test-record.service';

// Phase 0 gate (SPEC.md §8): throwaway demo module — delete after DOC/TRN/EQP land.
@Module({
  imports: [
    MongooseModule.forFeature([{ name: TestRecord.name, schema: TestRecordSchema }]),
    NumberingModule,
    QrModule,
    WorkflowModule,
    AuditModule,
  ],
  controllers: [TestRecordController],
  providers: [TestRecordService],
})
export class TestRecordModule {}

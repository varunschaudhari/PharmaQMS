import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PdfModule } from '../../common/pdf/pdf.module';
import { StorageModule } from '../../common/storage/storage.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { EsignModule } from '../../platform/esign/esign.module';
import { DueDateScannerRegistry } from '../../platform/notifications/due-date/due-date-scanner.registry';
import { NumberingModule } from '../../platform/numbering/numbering.module';
import { QrModule } from '../../platform/qr/qr.module';
import { Department, DepartmentSchema } from '../../platform/tenant/schemas/department.schema';
import { WorkflowModule } from '../../platform/workflow/workflow.module';
import { ControlledCopyService } from './controlled-copy.service';
import { DocCheckController } from './doc-check.controller';
import { DocumentReviewScanner } from './document-review.scanner';
import { DocumentWorkflowListener } from './document-workflow.listener';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentEntity, DocumentEntitySchema } from './schemas/document.schema';
import { DocumentVersion, DocumentVersionSchema } from './schemas/document-version.schema';

// DOC module (SPEC.md §7.1) — Phase 0 gate passed 2026-07-11 (validation-pack/docs/phase0-demo.md),
// so business modules may now exist. Depends only on platform services, never on other modules.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DocumentEntity.name, schema: DocumentEntitySchema },
      { name: DocumentVersion.name, schema: DocumentVersionSchema },
      // Department re-registered for the numbering department token; Mongoose dedupes.
      { name: Department.name, schema: DepartmentSchema },
    ]),
    NumberingModule,
    AuditModule,
    StorageModule,
    // DOC-3: version approval runs through PLT-4; DOC-7/DOC-6 sign through PLT-3.
    WorkflowModule,
    EsignModule,
    // DOC-4/DOC-5: controlled-copy QR identity + PDF stamping/cover sheets.
    QrModule,
    PdfModule,
  ],
  controllers: [DocumentsController, DocCheckController],
  providers: [DocumentsService, DocumentWorkflowListener, DocumentReviewScanner, ControlledCopyService],
  exports: [DocumentsService, ControlledCopyService],
})
export class DocumentsModule implements OnModuleInit {
  constructor(
    // PLT-6 NotificationsModule is global — the registry is injectable without re-importing
    // the dynamic module (which would re-register BullMQ).
    private readonly scannerRegistry: DueDateScannerRegistry,
    private readonly reviewScanner: DocumentReviewScanner,
  ) {}

  // DOC-6: register the periodic-review scanner into the PLT-6 daily-scan framework.
  onModuleInit(): void {
    this.scannerRegistry.register(this.reviewScanner);
  }
}

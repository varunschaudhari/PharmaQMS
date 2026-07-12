import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PdfModule } from '../../common/pdf/pdf.module';
import { AuditModule } from '../../platform/audit/audit.module';
import { User, UserSchema } from '../../platform/auth/schemas/user.schema';
import { EsignModule } from '../../platform/esign/esign.module';
import { DueDateScannerRegistry } from '../../platform/notifications/due-date/due-date-scanner.registry';
import { Department, DepartmentSchema } from '../../platform/tenant/schemas/department.schema';
import { Tenant, TenantSchema } from '../../platform/tenant/schemas/tenant.schema';
import {
  DocumentTrainingTarget,
  DocumentTrainingTargetSchema,
} from './schemas/document-training-target.schema';
import { TrainingAssignment, TrainingAssignmentSchema } from './schemas/training-assignment.schema';
import { TrainingController } from './training.controller';
import { TrainingOverdueScanner } from './training-overdue.scanner';
import { TrainingService } from './training.service';
import { TrainingSyncListener } from './training-sync.listener';

// TRN module (SPEC.md §7.2) — depends only on platform services (User/Tenant/Department
// re-registered per the established cross-module convention) plus the event contracts DOC-9/
// PLT-8 broadcast; never imports the Documents module directly (CLAUDE.md).
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TrainingAssignment.name, schema: TrainingAssignmentSchema },
      { name: DocumentTrainingTarget.name, schema: DocumentTrainingTargetSchema },
      { name: User.name, schema: UserSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: Department.name, schema: DepartmentSchema },
    ]),
    AuditModule,
    EsignModule,
    PdfModule,
  ],
  controllers: [TrainingController],
  providers: [TrainingService, TrainingSyncListener, TrainingOverdueScanner],
  exports: [TrainingService],
})
export class TrainingModule implements OnModuleInit {
  constructor(
    // PLT-6 NotificationsModule is global — injectable without importing the dynamic module.
    private readonly scannerRegistry: DueDateScannerRegistry,
    private readonly overdueScanner: TrainingOverdueScanner,
  ) {}

  // TRN-5: register the overdue-training scanner into the PLT-6 daily-scan framework.
  onModuleInit(): void {
    this.scannerRegistry.register(this.overdueScanner);
  }
}

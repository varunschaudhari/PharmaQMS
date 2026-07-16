import { Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../../platform/audit/audit.module';
import { User, UserSchema } from '../../platform/auth/schemas/user.schema';
import { EsignModule } from '../../platform/esign/esign.module';
import { DueDateScannerRegistry } from '../../platform/notifications/due-date/due-date-scanner.registry';
import { NumberingModule } from '../../platform/numbering/numbering.module';
import { QrModule } from '../../platform/qr/qr.module';
import { PdfModule } from '../../common/pdf/pdf.module';
import { StorageModule } from '../../common/storage/storage.module';
import { Department, DepartmentSchema } from '../../platform/tenant/schemas/department.schema';
import { Tenant, TenantSchema } from '../../platform/tenant/schemas/tenant.schema';
import { CalibrationAgencyController } from './calibration-agency.controller';
import { CalibrationAgencyExpiryScanner } from './calibration-agency-expiry.scanner';
import { CalibrationAgencyService } from './calibration-agency.service';
import { CalibrationController } from './calibration.controller';
import { CalibrationService } from './calibration.service';
import { EquipmentCalibrationScanner } from './equipment-calibration.scanner';
import { EquipmentController } from './equipment.controller';
import { EquipmentHistoryController } from './equipment-history.controller';
import { EquipmentHistoryReportService } from './equipment-history-report.service';
import { EquipmentPmScanner } from './equipment-pm.scanner';
import { EquipmentQualificationScanner } from './equipment-qualification.scanner';
import { EquipmentService } from './equipment.service';
import { LogbookController } from './logbook.controller';
import { LogbookService } from './logbook.service';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';
import { PmController } from './pm.controller';
import { PmService } from './pm.service';
import { QualificationController } from './qualification.controller';
import { QualificationService } from './qualification.service';
import { CalibrationAgency, CalibrationAgencySchema } from './schemas/calibration-agency.schema';
import { CalibrationRecord, CalibrationRecordSchema } from './schemas/calibration-record.schema';
import { CalibrationSchedule, CalibrationScheduleSchema } from './schemas/calibration-schedule.schema';
import { Equipment, EquipmentSchema } from './schemas/equipment.schema';
import { LogbookEntry, LogbookEntrySchema } from './schemas/logbook-entry.schema';
import { MaintenanceTask, MaintenanceTaskSchema } from './schemas/maintenance-task.schema';
import { PmPlan, PmPlanSchema } from './schemas/pm-plan.schema';
import { PmTask, PmTaskSchema } from './schemas/pm-task.schema';
import { QualificationRecord, QualificationRecordSchema } from './schemas/qualification-record.schema';

// EQP module (SPEC.md §7.3) — depends only on platform services (Department/Tenant/User
// re-registered per the established cross-module convention). EQP-4/5 calibration, EQP-6/7
// logbook+maintenance, and EQP-8/9 qualification+PM are all sub-concerns of this SAME module
// (not separate top-level business modules), so their services may depend on EquipmentService
// (and each other) directly — see calibration.service.ts's header comment.
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Equipment.name, schema: EquipmentSchema },
      { name: Department.name, schema: DepartmentSchema },
      { name: Tenant.name, schema: TenantSchema },
      { name: User.name, schema: UserSchema },
      { name: CalibrationSchedule.name, schema: CalibrationScheduleSchema },
      { name: CalibrationRecord.name, schema: CalibrationRecordSchema },
      { name: LogbookEntry.name, schema: LogbookEntrySchema },
      { name: MaintenanceTask.name, schema: MaintenanceTaskSchema },
      { name: QualificationRecord.name, schema: QualificationRecordSchema },
      { name: PmPlan.name, schema: PmPlanSchema },
      { name: PmTask.name, schema: PmTaskSchema },
      { name: CalibrationAgency.name, schema: CalibrationAgencySchema },
    ]),
    NumberingModule,
    QrModule,
    AuditModule,
    EsignModule,
    StorageModule,
    PdfModule,
  ],
  controllers: [
    CalibrationController,
    CalibrationAgencyController,
    MaintenanceController,
    LogbookController,
    QualificationController,
    PmController,
    EquipmentHistoryController,
    EquipmentController,
  ],
  providers: [
    EquipmentService,
    CalibrationService,
    CalibrationAgencyService,
    EquipmentCalibrationScanner,
    CalibrationAgencyExpiryScanner,
    MaintenanceService,
    LogbookService,
    QualificationService,
    PmService,
    EquipmentQualificationScanner,
    EquipmentPmScanner,
    EquipmentHistoryReportService,
  ],
  exports: [EquipmentService, CalibrationService, CalibrationAgencyService, MaintenanceService, LogbookService, QualificationService, PmService],
})
export class EquipmentModule implements OnModuleInit {
  constructor(
    // PLT-6 NotificationsModule is global — injectable without importing the dynamic module.
    private readonly scannerRegistry: DueDateScannerRegistry,
    private readonly calibrationScanner: EquipmentCalibrationScanner,
    private readonly qualificationScanner: EquipmentQualificationScanner,
    private readonly pmScanner: EquipmentPmScanner,
    private readonly calibrationAgencyExpiryScanner: CalibrationAgencyExpiryScanner,
  ) {}

  // EQP-4/EQP-8/EQP-9/EQP-11: register the calibration/requalification/PM/agency-accreditation
  // due-date scanners into the PLT-6 daily-scan framework.
  onModuleInit(): void {
    this.scannerRegistry.register(this.calibrationScanner);
    this.scannerRegistry.register(this.qualificationScanner);
    this.scannerRegistry.register(this.pmScanner);
    this.scannerRegistry.register(this.calibrationAgencyExpiryScanner);
  }
}

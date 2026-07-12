import { Injectable } from '@nestjs/common';
import type {
  CalibrationRecordData,
  CalibrationScheduleData,
  EquipmentData,
  LogbookEntryData,
  MaintenanceTaskData,
  PmPlanData,
  PmTaskData,
  QualificationRecordData,
} from '@pharmaqms/shared';
import { PdfRenderService } from '../../common/pdf/pdf-render.service';
import { CalibrationService } from './calibration.service';
import { equipmentHistoryReportHtml } from './equipment-history-report-html';
import { EquipmentService } from './equipment.service';
import { LogbookService } from './logbook.service';
import { MaintenanceService } from './maintenance.service';
import { PmService } from './pm.service';
import { QualificationService } from './qualification.service';

export interface EquipmentHistoryReport {
  equipment: EquipmentData;
  qualificationRecords: QualificationRecordData[];
  calibrationSchedule: CalibrationScheduleData | null;
  calibrationRecords: CalibrationRecordData[];
  pmPlan: PmPlanData | null;
  pmTasks: PmTaskData[];
  logbookEntries: LogbookEntryData[];
  maintenanceTasks: MaintenanceTaskData[];
}

// EQP-10 (SPEC.md §7.3, P1): "show me everything about this machine" — the full lifecycle
// (qualification, all calibrations, PMs, breakdowns, logbook) as one PDF. A sub-concern of the
// Equipment module that depends directly on EquipmentService plus every EQP-4/6/7/8/9 sibling
// service (all already exported from EquipmentModule for exactly this kind of cross-sub-concern
// read — see calibration.service.ts's header comment for why this isn't a forbidden
// business-module-to-business-module dependency).
@Injectable()
export class EquipmentHistoryReportService {
  constructor(
    private readonly equipmentService: EquipmentService,
    private readonly calibrationService: CalibrationService,
    private readonly qualificationService: QualificationService,
    private readonly pmService: PmService,
    private readonly logbookService: LogbookService,
    private readonly maintenanceService: MaintenanceService,
    private readonly pdfRenderService: PdfRenderService,
  ) {}

  async buildReport(tenantId: string, equipmentId: string): Promise<EquipmentHistoryReport> {
    const [equipment, qualificationRecords, calibrationSchedule, calibrationRecords, pmPlan, pmTasks, logbookEntries, maintenanceTasks] =
      await Promise.all([
        this.equipmentService.get(tenantId, equipmentId),
        this.qualificationService.listForEquipment(tenantId, equipmentId),
        this.calibrationService.getSchedule(tenantId, equipmentId),
        this.calibrationService.listRecords(tenantId, equipmentId),
        this.pmService.getPlan(tenantId, equipmentId),
        this.pmService.listTasksForEquipment(tenantId, equipmentId),
        this.logbookService.listForEquipment(tenantId, equipmentId),
        this.maintenanceService.listForEquipment(tenantId, equipmentId),
      ]);

    return { equipment, qualificationRecords, calibrationSchedule, calibrationRecords, pmPlan, pmTasks, logbookEntries, maintenanceTasks };
  }

  async generatePdf(tenantId: string, equipmentId: string): Promise<Buffer> {
    const report = await this.buildReport(tenantId, equipmentId);
    const html = equipmentHistoryReportHtml(report);
    return this.pdfRenderService.render(html, { preferCSSPageSize: true });
  }
}

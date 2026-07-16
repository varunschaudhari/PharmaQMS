import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NotificationEvent } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type {
  DueDateFinding,
  DueDateScanContext,
  DueDateScanner,
} from '../../platform/notifications/due-date/due-date-scanner.interface';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { CalibrationAgency, CalibrationAgencyDocument } from './schemas/calibration-agency.schema';
import { CalibrationSchedule, CalibrationScheduleDocument } from './schemas/calibration-schedule.schema';
import { Equipment, EquipmentDocument } from './schemas/equipment.schema';

// EQP-11 (d): registered into the PLT-6 due-date scanner framework (see EquipmentModule's
// onModuleInit) — an expired agency accreditation notifies the department head of every piece of
// equipment linked to it (one finding per department, same "department head" recipient precedent
// as EQP-4's own calibration-due scanner), warning-only (never blocks calibration recording — QA
// decides, see CalibrationService.recordResult's own audited-warning flag).
@Injectable()
export class CalibrationAgencyExpiryScanner implements DueDateScanner {
  readonly key = 'equipment.calibration-agency-accreditation-expired';

  constructor(
    @InjectModel(CalibrationAgency.name) private readonly agencyModel: Model<CalibrationAgencyDocument>,
    @InjectModel(CalibrationSchedule.name) private readonly scheduleModel: Model<CalibrationScheduleDocument>,
    @InjectModel(Equipment.name) private readonly equipmentModel: Model<EquipmentDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
  ) {}

  async scan(context: DueDateScanContext): Promise<DueDateFinding[]> {
    const expiredAgencies = await this.agencyModel.find({
      tenantId: context.tenantId,
      accreditationValidUntil: { $ne: null, $lte: context.now },
    });
    if (expiredAgencies.length === 0) {
      return [];
    }
    const agencyIds = expiredAgencies.map((a) => a._id);

    const schedules = await this.scheduleModel.find({ tenantId: context.tenantId, agencyId: { $in: agencyIds } });
    if (schedules.length === 0) {
      return [];
    }

    const equipmentIds = schedules.map((s) => s.equipmentId);
    const equipmentDocs = await this.equipmentModel.find({ tenantId: context.tenantId, _id: { $in: equipmentIds } });
    const equipmentById = new Map(equipmentDocs.map((e) => [e._id.toString(), e]));

    const departmentIds = [...new Set(equipmentDocs.map((e) => e.departmentId.toString()))];
    const departments = await this.departmentModel.find({ tenantId: context.tenantId, _id: { $in: departmentIds } });
    const headByDepartment = new Map(departments.map((d) => [d._id.toString(), d.headUserId]));

    const agencyById = new Map(expiredAgencies.map((a) => [a._id.toString(), a]));
    const seenDepartmentPerAgency = new Set<string>();
    const findings: DueDateFinding[] = [];

    for (const schedule of schedules) {
      const agency = agencyById.get(schedule.agencyId!.toString());
      const equipment = equipmentById.get(schedule.equipmentId.toString());
      if (!agency || !equipment) continue;

      const departmentId = equipment.departmentId.toString();
      const dedupeGroupKey = `${agency._id.toString()}:${departmentId}`;
      if (seenDepartmentPerAgency.has(dedupeGroupKey)) continue;

      const headUserId = headByDepartment.get(departmentId);
      if (!headUserId) continue;
      seenDepartmentPerAgency.add(dedupeGroupKey);

      const expiryDateKey = agency.accreditationValidUntil!.toISOString().slice(0, 10);
      findings.push({
        userId: headUserId,
        event: NotificationEvent.OVERDUE,
        entityType: EQUIPMENT_ENTITY_TYPE,
        entityId: equipment._id.toString(),
        title: `Calibration agency accreditation expired: ${agency.name}`,
        body: `${agency.name}'s accreditation expired ${expiryDateKey} — equipment calibrated by this agency (including ${equipment.equipmentCode}) may need a QA review before its next calibration is recorded.`,
        dedupeKey: `calibration-agency-expiry:${agency._id.toString()}:${departmentId}:${expiryDateKey}`,
      });
    }
    return findings;
  }
}

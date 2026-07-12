import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CalibrationStatus, NotificationEvent, deriveCalibrationStatus } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type {
  DueDateFinding,
  DueDateScanContext,
  DueDateScanner,
} from '../../platform/notifications/due-date/due-date-scanner.interface';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { Equipment, EquipmentDocument } from './schemas/equipment.schema';
import { CalibrationSchedule, CalibrationScheduleDocument } from './schemas/calibration-schedule.schema';

// EQP-4: registered into the PLT-6 due-date scanner framework (see EquipmentModule.onModuleInit).
// Unlike TRN-5 (which notifies the trainee themselves), equipment has no "assigned technician"
// concept — this scanner notifies ONLY the owning department's head (Department.headUserId).
@Injectable()
export class EquipmentCalibrationScanner implements DueDateScanner {
  readonly key = 'equipment.calibration-due';

  constructor(
    @InjectModel(CalibrationSchedule.name) private readonly scheduleModel: Model<CalibrationScheduleDocument>,
    @InjectModel(Equipment.name) private readonly equipmentModel: Model<EquipmentDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
  ) {}

  async scan(context: DueDateScanContext): Promise<DueDateFinding[]> {
    const schedules = await this.scheduleModel.find({ tenantId: context.tenantId });
    if (schedules.length === 0) {
      return [];
    }

    const equipmentIds = schedules.map((s) => s.equipmentId);
    const equipmentDocs = await this.equipmentModel.find({ tenantId: context.tenantId, _id: { $in: equipmentIds } });
    const equipmentById = new Map(equipmentDocs.map((e) => [e._id.toString(), e]));

    const departmentIds = [...new Set(equipmentDocs.map((e) => e.departmentId.toString()))];
    const departments = await this.departmentModel.find({ tenantId: context.tenantId, _id: { $in: departmentIds } });
    const headByDepartment = new Map(departments.map((d) => [d._id.toString(), d.headUserId]));

    const findings: DueDateFinding[] = [];
    for (const schedule of schedules) {
      const equipment = equipmentById.get(schedule.equipmentId.toString());
      if (!equipment) continue;

      const status = deriveCalibrationStatus(schedule.nextDueDate.toISOString(), context.now);
      if (status !== CalibrationStatus.DUE_SOON && status !== CalibrationStatus.OVERDUE) {
        continue;
      }

      const headUserId = headByDepartment.get(equipment.departmentId.toString());
      if (!headUserId) {
        continue;
      }

      const dueDateKey = schedule.nextDueDate.toISOString().slice(0, 10);
      const event = status === CalibrationStatus.OVERDUE ? NotificationEvent.OVERDUE : NotificationEvent.DUE_SOON;
      findings.push({
        userId: headUserId,
        event,
        entityType: EQUIPMENT_ENTITY_TYPE,
        entityId: equipment._id.toString(),
        title: `Calibration ${status === CalibrationStatus.OVERDUE ? 'overdue' : 'due soon'}: ${equipment.equipmentCode}`,
        body: `${equipment.equipmentCode} — ${equipment.name} calibration is ${status === CalibrationStatus.OVERDUE ? 'overdue' : 'due soon'} (due ${dueDateKey}).`,
        dedupeKey: `equipment-calibration:${equipment._id.toString()}:${dueDateKey}:${event}`,
      });
    }
    return findings;
  }
}

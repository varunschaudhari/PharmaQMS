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
import { Equipment, EquipmentDocument } from './schemas/equipment.schema';
import { QualificationService } from './qualification.service';

const DUE_SOON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// EQP-8: registered into the PLT-6 due-date scanner framework (see EquipmentModule.onModuleInit).
// Same "no assigned technician" precedent as EQP-4's calibration scanner — notifies only the
// owning department's head.
@Injectable()
export class EquipmentQualificationScanner implements DueDateScanner {
  readonly key = 'equipment.requalification-due';

  constructor(
    private readonly qualificationService: QualificationService,
    @InjectModel(Equipment.name) private readonly equipmentModel: Model<EquipmentDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
  ) {}

  async scan(context: DueDateScanContext): Promise<DueDateFinding[]> {
    const schedule = await this.qualificationService.listRequalificationSchedule(context.tenantId);
    if (schedule.length === 0) {
      return [];
    }

    const equipmentIds = schedule.map((s) => s.equipmentId);
    const equipmentDocs = await this.equipmentModel.find({ tenantId: context.tenantId, _id: { $in: equipmentIds } });
    const equipmentById = new Map(equipmentDocs.map((e) => [e._id.toString(), e]));

    const departmentIds = [...new Set(equipmentDocs.map((e) => e.departmentId.toString()))];
    const departments = await this.departmentModel.find({ tenantId: context.tenantId, _id: { $in: departmentIds } });
    const headByDepartment = new Map(departments.map((d) => [d._id.toString(), d.headUserId]));

    const findings: DueDateFinding[] = [];
    for (const entry of schedule) {
      const equipment = equipmentById.get(entry.equipmentId);
      if (!equipment) continue;

      const due = new Date(entry.nextRequalificationDueDate);
      const isOverdue = due <= context.now;
      const isDueSoon = !isOverdue && due.getTime() - context.now.getTime() <= DUE_SOON_WINDOW_MS;
      if (!isOverdue && !isDueSoon) continue;

      const headUserId = headByDepartment.get(equipment.departmentId.toString());
      if (!headUserId) continue;

      const dueDateKey = entry.nextRequalificationDueDate.slice(0, 10);
      const event = isOverdue ? NotificationEvent.OVERDUE : NotificationEvent.DUE_SOON;
      findings.push({
        userId: headUserId,
        event,
        entityType: EQUIPMENT_ENTITY_TYPE,
        entityId: equipment._id.toString(),
        title: `Requalification ${isOverdue ? 'overdue' : 'due soon'}: ${equipment.equipmentCode}`,
        body: `${equipment.equipmentCode} — ${equipment.name} requalification is ${isOverdue ? 'overdue' : 'due soon'} (due ${dueDateKey}).`,
        dedupeKey: `equipment-requalification:${equipment._id.toString()}:${dueDateKey}:${event}`,
      });
    }
    return findings;
  }
}

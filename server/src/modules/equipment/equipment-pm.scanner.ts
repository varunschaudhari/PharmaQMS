import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { CalibrationStatus, NotificationEvent, derivePmStatus } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type {
  DueDateFinding,
  DueDateScanContext,
  DueDateScanner,
} from '../../platform/notifications/due-date/due-date-scanner.interface';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { PmService } from './pm.service';
import { Equipment, EquipmentDocument } from './schemas/equipment.schema';

// EQP-9: registered into the PLT-6 due-date scanner framework. Unlike every other EQP scanner,
// this one ALSO mutates data as a side effect of scanning — SPEC's "auto task generation" is
// exactly the daily-scan cadence, so a PmTask is created (idempotently — see
// PmService.generateTaskIfDue's unique-index guard) the moment a plan's due date arrives; a
// DUE_SOON finding fires ahead of that (within the 30-day window) with no task created yet.
@Injectable()
export class EquipmentPmScanner implements DueDateScanner {
  readonly key = 'equipment.pm-due';

  constructor(
    private readonly pmService: PmService,
    @InjectModel(Equipment.name) private readonly equipmentModel: Model<EquipmentDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
  ) {}

  async scan(context: DueDateScanContext): Promise<DueDateFinding[]> {
    const plans = await this.pmService.listAllPlans(context.tenantId);
    if (plans.length === 0) {
      return [];
    }

    const equipmentIds = plans.map((p) => p.equipmentId);
    const equipmentDocs = await this.equipmentModel.find({ tenantId: context.tenantId, _id: { $in: equipmentIds } });
    const equipmentById = new Map(equipmentDocs.map((e) => [e._id.toString(), e]));

    const departmentIds = [...new Set(equipmentDocs.map((e) => e.departmentId.toString()))];
    const departments = await this.departmentModel.find({ tenantId: context.tenantId, _id: { $in: departmentIds } });
    const headByDepartment = new Map(departments.map((d) => [d._id.toString(), d.headUserId]));

    const findings: DueDateFinding[] = [];
    for (const plan of plans) {
      const equipment = equipmentById.get(plan.equipmentId.toString());
      if (!equipment) continue;

      const status = derivePmStatus(plan.nextDueDate.toISOString(), context.now);
      if (status !== CalibrationStatus.DUE_SOON && status !== CalibrationStatus.OVERDUE) {
        continue;
      }

      if (status === CalibrationStatus.OVERDUE) {
        await this.pmService.generateTaskIfDue(context.tenantId, plan, context.now);
      }

      const headUserId = headByDepartment.get(equipment.departmentId.toString());
      if (!headUserId) continue;

      const dueDateKey = plan.nextDueDate.toISOString().slice(0, 10);
      const event = status === CalibrationStatus.OVERDUE ? NotificationEvent.OVERDUE : NotificationEvent.DUE_SOON;
      findings.push({
        userId: headUserId,
        event,
        entityType: EQUIPMENT_ENTITY_TYPE,
        entityId: equipment._id.toString(),
        title: `PM ${status === CalibrationStatus.OVERDUE ? 'due' : 'due soon'}: ${equipment.equipmentCode}`,
        body: `${equipment.equipmentCode} — ${equipment.name} preventive maintenance is ${status === CalibrationStatus.OVERDUE ? 'due' : 'due soon'} (due ${dueDateKey}).`,
        dedupeKey: `equipment-pm:${equipment._id.toString()}:${dueDateKey}:${event}`,
      });
    }
    return findings;
  }
}

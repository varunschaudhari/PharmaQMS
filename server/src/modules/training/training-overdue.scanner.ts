import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { NotificationEvent, trainingOverdueWhatsAppParams } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type {
  DueDateFinding,
  DueDateScanContext,
  DueDateScanner,
} from '../../platform/notifications/due-date/due-date-scanner.interface';
import { User, UserDocument } from '../../platform/auth/schemas/user.schema';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { TrainingService } from './training.service';
import { TRAINING_ASSIGNMENT_ENTITY_TYPE } from './training-entity-types';

// TRN-5: registered into the PLT-6 due-date scanner framework (see TrainingModule.onModuleInit)
// — notifies BOTH the employee and their department head (SPEC §7.2), one finding each so the
// per-recipient dedupe index treats them independently.
@Injectable()
export class TrainingOverdueScanner implements DueDateScanner {
  readonly key = 'training.overdue-assignments';

  constructor(
    private readonly trainingService: TrainingService,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
  ) {}

  async scan(context: DueDateScanContext): Promise<DueDateFinding[]> {
    const overdue = await this.trainingService.listOverdue(context.tenantId, context.now);
    if (overdue.length === 0) {
      return [];
    }

    const userIds = [...new Set(overdue.map((a) => a.userId))];
    const users = await this.userModel.find({ tenantId: context.tenantId, _id: { $in: userIds } });
    const departmentIdByUser = new Map(
      users.map((u) => [u._id.toString(), u.departmentId ? u.departmentId.toString() : null]),
    );

    const departmentIds = [...new Set([...departmentIdByUser.values()].filter((id): id is string => Boolean(id)))];
    const departments = await this.departmentModel.find({ tenantId: context.tenantId, _id: { $in: departmentIds } });
    const headByDepartment = new Map(departments.map((d) => [d._id.toString(), d.headUserId]));

    const findings: DueDateFinding[] = [];
    for (const assignment of overdue) {
      const dueDateKey = assignment.dueDate ? assignment.dueDate.slice(0, 10) : context.runDate;
      const dedupeKey = `training-overdue:${assignment.id}:${dueDateKey}`;
      const whatsapp = trainingOverdueWhatsAppParams(assignment.userFullName, assignment.docNumber, assignment.documentTitle);

      findings.push({
        userId: assignment.userId,
        event: NotificationEvent.OVERDUE,
        entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
        entityId: assignment.id,
        title: `Training overdue: ${assignment.docNumber}`,
        body: `${assignment.docNumber} — ${assignment.documentTitle} (v${assignment.versionLabel}) read-and-understood training is overdue.`,
        dedupeKey,
        whatsapp,
      });

      const departmentId = departmentIdByUser.get(assignment.userId);
      const headUserId = departmentId ? headByDepartment.get(departmentId) : null;
      if (headUserId && headUserId !== assignment.userId) {
        findings.push({
          userId: headUserId,
          event: NotificationEvent.OVERDUE,
          entityType: TRAINING_ASSIGNMENT_ENTITY_TYPE,
          entityId: assignment.id,
          title: `Team training overdue: ${assignment.docNumber}`,
          body: `${assignment.userFullName} has overdue read-and-understood training for ${assignment.docNumber} — ${assignment.documentTitle}.`,
          dedupeKey,
          whatsapp,
        });
      }
    }
    return findings;
  }
}

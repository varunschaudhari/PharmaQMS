import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  CalibrationStatus,
  EquipmentStatus,
  ErrorCode,
  assertEquipmentStatusTransition,
  deriveCalibrationStatus,
  derivePmStatus,
  deriveQualificationStatus,
  type CreateEquipmentRequest,
  type EquipmentData,
  type EquipmentStatusCardData,
  type ListEquipmentQuery,
  type UpdateEquipmentRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { AuditService } from '../../platform/audit/audit.service';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { QrService } from '../../platform/qr/qr.service';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { Tenant, TenantDocument } from '../../platform/tenant/schemas/tenant.schema';
import { resolveBlockUsageWhenCalibrationOverdue } from '../../platform/tenant/tenant-settings.util';
import { EQUIPMENT_ENTITY_TYPE, EQUIPMENT_NUMBERING_TYPE } from './equipment-entity-types';
import { toLogbookEntryData } from './logbook-mapper';
import { computeQualificationSummary } from './qualification-summary.util';
import { CalibrationSchedule, CalibrationScheduleDocument } from './schemas/calibration-schedule.schema';
import { Equipment, EquipmentDocument } from './schemas/equipment.schema';
import { LogbookEntry, LogbookEntryDocument } from './schemas/logbook-entry.schema';
import { PmPlan, PmPlanDocument } from './schemas/pm-plan.schema';
import { QualificationRecord, QualificationRecordDocument } from './schemas/qualification-record.schema';

const RECENT_LOGBOOK_ENTRY_LIMIT = 5;

export interface EquipmentActor {
  userId: string;
  fullName: string;
  permissions: string[];
}

@Injectable()
export class EquipmentService {
  constructor(
    @InjectModel(Equipment.name) private readonly equipmentModel: Model<EquipmentDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
    @InjectModel(CalibrationSchedule.name) private readonly calibrationScheduleModel: Model<CalibrationScheduleDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    @InjectModel(LogbookEntry.name) private readonly logbookEntryModel: Model<LogbookEntryDocument>,
    @InjectModel(QualificationRecord.name) private readonly qualificationRecordModel: Model<QualificationRecordDocument>,
    @InjectModel(PmPlan.name) private readonly pmPlanModel: Model<PmPlanDocument>,
    private readonly numberingService: NumberingService,
    private readonly qrService: QrService,
    private readonly auditService: AuditService,
  ) {}

  // EQP-1 + EQP-2: create the master record and mint its QR identity in the same call — every
  // piece of equipment is scannable from the moment it exists.
  async create(tenantId: string, dto: CreateEquipmentRequest): Promise<EquipmentData> {
    const department = await this.departmentModel.findOne({ _id: dto.departmentId, tenantId, isActive: true });
    if (!department) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Department not found.', HttpStatus.NOT_FOUND);
    }

    const equipmentCode = await this.numberingService.generateNumber(tenantId, EQUIPMENT_NUMBERING_TYPE, department.code);

    const equipment = await this.equipmentModel.create({
      tenantId,
      equipmentCode,
      name: dto.name,
      make: dto.make ?? null,
      modelName: dto.modelName ?? null,
      serialNumber: dto.serialNumber ?? null,
      location: dto.location,
      departmentId: dto.departmentId,
      isGmpCritical: dto.isGmpCritical,
      status: EquipmentStatus.ACTIVE,
      installDate: dto.installDate ? new Date(dto.installDate) : null,
    });

    await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipment._id.toString(),
      entityCode: equipmentCode,
      entityName: dto.name,
    });

    return this.toData(tenantId, equipment);
  }

  async update(
    tenantId: string,
    equipmentId: string,
    dto: UpdateEquipmentRequest,
  ): Promise<{ before: Record<string, unknown>; after: EquipmentData }> {
    const equipment = await this.findOrThrow(tenantId, equipmentId);
    const before = {
      name: equipment.name,
      make: equipment.make,
      modelName: equipment.modelName,
      serialNumber: equipment.serialNumber,
      location: equipment.location,
      isGmpCritical: equipment.isGmpCritical,
      installDate: equipment.installDate,
    };

    if (dto.name !== undefined) equipment.name = dto.name;
    if (dto.make !== undefined) equipment.make = dto.make;
    if (dto.modelName !== undefined) equipment.modelName = dto.modelName;
    if (dto.serialNumber !== undefined) equipment.serialNumber = dto.serialNumber;
    if (dto.location !== undefined) equipment.location = dto.location;
    if (dto.isGmpCritical !== undefined) equipment.isGmpCritical = dto.isGmpCritical;
    if (dto.installDate !== undefined) equipment.installDate = new Date(dto.installDate);
    await equipment.save();

    return { before, after: await this.toData(tenantId, equipment) };
  }

  // EQP-1: the ONLY way status changes via the generic admin endpoint — an explicit transition
  // map, invalid throws (CLAUDE.md). EQP-5: DO_NOT_USE is excluded here on purpose — it is
  // structurally reachable in the transition map but may only be entered/left by the calibration
  // OOT/disposition flow (see setCalibrationLockStatus below), never by manual admin choice.
  async transitionStatus(
    tenantId: string,
    equipmentId: string,
    toStatus: EquipmentStatus,
  ): Promise<{ before: Record<string, unknown>; after: EquipmentData }> {
    const equipment = await this.findOrThrow(tenantId, equipmentId);
    const fromStatus = equipment.status;

    if (fromStatus === EquipmentStatus.DO_NOT_USE || toStatus === EquipmentStatus.DO_NOT_USE) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'DO_NOT_USE can only be entered or cleared via the calibration disposition flow.',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      assertEquipmentStatusTransition(fromStatus, toStatus);
    } catch (error) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid equipment status transition.',
        HttpStatus.BAD_REQUEST,
      );
    }

    equipment.status = toStatus;
    await equipment.save();

    return { before: { status: fromStatus }, after: await this.toData(tenantId, equipment) };
  }

  // EQP-5: the ONLY entry point that may move equipment into/out of DO_NOT_USE — called
  // exclusively by CalibrationService's OOT-quarantine (record-creation time) and disposition
  // ('release') flows. Writes its own audit event since it is never reached through a
  // controller's @Audited() decorator.
  async setCalibrationLockStatus(
    tenantId: string,
    equipmentId: string,
    toStatus: EquipmentStatus.DO_NOT_USE | EquipmentStatus.ACTIVE,
    actor: { userId: string; fullName: string },
  ): Promise<EquipmentData> {
    const equipment = await this.findOrThrow(tenantId, equipmentId);
    const fromStatus = equipment.status;
    assertEquipmentStatusTransition(fromStatus, toStatus);

    equipment.status = toStatus;
    await equipment.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.STATUS_CHANGE,
      before: { status: fromStatus },
      after: { status: toStatus },
      reason:
        toStatus === EquipmentStatus.DO_NOT_USE
          ? 'Out-of-tolerance calibration result — equipment quarantined pending QA disposition.'
          : 'QA disposition released the equipment back to Active.',
    });

    return this.toData(tenantId, equipment);
  }

  async list(tenantId: string, query: ListEquipmentQuery): Promise<{ items: EquipmentData[]; total: number }> {
    const filter: Record<string, unknown> = { tenantId };
    if (query.status) filter.status = query.status;
    if (query.departmentId) filter.departmentId = query.departmentId;
    if (query.search) {
      filter.$or = [
        { name: { $regex: escapeRegex(query.search), $options: 'i' } },
        { equipmentCode: { $regex: escapeRegex(query.search), $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      this.equipmentModel
        .find(filter)
        .sort({ equipmentCode: 1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit),
      this.equipmentModel.countDocuments(filter),
    ]);
    return { items: await Promise.all(docs.map((doc) => this.toData(tenantId, doc))), total };
  }

  async get(tenantId: string, equipmentId: string): Promise<EquipmentData> {
    const equipment = await this.findOrThrow(tenantId, equipmentId);
    return this.toData(tenantId, equipment);
  }

  // EQP-3: the scan-to-status-card view. EQP-4 feeds calibration from the real schedule, EQP-6
  // feeds the last 5 logbook entries, EQP-8 feeds qualification, EQP-9 feeds PM. The lookups
  // below are mutually independent (each keyed only off tenantId/equipmentId, not off each
  // other's result) so they run in parallel — SPEC's <2s scan-to-card target (measured via live
  // verification, see CHANGELOG).
  async getStatusCard(tenantId: string, equipmentId: string, actor: EquipmentActor): Promise<EquipmentStatusCardData> {
    const [equipment, schedule, tenant, recentEntries, qualificationSummary, pmPlan] = await Promise.all([
      this.findOrThrow(tenantId, equipmentId),
      this.calibrationScheduleModel.findOne({ tenantId, equipmentId }),
      this.tenantModel.findById(tenantId),
      this.logbookEntryModel.find({ tenantId, equipmentId }).sort({ occurredAt: -1 }).limit(RECENT_LOGBOOK_ENTRY_LIMIT),
      computeQualificationSummary(this.qualificationRecordModel, tenantId, equipmentId),
      this.pmPlanModel.findOne({ tenantId, equipmentId }),
    ]);

    const calibrationNextDueDate = schedule ? schedule.nextDueDate.toISOString() : null;
    const calibrationStatus = deriveCalibrationStatus(calibrationNextDueDate);
    const calibrationBlocksUsage =
      calibrationStatus === CalibrationStatus.OVERDUE && resolveBlockUsageWhenCalibrationOverdue(tenant);

    const qualificationStatus = deriveQualificationStatus(
      qualificationSummary.hasPassedQualification,
      qualificationSummary.nextRequalificationDueDate,
    );
    const pmDueDate = pmPlan ? pmPlan.nextDueDate.toISOString() : null;
    const pmStatus = derivePmStatus(pmDueDate);

    // "Authenticated operator" may log entries (EQP-6/7) without any elevated permission — the
    // scan itself is the access control. QA-type actions require the equipment permission matrix.
    const availableActions = ['log_usage', 'log_cleaning', 'report_breakdown'];
    if (actor.permissions.includes('equipment:approve') || actor.permissions.includes('equipment:edit')) {
      availableActions.push('record_calibration', 'complete_pm');
    }

    return {
      id: equipment._id.toString(),
      equipmentCode: equipment.equipmentCode,
      name: equipment.name,
      location: equipment.location,
      departmentId: equipment.departmentId.toString(),
      isGmpCritical: equipment.isGmpCritical,
      status: equipment.status,
      calibrationStatus,
      calibrationNextDueDate,
      calibrationBlocksUsage,
      qualificationStatus,
      qualificationNextDueDate: qualificationSummary.nextRequalificationDueDate,
      pmStatus,
      pmDueDate,
      recentLogbookEntries: recentEntries.map(toLogbookEntryData),
      availableActions,
    };
  }

  // EQP-6: whether overdue calibration should block usage logging right now — shared by
  // LogbookService so the rule lives in exactly one place (same derivation as the status card).
  async isUsageBlockedByCalibration(tenantId: string, equipmentId: string): Promise<boolean> {
    const [schedule, tenant] = await Promise.all([
      this.calibrationScheduleModel.findOne({ tenantId, equipmentId }),
      this.tenantModel.findById(tenantId),
    ]);
    const calibrationStatus = deriveCalibrationStatus(schedule ? schedule.nextDueDate.toISOString() : null);
    return calibrationStatus === CalibrationStatus.OVERDUE && resolveBlockUsageWhenCalibrationOverdue(tenant);
  }

  async findOrThrow(tenantId: string, equipmentId: string): Promise<EquipmentDocument> {
    const equipment = await this.equipmentModel.findOne({ _id: equipmentId, tenantId });
    if (!equipment) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Equipment not found.', HttpStatus.NOT_FOUND);
    }
    return equipment;
  }

  private async toData(tenantId: string, equipment: EquipmentDocument): Promise<EquipmentData> {
    const { data: qr } = await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipment._id.toString(),
      entityCode: equipment.equipmentCode,
      entityName: equipment.name,
    });

    return {
      id: equipment._id.toString(),
      tenantId: equipment.tenantId.toString(),
      equipmentCode: equipment.equipmentCode,
      name: equipment.name,
      make: equipment.make,
      modelName: equipment.modelName,
      serialNumber: equipment.serialNumber,
      location: equipment.location,
      departmentId: equipment.departmentId.toString(),
      isGmpCritical: equipment.isGmpCritical,
      status: equipment.status,
      installDate: equipment.installDate ? equipment.installDate.toISOString() : null,
      qr: { code: qr.code, scanUrl: qr.scanUrl },
      createdAt: (equipment as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

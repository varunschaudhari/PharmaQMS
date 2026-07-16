import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  CalibrationDispositionOutcome,
  CalibrationRecordStatus,
  CalibrationResult,
  CalibrationStatus,
  EquipmentStatus,
  ErrorCode,
  SignatureMeaning,
  deriveCalibrationStatus,
  type CalibrationDueEntryData,
  type CalibrationRecordData,
  type CalibrationScheduleData,
  type CreateCalibrationScheduleRequest,
  type DispositionCalibrationRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import type { SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage.interface';
import { AuditService } from '../../platform/audit/audit.service';
import { EsignService } from '../../platform/esign/esign.service';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { EquipmentService } from './equipment.service';
import { CalibrationAgency, CalibrationAgencyDocument } from './schemas/calibration-agency.schema';
import { CalibrationRecord, CalibrationRecordDocument } from './schemas/calibration-record.schema';
import { CalibrationSchedule, CalibrationScheduleDocument } from './schemas/calibration-schedule.schema';
import { Equipment, EquipmentDocument } from './schemas/equipment.schema';

export interface UploadedCertificateFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface CalibrationActor {
  userId: string;
  fullName: string;
}

const ALLOWED_CERTIFICATE_CONTENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_CERTIFICATE_SIZE_BYTES = 20 * 1024 * 1024;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

// EQP-4/EQP-5 (SPEC.md §7.3): calibration is a sub-concern of the Equipment module, not a
// separate top-level business module — EquipmentService is depended on directly here (its
// setCalibrationLockStatus is the ONLY way status may enter/leave DO_NOT_USE; see the guard in
// EquipmentService.transitionStatus()). This does not violate CLAUDE.md's "business modules
// never depend on each other" rule, which concerns separate top-level modules (Documents vs
// Training), not sub-concerns within one module.
@Injectable()
export class CalibrationService {
  constructor(
    @InjectModel(CalibrationSchedule.name) private readonly scheduleModel: Model<CalibrationScheduleDocument>,
    @InjectModel(CalibrationRecord.name) private readonly recordModel: Model<CalibrationRecordDocument>,
    @InjectModel(Equipment.name) private readonly equipmentModel: Model<EquipmentDocument>,
    @InjectModel(CalibrationAgency.name) private readonly agencyModel: Model<CalibrationAgencyDocument>,
    private readonly equipmentService: EquipmentService,
    private readonly auditService: AuditService,
    private readonly esignService: EsignService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  // EQP-4: one active schedule per equipment — creating again replaces the config in place
  // (the unique {tenantId, equipmentId} index plus this upsert is what enforces "one active
  // schedule"; historical schedule changes are not separately versioned in v1).
  async upsertSchedule(
    tenantId: string,
    equipmentId: string,
    actor: CalibrationActor,
    dto: CreateCalibrationScheduleRequest,
  ): Promise<{ before: Record<string, unknown> | null; after: CalibrationScheduleData }> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);

    const existing = await this.scheduleModel.findOne({ tenantId, equipmentId });
    const before = existing
      ? {
          frequencyMonths: existing.frequencyMonths,
          parameters: existing.parameters,
          toleranceClass: existing.toleranceClass,
          agencyType: existing.agencyType,
          agencyName: existing.agencyName,
          agencyId: existing.agencyId,
          nextDueDate: existing.nextDueDate,
        }
      : null;

    // EQP-11: agencyId only applies when external — re-checked here even though the client should
    // never send one alongside 'internal' (never trust the client, same DOC-8 pattern).
    let agencyId: string | null = null;
    if (dto.agencyType === 'external' && dto.agencyId) {
      const agency = await this.agencyModel.findOne({ _id: dto.agencyId, tenantId });
      if (!agency) {
        throw new AppException(ErrorCode.NOT_FOUND, 'Calibration agency not found.', HttpStatus.NOT_FOUND);
      }
      agencyId = dto.agencyId;
    }

    const nextDueDate = new Date(dto.nextDueDate);
    const schedule =
      existing ??
      new this.scheduleModel({ tenantId, equipmentId });
    schedule.frequencyMonths = dto.frequencyMonths;
    schedule.parameters = dto.parameters;
    schedule.toleranceClass = dto.toleranceClass;
    schedule.agencyType = dto.agencyType;
    schedule.agencyName = dto.agencyName ?? null;
    schedule.agencyId = agencyId as unknown as CalibrationScheduleDocument['agencyId'];
    schedule.nextDueDate = nextDueDate;
    await schedule.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.CALIBRATION_SCHEDULED,
      before,
      after: {
        frequencyMonths: schedule.frequencyMonths,
        parameters: schedule.parameters,
        toleranceClass: schedule.toleranceClass,
        agencyType: schedule.agencyType,
        agencyName: schedule.agencyName,
        agencyId: schedule.agencyId,
        nextDueDate: schedule.nextDueDate,
      },
    });

    return { before, after: toScheduleData(schedule) };
  }

  async getSchedule(tenantId: string, equipmentId: string): Promise<CalibrationScheduleData | null> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const schedule = await this.scheduleModel.findOne({ tenantId, equipmentId });
    return schedule ? toScheduleData(schedule) : null;
  }

  async listRecords(tenantId: string, equipmentId: string): Promise<CalibrationRecordData[]> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const records = await this.recordModel.find({ tenantId, equipmentId }).sort({ performedDate: -1 });
    return records.map(toRecordData);
  }

  // EQP-4: the QA-facing calibration-due dashboard feed — every schedule currently DUE_SOON or
  // OVERDUE, independent of (and not gated by) the PLT-6 daily notification scan/dedupe state.
  async listDue(tenantId: string): Promise<CalibrationDueEntryData[]> {
    const schedules = await this.scheduleModel.find({ tenantId }).sort({ nextDueDate: 1 });
    if (schedules.length === 0) {
      return [];
    }
    const equipmentIds = schedules.map((s) => s.equipmentId);
    const equipmentDocs = await this.equipmentModel.find({ tenantId, _id: { $in: equipmentIds } });
    const equipmentById = new Map(equipmentDocs.map((e) => [e._id.toString(), e]));

    const entries: CalibrationDueEntryData[] = [];
    for (const schedule of schedules) {
      const equipment = equipmentById.get(schedule.equipmentId.toString());
      if (!equipment) continue;
      const calibrationStatus = deriveCalibrationStatus(schedule.nextDueDate.toISOString());
      if (calibrationStatus !== CalibrationStatus.DUE_SOON && calibrationStatus !== CalibrationStatus.OVERDUE) {
        continue;
      }
      entries.push({
        equipmentId: equipment._id.toString(),
        equipmentCode: equipment.equipmentCode,
        equipmentName: equipment.name,
        departmentId: equipment.departmentId.toString(),
        calibrationStatus,
        nextDueDate: schedule.nextDueDate.toISOString(),
      });
    }
    return entries;
  }

  // EQP-4/EQP-5: records a performed calibration event. A FAIL/OOT result immediately quarantines
  // the equipment (DO_NOT_USE) at THIS point — before any QA sign-off — because the risk exists
  // the moment the instrument is known out-of-tolerance, not once QA gets around to dispositioning
  // it (Iron Rule regulatory intent: quarantine first, decide second).
  async recordResult(
    tenantId: string,
    equipmentId: string,
    actor: CalibrationActor,
    performedDate: string,
    result: CalibrationResult,
    toleranceNotes: string | null,
    impactAssessmentNote: string | null,
    file: UploadedCertificateFile,
  ): Promise<CalibrationRecordData> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const schedule = await this.scheduleModel.findOne({ tenantId, equipmentId });
    if (!schedule) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'No calibration schedule is configured for this equipment yet.',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.assertValidCertificate(file);
    if (result === CalibrationResult.FAIL && !impactAssessmentNote?.trim()) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'An impact-assessment note is required when a calibration fails (out-of-tolerance).',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Constructed (not .create()) so the required certificateFileKey is set — from the record's
    // own _id — BEFORE the first save/validation, same pattern as DocumentsService's fileKey.
    const record = new this.recordModel({
      tenantId,
      equipmentId,
      scheduleId: schedule._id,
      performedDate: new Date(performedDate),
      result,
      certificateFileKey: '',
      certificateFileName: file.originalname,
      certificateContentType: file.mimetype,
      toleranceNotes: toleranceNotes ?? null,
      impactAssessmentNote: result === CalibrationResult.FAIL ? impactAssessmentNote : null,
      status: CalibrationRecordStatus.PENDING_QA_VERIFICATION,
      deviationRef: null,
      recordedByUserId: actor.userId,
    });
    record.certificateFileKey = `equipment/${tenantId}/calibration/${record._id.toString()}/${file.originalname}`;
    await this.fileStorage.put(record.certificateFileKey, file.buffer, file.mimetype);
    await record.save();

    // EQP-11 (d): expired accreditation never blocks recording (QA decides) — but its presence at
    // the moment of recording IS audited, so QA can see it happened during an inspection.
    let accreditationExpiredWarning = false;
    if (schedule.agencyId) {
      const agency = await this.agencyModel.findOne({ _id: schedule.agencyId, tenantId });
      accreditationExpiredWarning = Boolean(agency?.accreditationValidUntil && agency.accreditationValidUntil < new Date());
    }

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.CALIBRATION_RECORDED,
      before: null,
      after: {
        performedDate: record.performedDate,
        result: record.result,
        fileName: file.originalname,
        ...(accreditationExpiredWarning ? { accreditationExpiredWarning: true } : {}),
      },
    });

    if (result === CalibrationResult.FAIL) {
      // EQP-5: quarantine immediately — before QA disposition — regardless of the equipment's
      // current status (a FAIL always wins), except a RETIRED instrument stays RETIRED.
      const equipment = await this.equipmentService.findOrThrow(tenantId, equipmentId);
      if (equipment.status !== EquipmentStatus.RETIRED && equipment.status !== EquipmentStatus.DO_NOT_USE) {
        await this.equipmentService.setCalibrationLockStatus(tenantId, equipmentId, EquipmentStatus.DO_NOT_USE, actor);
      }
    }

    return toRecordData(record);
  }

  // EQP-4: QA verification e-sign for a PASS result — advances the schedule's nextDueDate.
  async verify(
    tenantId: string,
    equipmentId: string,
    recordId: string,
    signer: SigningContext,
  ): Promise<CalibrationRecordData> {
    const record = await this.findRecordOrThrow(tenantId, equipmentId, recordId);
    if (record.result !== CalibrationResult.PASS) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Only a PASS calibration result can be QA-verified — a FAIL/OOT result requires disposition.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (record.status !== CalibrationRecordStatus.PENDING_QA_VERIFICATION) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'This calibration record has already been QA-actioned.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.VERIFIED_BY,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      entitySnapshot: {
        recordId: record._id.toString(),
        performedDate: record.performedDate.toISOString(),
        result: record.result,
      },
      reason: null,
    });

    record.status = CalibrationRecordStatus.VERIFIED;
    await record.save();

    const schedule = await this.scheduleModel.findOne({ tenantId, equipmentId, _id: record.scheduleId });
    if (schedule) {
      schedule.nextDueDate = new Date(record.performedDate.getTime() + schedule.frequencyMonths * 30 * MILLIS_PER_DAY);
      await schedule.save();
    }

    await this.auditService.record({
      tenantId,
      actor: { userId: signer.userId, fullName: signer.fullName },
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.CALIBRATION_VERIFIED,
      before: { status: CalibrationRecordStatus.PENDING_QA_VERIFICATION },
      after: { status: record.status, nextDueDate: schedule?.nextDueDate ?? null },
    });

    return toRecordData(record);
  }

  // EQP-5: QA disposition e-sign for a FAIL/OOT result — 'release' returns equipment to ACTIVE,
  // 'retain_do_not_use' keeps the quarantine in place. Either way the schedule's nextDueDate is
  // deliberately NOT touched — a disposition is a risk decision, not a recalibration event; only
  // a fresh PASS+VERIFIED record advances the due date.
  async disposition(
    tenantId: string,
    equipmentId: string,
    recordId: string,
    signer: SigningContext,
    dto: DispositionCalibrationRequest,
  ): Promise<CalibrationRecordData> {
    const record = await this.findRecordOrThrow(tenantId, equipmentId, recordId);
    if (record.result !== CalibrationResult.FAIL) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Only a FAIL/OOT calibration result requires disposition.',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (record.status !== CalibrationRecordStatus.PENDING_QA_VERIFICATION) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'This calibration record has already been dispositioned.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.QA_DISPOSITION,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      entitySnapshot: {
        recordId: record._id.toString(),
        outcome: dto.outcome,
        note: dto.note,
      },
      reason: dto.note,
    });

    record.status = CalibrationRecordStatus.DISPOSITIONED;
    record.deviationRef = dto.deviationRef ?? null;
    await record.save();

    if (dto.outcome === CalibrationDispositionOutcome.RELEASE) {
      await this.equipmentService.setCalibrationLockStatus(
        tenantId,
        equipmentId,
        EquipmentStatus.ACTIVE,
        { userId: signer.userId, fullName: signer.fullName },
      );
    }

    await this.auditService.record({
      tenantId,
      actor: { userId: signer.userId, fullName: signer.fullName },
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.CALIBRATION_DISPOSITIONED,
      before: { status: CalibrationRecordStatus.PENDING_QA_VERIFICATION },
      after: { status: record.status, outcome: dto.outcome, deviationRef: record.deviationRef },
      reason: dto.note,
    });

    return toRecordData(record);
  }

  // EQP-11 (e): the certificate registry needs a way to actually open the document, not just list
  // its metadata — mirrors EQP-8's qualification protocol/report download pattern exactly.
  async getCertificateFile(tenantId: string, equipmentId: string, recordId: string): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const record = await this.findRecordOrThrow(tenantId, equipmentId, recordId);
    const stored = await this.fileStorage.get(record.certificateFileKey);
    return { buffer: stored.buffer, contentType: stored.contentType, fileName: record.certificateFileName };
  }

  private async findRecordOrThrow(
    tenantId: string,
    equipmentId: string,
    recordId: string,
  ): Promise<CalibrationRecordDocument> {
    const record = await this.recordModel.findOne({ _id: recordId, tenantId, equipmentId });
    if (!record) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Calibration record not found.', HttpStatus.NOT_FOUND);
    }
    return record;
  }

  private assertValidCertificate(file: UploadedCertificateFile): void {
    if (!file) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'A calibration certificate file is required.', HttpStatus.BAD_REQUEST);
    }
    if (!ALLOWED_CERTIFICATE_CONTENT_TYPES.has(file.mimetype)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Only PDF, JPEG, or PNG certificate files are accepted.', HttpStatus.BAD_REQUEST);
    }
    if (file.size > MAX_CERTIFICATE_SIZE_BYTES) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Certificate file exceeds the 20 MB limit.', HttpStatus.BAD_REQUEST);
    }
  }
}

function toScheduleData(doc: CalibrationScheduleDocument): CalibrationScheduleData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    equipmentId: doc.equipmentId.toString(),
    frequencyMonths: doc.frequencyMonths,
    parameters: doc.parameters,
    toleranceClass: doc.toleranceClass,
    agencyType: doc.agencyType,
    agencyName: doc.agencyName,
    agencyId: doc.agencyId ? doc.agencyId.toString() : null,
    nextDueDate: doc.nextDueDate.toISOString(),
  };
}

function toRecordData(doc: CalibrationRecordDocument): CalibrationRecordData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    equipmentId: doc.equipmentId.toString(),
    scheduleId: doc.scheduleId.toString(),
    performedDate: doc.performedDate.toISOString(),
    result: doc.result,
    certificateFileName: doc.certificateFileName,
    certificateContentType: doc.certificateContentType,
    toleranceNotes: doc.toleranceNotes,
    impactAssessmentNote: doc.impactAssessmentNote,
    status: doc.status,
    deviationRef: doc.deviationRef,
    recordedByUserId: doc.recordedByUserId,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

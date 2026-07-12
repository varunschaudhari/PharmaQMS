import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  ErrorCode,
  QualificationResult,
  QualificationType,
  type CreateQualificationRecordRequest,
  type QualificationRecordData,
} from '@pharmaqms/shared';
import { Model, Types } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage.interface';
import { AuditService } from '../../platform/audit/audit.service';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { EquipmentService } from './equipment.service';
import { computeQualificationSummary } from './qualification-summary.util';
import { QualificationRecord, QualificationRecordDocument } from './schemas/qualification-record.schema';

export interface QualificationActor {
  userId: string;
  fullName: string;
}

export interface UploadedQualificationFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface QualificationSummary {
  hasPassedQualification: boolean;
  nextRequalificationDueDate: string | null;
}

const ALLOWED_FILE_CONTENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const REQUALIFICATION_TYPES = new Set([QualificationType.PQ, QualificationType.REQUALIFICATION]);

// EQP-8 (SPEC.md §7.3): qualification records — a sub-concern of the Equipment module (same
// architectural precedent as EQP-4/5's CalibrationService — see its header comment). Unlike
// calibration, SPEC's one-line EQP-8 requirement never mentions an e-signature, so recording a
// qualification event is a plain permission-gated action (equipment:edit), not a SignatureGuard
// flow — a deliberate reading of the literal spec text, flagged in this session's CHANGELOG.
@Injectable()
export class QualificationService {
  constructor(
    @InjectModel(QualificationRecord.name) private readonly recordModel: Model<QualificationRecordDocument>,
    private readonly equipmentService: EquipmentService,
    private readonly auditService: AuditService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  async recordQualification(
    tenantId: string,
    equipmentId: string,
    actor: QualificationActor,
    dto: CreateQualificationRecordRequest,
    protocolFile: UploadedQualificationFile,
    reportFile: UploadedQualificationFile | null,
  ): Promise<QualificationRecordData> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    this.assertValidFile(protocolFile, 'protocol');
    if (reportFile) {
      this.assertValidFile(reportFile, 'report');
    }

    const requalificationFrequencyMonths =
      REQUALIFICATION_TYPES.has(dto.qualificationType) && dto.result === QualificationResult.PASS
        ? dto.requalificationFrequencyMonths ?? null
        : null;

    // Constructed (not .create()) so the required protocolFileKey is set — from the record's own
    // _id — BEFORE the first save/validation, same pattern as CalibrationService.recordResult.
    const record = new this.recordModel({
      tenantId,
      equipmentId,
      qualificationType: dto.qualificationType,
      performedDate: new Date(dto.performedDate),
      result: dto.result,
      protocolFileKey: '',
      protocolFileName: protocolFile.originalname,
      protocolContentType: protocolFile.mimetype,
      reportFileKey: null,
      reportFileName: reportFile?.originalname ?? null,
      reportContentType: reportFile?.mimetype ?? null,
      notes: dto.notes ?? null,
      requalificationFrequencyMonths,
      recordedByUserId: actor.userId,
    });
    record.protocolFileKey = `equipment/${tenantId}/qualification/${record._id.toString()}/protocol-${protocolFile.originalname}`;
    await this.fileStorage.put(record.protocolFileKey, protocolFile.buffer, protocolFile.mimetype);
    if (reportFile) {
      record.reportFileKey = `equipment/${tenantId}/qualification/${record._id.toString()}/report-${reportFile.originalname}`;
      await this.fileStorage.put(record.reportFileKey, reportFile.buffer, reportFile.mimetype);
    }
    await record.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.QUALIFICATION_RECORDED,
      before: null,
      after: { qualificationType: record.qualificationType, result: record.result, performedDate: record.performedDate },
    });

    return toQualificationRecordData(record);
  }

  // EQP-8: attaches the formal report after the fact — the one permitted mutation on an
  // otherwise-immutable record, allowed exactly once.
  async attachReport(
    tenantId: string,
    equipmentId: string,
    recordId: string,
    actor: QualificationActor,
    reportFile: UploadedQualificationFile,
  ): Promise<QualificationRecordData> {
    const record = await this.recordModel.findOne({ _id: recordId, tenantId, equipmentId });
    if (!record) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Qualification record not found.', HttpStatus.NOT_FOUND);
    }
    if (record.reportFileKey) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'A report has already been attached to this record.', HttpStatus.BAD_REQUEST);
    }
    this.assertValidFile(reportFile, 'report');

    record.reportFileKey = `equipment/${tenantId}/qualification/${record._id.toString()}/report-${reportFile.originalname}`;
    record.reportFileName = reportFile.originalname;
    record.reportContentType = reportFile.mimetype;
    await this.fileStorage.put(record.reportFileKey, reportFile.buffer, reportFile.mimetype);
    await record.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.QUALIFICATION_REPORT_ATTACHED,
      before: { reportFileKey: null },
      after: { reportFileName: reportFile.originalname },
    });

    return toQualificationRecordData(record);
  }

  async listForEquipment(tenantId: string, equipmentId: string): Promise<QualificationRecordData[]> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const records = await this.recordModel.find({ tenantId, equipmentId }).sort({ performedDate: -1 });
    return records.map(toQualificationRecordData);
  }

  async getFile(
    tenantId: string,
    equipmentId: string,
    recordId: string,
    fileType: 'protocol' | 'report',
  ): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const record = await this.recordModel.findOne({ _id: recordId, tenantId, equipmentId });
    if (!record) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Qualification record not found.', HttpStatus.NOT_FOUND);
    }
    const fileKey = fileType === 'protocol' ? record.protocolFileKey : record.reportFileKey;
    const fileName = fileType === 'protocol' ? record.protocolFileName : record.reportFileName;
    if (!fileKey || !fileName) {
      throw new AppException(ErrorCode.NOT_FOUND, `No ${fileType} file found for this qualification record.`, HttpStatus.NOT_FOUND);
    }
    const stored = await this.fileStorage.get(fileKey);
    return { buffer: stored.buffer, contentType: stored.contentType, fileName };
  }

  // EQP-3/EQP-8: the equipment-level qualification summary the status card and the
  // requalification-due scanner both read.
  async getSummary(tenantId: string, equipmentId: string): Promise<QualificationSummary> {
    return computeQualificationSummary(this.recordModel, tenantId, equipmentId);
  }

  // EQP-8 scanner support: every equipment in the tenant with a requalification due date on the
  // calendar (i.e. has a PASSed PQ/REQUALIFICATION with a frequency set).
  async listRequalificationSchedule(tenantId: string): Promise<Array<{ equipmentId: string; nextRequalificationDueDate: string }>> {
    const equipmentIds: Types.ObjectId[] = await this.recordModel.distinct('equipmentId', {
      tenantId,
      qualificationType: { $in: [...REQUALIFICATION_TYPES] },
      result: QualificationResult.PASS,
      requalificationFrequencyMonths: { $ne: null },
    });

    const results: Array<{ equipmentId: string; nextRequalificationDueDate: string }> = [];
    for (const equipmentId of equipmentIds) {
      const summary = await this.getSummary(tenantId, equipmentId.toString());
      if (summary.nextRequalificationDueDate) {
        results.push({ equipmentId: equipmentId.toString(), nextRequalificationDueDate: summary.nextRequalificationDueDate });
      }
    }
    return results;
  }

  private assertValidFile(file: UploadedQualificationFile, label: string): void {
    if (!file) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, `A ${label} file is required.`, HttpStatus.BAD_REQUEST);
    }
    if (!ALLOWED_FILE_CONTENT_TYPES.has(file.mimetype)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, `Only PDF, JPEG, or PNG files are accepted for the ${label}.`, HttpStatus.BAD_REQUEST);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, `The ${label} file exceeds the 20 MB limit.`, HttpStatus.BAD_REQUEST);
    }
  }
}

function toQualificationRecordData(doc: QualificationRecordDocument): QualificationRecordData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    equipmentId: doc.equipmentId.toString(),
    qualificationType: doc.qualificationType,
    performedDate: doc.performedDate.toISOString(),
    result: doc.result,
    protocolFileName: doc.protocolFileName,
    protocolContentType: doc.protocolContentType,
    reportFileName: doc.reportFileName,
    reportContentType: doc.reportContentType,
    notes: doc.notes,
    requalificationFrequencyMonths: doc.requalificationFrequencyMonths,
    recordedByUserId: doc.recordedByUserId,
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  CleaningType,
  EquipmentStatus,
  ErrorCode,
  LogbookEntryType,
  type LogbookEntryData,
  type MaintenanceTaskData,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { FILE_STORAGE, type FileStorage, type StoredFile } from '../../common/storage/file-storage.interface';
import { AuditService } from '../../platform/audit/audit.service';
import { EQUIPMENT_ENTITY_TYPE } from './equipment-entity-types';
import { EquipmentService } from './equipment.service';
import { toLogbookEntryData } from './logbook-mapper';
import { MaintenanceService } from './maintenance.service';
import { LogbookEntry, LogbookEntryDocument } from './schemas/logbook-entry.schema';

export interface LogbookActor {
  userId: string;
  fullName: string;
}

export interface UploadedPhoto {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED_PHOTO_CONTENT_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;

// EQP-6/EQP-7 (SPEC.md §7.3): the digital logbook, a sub-concern of the Equipment module (same
// relationship as EQP-4/5's CalibrationService — see calibration.service.ts's header comment).
// Every entry is immutable (enforced at the schema layer, see logbook-entry.schema.ts); a
// correction is a NEW AMENDMENT entry, never an edit.
@Injectable()
export class LogbookService {
  constructor(
    @InjectModel(LogbookEntry.name) private readonly entryModel: Model<LogbookEntryDocument>,
    private readonly equipmentService: EquipmentService,
    private readonly maintenanceService: MaintenanceService,
    private readonly auditService: AuditService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
  ) {}

  // EQP-6: starts a usage session. Blocked when the equipment is Retired/Do Not Use, or (EQP-4,
  // tenant-configurable) when calibration is overdue — the actual enforcement point that
  // Session 15's calibrationBlocksUsage flag was built ahead of.
  async logUsageStart(tenantId: string, equipmentId: string, actor: LogbookActor, productBatchRef: string): Promise<LogbookEntryData> {
    const equipment = await this.equipmentService.findOrThrow(tenantId, equipmentId);
    this.assertUsageAllowed(equipment.status);

    if (await this.equipmentService.isUsageBlockedByCalibration(tenantId, equipmentId)) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Calibration is overdue for this equipment — usage logging is blocked until it is resolved.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const openSession = await this.findOpenUsageSession(tenantId, equipmentId);
    if (openSession) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'A usage session is already open for this equipment — stop it before starting a new one.',
        HttpStatus.BAD_REQUEST,
      );
    }

    return this.createEntry(tenantId, equipmentId, actor, {
      entryType: LogbookEntryType.USAGE_START,
      productBatchRef,
    });
  }

  // EQP-6: stops the currently open usage session. Always allowed (closing out is never
  // blocked) — an operator must be able to end a session even against overdue-calibration
  // equipment, since the equipment may already be mid-use.
  async logUsageStop(tenantId: string, equipmentId: string, actor: LogbookActor, productBatchRef?: string): Promise<LogbookEntryData> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const openSession = await this.findOpenUsageSession(tenantId, equipmentId);
    if (!openSession) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'No active usage session to stop.', HttpStatus.BAD_REQUEST);
    }

    return this.createEntry(tenantId, equipmentId, actor, {
      entryType: LogbookEntryType.USAGE_STOP,
      productBatchRef: productBatchRef ?? openSession.productBatchRef,
    });
  }

  async logCleaning(tenantId: string, equipmentId: string, actor: LogbookActor, cleaningType: CleaningType): Promise<LogbookEntryData> {
    const equipment = await this.equipmentService.findOrThrow(tenantId, equipmentId);
    this.assertNotRetired(equipment.status);
    return this.createEntry(tenantId, equipmentId, actor, { entryType: LogbookEntryType.CLEANING, cleaningType });
  }

  // EQP-6/EQP-7: a breakdown report immediately auto-creates a maintenance task assigned to the
  // tenant's maintenance role.
  async logBreakdown(
    tenantId: string,
    equipmentId: string,
    actor: LogbookActor,
    description: string,
    photo: UploadedPhoto | null,
  ): Promise<{ entry: LogbookEntryData; maintenanceTask: MaintenanceTaskData }> {
    const equipment = await this.equipmentService.findOrThrow(tenantId, equipmentId);
    this.assertNotRetired(equipment.status);
    if (photo) {
      this.assertValidPhoto(photo);
    }

    const doc = new this.entryModel({
      tenantId,
      equipmentId,
      entryType: LogbookEntryType.BREAKDOWN,
      description,
      performedByUserId: actor.userId,
      performedByUserFullName: actor.fullName,
      occurredAt: new Date(),
    });
    if (photo) {
      doc.photoFileKey = `equipment/${tenantId}/logbook/${doc._id.toString()}/${photo.originalname}`;
      doc.photoFileName = photo.originalname;
      doc.photoContentType = photo.mimetype;
      await this.fileStorage.put(doc.photoFileKey, photo.buffer, photo.mimetype);
    }
    await doc.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.LOGBOOK_ENTRY_LOGGED,
      before: null,
      after: { entryType: doc.entryType, description },
    });

    const maintenanceTask = await this.maintenanceService.createTaskFromBreakdown(
      tenantId,
      { id: equipmentId, equipmentCode: equipment.equipmentCode, name: equipment.name },
      doc._id.toString(),
      actor,
    );

    return { entry: toLogbookEntryData(doc), maintenanceTask };
  }

  // EQP-6: the ONLY way to "correct" an entry — a brand new AMENDMENT entry referencing the
  // one it corrects. The original is never touched (schema-enforced immutability).
  async createAmendment(
    tenantId: string,
    equipmentId: string,
    actor: LogbookActor,
    amendsEntryId: string,
    description: string,
  ): Promise<LogbookEntryData> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const original = await this.entryModel.findOne({ _id: amendsEntryId, tenantId, equipmentId });
    if (!original) {
      throw new AppException(ErrorCode.NOT_FOUND, 'The logbook entry being amended was not found.', HttpStatus.NOT_FOUND);
    }

    return this.createEntry(tenantId, equipmentId, actor, {
      entryType: LogbookEntryType.AMENDMENT,
      description,
      amendsEntryId,
    });
  }

  async listForEquipment(tenantId: string, equipmentId: string): Promise<LogbookEntryData[]> {
    await this.equipmentService.findOrThrow(tenantId, equipmentId);
    const entries = await this.entryModel.find({ tenantId, equipmentId }).sort({ occurredAt: -1 });
    return entries.map(toLogbookEntryData);
  }

  async getPhoto(tenantId: string, equipmentId: string, entryId: string): Promise<StoredFile & { fileName: string }> {
    const entry = await this.entryModel.findOne({ _id: entryId, tenantId, equipmentId });
    if (!entry || !entry.photoFileKey) {
      throw new AppException(ErrorCode.NOT_FOUND, 'No photo found for this logbook entry.', HttpStatus.NOT_FOUND);
    }
    const stored = await this.fileStorage.get(entry.photoFileKey);
    return { ...stored, fileName: entry.photoFileName ?? 'photo' };
  }

  private async createEntry(
    tenantId: string,
    equipmentId: string,
    actor: LogbookActor,
    fields: {
      entryType: LogbookEntryType;
      productBatchRef?: string | null;
      cleaningType?: CleaningType | null;
      description?: string | null;
      amendsEntryId?: string | null;
    },
  ): Promise<LogbookEntryData> {
    const entry = await this.entryModel.create({
      tenantId,
      equipmentId,
      entryType: fields.entryType,
      productBatchRef: fields.productBatchRef ?? null,
      cleaningType: fields.cleaningType ?? null,
      description: fields.description ?? null,
      amendsEntryId: fields.amendsEntryId ?? null,
      performedByUserId: actor.userId,
      performedByUserFullName: actor.fullName,
      occurredAt: new Date(),
    });

    await this.auditService.record({
      tenantId,
      actor,
      entityType: EQUIPMENT_ENTITY_TYPE,
      entityId: equipmentId,
      action: AuditAction.LOGBOOK_ENTRY_LOGGED,
      before: null,
      after: { entryType: entry.entryType },
    });

    return toLogbookEntryData(entry);
  }

  // A usage session is "open" when the most recent usage-type entry is a START (i.e. no
  // matching STOP has been logged since).
  private async findOpenUsageSession(tenantId: string, equipmentId: string): Promise<LogbookEntryDocument | null> {
    const latest = await this.entryModel
      .findOne({ tenantId, equipmentId, entryType: { $in: [LogbookEntryType.USAGE_START, LogbookEntryType.USAGE_STOP] } })
      .sort({ occurredAt: -1 });
    return latest && latest.entryType === LogbookEntryType.USAGE_START ? latest : null;
  }

  private assertUsageAllowed(status: EquipmentStatus): void {
    if (status === EquipmentStatus.DO_NOT_USE) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Equipment is flagged Do Not Use pending QA disposition — usage logging is blocked.',
        HttpStatus.BAD_REQUEST,
      );
    }
    this.assertNotRetired(status);
  }

  private assertNotRetired(status: EquipmentStatus): void {
    if (status === EquipmentStatus.RETIRED) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Equipment is Retired — no further logbook entries may be logged.', HttpStatus.BAD_REQUEST);
    }
  }

  private assertValidPhoto(photo: UploadedPhoto): void {
    if (!ALLOWED_PHOTO_CONTENT_TYPES.has(photo.mimetype)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Only JPEG or PNG photos are accepted.', HttpStatus.BAD_REQUEST);
    }
    if (photo.size > MAX_PHOTO_SIZE_BYTES) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Photo exceeds the 10 MB limit.', HttpStatus.BAD_REQUEST);
    }
  }
}

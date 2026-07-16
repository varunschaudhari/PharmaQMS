import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  assertCalibrationAgencyStatusTransition,
  AuditAction,
  CalibrationAgencyStatus,
  CalibrationStatus,
  deriveCalibrationStatus,
  ErrorCode,
  type CalibrationAgencyData,
  type CalibrationCertificateRegistryEntryData,
  type CalibrationDueByAgencyEntryData,
  type CreateCalibrationAgencyRequest,
  type ListCalibrationCertificatesQuery,
  type UpdateCalibrationAgencyRequest,
} from '@pharmaqms/shared';
import { Model, Types } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { PdfRenderService } from '../../common/pdf/pdf-render.service';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage.interface';
import { AuditService } from '../../platform/audit/audit.service';
import { calibrationDueByAgencyHtml } from './calibration-due-by-agency-html';
import { CalibrationAgency, CalibrationAgencyDocument } from './schemas/calibration-agency.schema';
import { CalibrationRecord, CalibrationRecordDocument } from './schemas/calibration-record.schema';
import { CalibrationSchedule, CalibrationScheduleDocument } from './schemas/calibration-schedule.schema';
import { Equipment, EquipmentDocument } from './schemas/equipment.schema';

export interface CalibrationAgencyActor {
  userId: string;
  fullName: string;
}

export interface UploadedAccreditationCertificateFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const CALIBRATION_AGENCY_ENTITY_TYPE = 'CalibrationAgency';
const ALLOWED_CERTIFICATE_CONTENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_CERTIFICATE_SIZE_BYTES = 20 * 1024 * 1024;

// EQP-11 (SPEC.md §7.3): external calibration agency master — a sub-concern of the Equipment
// module, same architectural precedent as CalibrationService/LogbookService depending directly on
// EquipmentService (CLAUDE.md's "business modules never depend on each other" concerns separate
// TOP-LEVEL modules, not sub-concerns within one). Injects the raw CalibrationSchedule/
// CalibrationRecord/Equipment models directly (not CalibrationService) so CalibrationService can
// depend on THIS service (or its model) without a circular dependency.
@Injectable()
export class CalibrationAgencyService {
  constructor(
    @InjectModel(CalibrationAgency.name) private readonly agencyModel: Model<CalibrationAgencyDocument>,
    @InjectModel(CalibrationSchedule.name) private readonly scheduleModel: Model<CalibrationScheduleDocument>,
    @InjectModel(CalibrationRecord.name) private readonly recordModel: Model<CalibrationRecordDocument>,
    @InjectModel(Equipment.name) private readonly equipmentModel: Model<EquipmentDocument>,
    private readonly auditService: AuditService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
    private readonly pdfRenderService: PdfRenderService,
  ) {}

  async create(tenantId: string, dto: CreateCalibrationAgencyRequest, actor: CalibrationAgencyActor): Promise<CalibrationAgencyData> {
    const agency = await this.agencyModel.create({
      tenantId,
      name: dto.name,
      contactName: dto.contactName ?? null,
      contactEmail: dto.contactEmail || null,
      contactPhone: dto.contactPhone ?? null,
      accreditationNumber: dto.accreditationNumber ?? null,
      accreditationValidUntil: dto.accreditationValidUntil ? new Date(dto.accreditationValidUntil) : null,
      status: CalibrationAgencyStatus.ACTIVE,
    });

    await this.auditService.record({
      tenantId,
      actor,
      entityType: CALIBRATION_AGENCY_ENTITY_TYPE,
      entityId: agency._id.toString(),
      action: AuditAction.CREATE,
      before: null,
      after: { name: agency.name, accreditationNumber: agency.accreditationNumber },
    });

    return toAgencyData(agency);
  }

  async update(
    tenantId: string,
    agencyId: string,
    dto: UpdateCalibrationAgencyRequest,
    actor: CalibrationAgencyActor,
  ): Promise<{ before: Record<string, unknown>; after: CalibrationAgencyData }> {
    const agency = await this.findOrThrow(tenantId, agencyId);
    const before = {
      name: agency.name,
      contactName: agency.contactName,
      contactEmail: agency.contactEmail,
      contactPhone: agency.contactPhone,
      accreditationNumber: agency.accreditationNumber,
      accreditationValidUntil: agency.accreditationValidUntil,
    };

    if (dto.name !== undefined) agency.name = dto.name;
    if (dto.contactName !== undefined) agency.contactName = dto.contactName;
    if (dto.contactEmail !== undefined) agency.contactEmail = dto.contactEmail || null;
    if (dto.contactPhone !== undefined) agency.contactPhone = dto.contactPhone;
    if (dto.accreditationNumber !== undefined) agency.accreditationNumber = dto.accreditationNumber;
    if (dto.accreditationValidUntil !== undefined) {
      agency.accreditationValidUntil = dto.accreditationValidUntil ? new Date(dto.accreditationValidUntil) : null;
    }
    await agency.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: CALIBRATION_AGENCY_ENTITY_TYPE,
      entityId: agency._id.toString(),
      action: AuditAction.UPDATE,
      before,
      after: {
        name: agency.name,
        contactName: agency.contactName,
        contactEmail: agency.contactEmail,
        contactPhone: agency.contactPhone,
        accreditationNumber: agency.accreditationNumber,
        accreditationValidUntil: agency.accreditationValidUntil,
      },
    });

    return { before, after: toAgencyData(agency) };
  }

  // EQP-11: the only way status changes — an explicit transition map (invalid throws, CLAUDE.md).
  // Suspended is reversible, unlike Room/Equipment's terminal Retired.
  async transitionStatus(
    tenantId: string,
    agencyId: string,
    toStatus: CalibrationAgencyStatus,
    actor: CalibrationAgencyActor,
  ): Promise<{ before: Record<string, unknown>; after: CalibrationAgencyData }> {
    const agency = await this.findOrThrow(tenantId, agencyId);
    const fromStatus = agency.status;

    try {
      assertCalibrationAgencyStatusTransition(fromStatus, toStatus);
    } catch (error) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid calibration agency status transition.',
        HttpStatus.BAD_REQUEST,
      );
    }

    agency.status = toStatus;
    await agency.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: CALIBRATION_AGENCY_ENTITY_TYPE,
      entityId: agency._id.toString(),
      action: AuditAction.STATUS_CHANGE,
      before: { status: fromStatus },
      after: { status: toStatus },
    });

    return { before: { status: fromStatus }, after: toAgencyData(agency) };
  }

  // EQP-11 (a): accreditation certificate uploads — multiple over time (renewals), each kept.
  async uploadCertificate(
    tenantId: string,
    agencyId: string,
    actor: CalibrationAgencyActor,
    file: UploadedAccreditationCertificateFile,
  ): Promise<CalibrationAgencyData> {
    const agency = await this.findOrThrow(tenantId, agencyId);
    this.assertValidCertificate(file);

    const certificateId = new Types.ObjectId();
    const fileKey = `equipment/${tenantId}/calibration-agencies/${agencyId}/${certificateId.toString()}/${file.originalname}`;
    await this.fileStorage.put(fileKey, file.buffer, file.mimetype);

    agency.certificates.push({
      _id: certificateId,
      fileKey,
      fileName: file.originalname,
      contentType: file.mimetype,
      uploadedAt: new Date(),
    });
    await agency.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: CALIBRATION_AGENCY_ENTITY_TYPE,
      entityId: agency._id.toString(),
      action: AuditAction.CALIBRATION_CERTIFICATE_UPLOADED,
      before: null,
      after: { fileName: file.originalname },
    });

    return toAgencyData(agency);
  }

  async getCertificateFile(tenantId: string, agencyId: string, certificateId: string): Promise<{ buffer: Buffer; contentType: string; fileName: string }> {
    const agency = await this.findOrThrow(tenantId, agencyId);
    const certificate = agency.certificates.find((c) => c._id.toString() === certificateId);
    if (!certificate) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Accreditation certificate not found.', HttpStatus.NOT_FOUND);
    }
    const stored = await this.fileStorage.get(certificate.fileKey);
    return { buffer: stored.buffer, contentType: stored.contentType, fileName: certificate.fileName };
  }

  async list(tenantId: string): Promise<CalibrationAgencyData[]> {
    const agencies = await this.agencyModel.find({ tenantId }).sort({ name: 1 });
    return agencies.map(toAgencyData);
  }

  async get(tenantId: string, agencyId: string): Promise<CalibrationAgencyData> {
    const agency = await this.findOrThrow(tenantId, agencyId);
    return toAgencyData(agency);
  }

  async findOrThrow(tenantId: string, agencyId: string): Promise<CalibrationAgencyDocument> {
    const agency = await this.agencyModel.findOne({ _id: agencyId, tenantId });
    if (!agency) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Calibration agency not found.', HttpStatus.NOT_FOUND);
    }
    return agency;
  }

  // EQP-11 (d): whether an agency's accreditation is expired right now — a warning only, never a
  // block (QA decides what to do with a calibration recorded during the flag).
  isAccreditationExpired(agency: Pick<CalibrationAgencyDocument, 'accreditationValidUntil'>, now: Date = new Date()): boolean {
    return agency.accreditationValidUntil !== null && agency.accreditationValidUntil < now;
  }

  // EQP-11 (c): agency-wise due list — "this is what QA sends the agency each month."
  async listDueByAgency(tenantId: string): Promise<CalibrationDueByAgencyEntryData[]> {
    const schedules = await this.scheduleModel.find({ tenantId, agencyId: { $ne: null } }).sort({ nextDueDate: 1 });
    if (schedules.length === 0) {
      return [];
    }

    const agencyIds = [...new Set(schedules.map((s) => s.agencyId!.toString()))];
    const equipmentIds = schedules.map((s) => s.equipmentId);
    const [agencies, equipmentDocs] = await Promise.all([
      this.agencyModel.find({ tenantId, _id: { $in: agencyIds } }),
      this.equipmentModel.find({ tenantId, _id: { $in: equipmentIds } }),
    ]);
    const agencyById = new Map(agencies.map((a) => [a._id.toString(), a]));
    const equipmentById = new Map(equipmentDocs.map((e) => [e._id.toString(), e]));

    const entries: CalibrationDueByAgencyEntryData[] = [];
    for (const schedule of schedules) {
      const agency = agencyById.get(schedule.agencyId!.toString());
      const equipment = equipmentById.get(schedule.equipmentId.toString());
      if (!agency || !equipment) continue;

      const calibrationStatus = deriveCalibrationStatus(schedule.nextDueDate.toISOString());
      if (calibrationStatus !== CalibrationStatus.DUE_SOON && calibrationStatus !== CalibrationStatus.OVERDUE) {
        continue;
      }

      entries.push({
        agencyId: agency._id.toString(),
        agencyName: agency.name,
        equipmentId: equipment._id.toString(),
        equipmentCode: equipment.equipmentCode,
        equipmentName: equipment.name,
        calibrationStatus,
        nextDueDate: schedule.nextDueDate.toISOString(),
        accreditationExpired: this.isAccreditationExpired(agency),
      });
    }
    return entries;
  }

  // EQP-11 (e): certificate registry — every calibration record with an uploaded certificate,
  // filterable by agency/equipment/date.
  async listCertificates(tenantId: string, query: ListCalibrationCertificatesQuery): Promise<CalibrationCertificateRegistryEntryData[]> {
    const recordFilter: Record<string, unknown> = { tenantId };
    if (query.equipmentId) recordFilter.equipmentId = query.equipmentId;
    if (query.fromDate || query.toDate) {
      const dateFilter: Record<string, Date> = {};
      if (query.fromDate) dateFilter.$gte = new Date(query.fromDate);
      if (query.toDate) dateFilter.$lte = new Date(query.toDate);
      recordFilter.performedDate = dateFilter;
    }

    const records = await this.recordModel.find(recordFilter).sort({ performedDate: -1 });
    if (records.length === 0) {
      return [];
    }

    const scheduleIds = [...new Set(records.map((r) => r.scheduleId.toString()))];
    const schedules = await this.scheduleModel.find({ tenantId, _id: { $in: scheduleIds } });
    const scheduleById = new Map(schedules.map((s) => [s._id.toString(), s]));

    const agencyIds = [...new Set(schedules.filter((s) => s.agencyId).map((s) => s.agencyId!.toString()))];
    const equipmentIds = [...new Set(records.map((r) => r.equipmentId.toString()))];
    const [agencies, equipmentDocs] = await Promise.all([
      this.agencyModel.find({ tenantId, _id: { $in: agencyIds } }),
      this.equipmentModel.find({ tenantId, _id: { $in: equipmentIds } }),
    ]);
    const agencyById = new Map(agencies.map((a) => [a._id.toString(), a]));
    const equipmentById = new Map(equipmentDocs.map((e) => [e._id.toString(), e]));

    const entries: CalibrationCertificateRegistryEntryData[] = [];
    for (const record of records) {
      const equipment = equipmentById.get(record.equipmentId.toString());
      if (!equipment) continue;
      const schedule = scheduleById.get(record.scheduleId.toString());
      const agency = schedule?.agencyId ? agencyById.get(schedule.agencyId.toString()) : undefined;
      if (query.agencyId && agency?._id.toString() !== query.agencyId) continue;

      entries.push({
        recordId: record._id.toString(),
        equipmentId: equipment._id.toString(),
        equipmentCode: equipment.equipmentCode,
        equipmentName: equipment.name,
        agencyId: agency ? agency._id.toString() : null,
        agencyName: agency ? agency.name : null,
        performedDate: record.performedDate.toISOString(),
        result: record.result,
        certificateFileName: record.certificateFileName,
      });
    }
    return entries;
  }

  // EQP-11 (c): CSV export of the agency-wise due list — QA sends this to each agency monthly.
  async exportDueByAgencyCsv(tenantId: string): Promise<string> {
    const entries = await this.listDueByAgency(tenantId);
    const columns = ['agencyName', 'equipmentCode', 'equipmentName', 'calibrationStatus', 'nextDueDate', 'accreditationExpired'] as const;
    const header = columns.join(',');
    const rows = entries.map((entry) => columns.map((column) => escapeCsvValue(entry[column])).join(','));
    return [header, ...rows].join('\n');
  }

  // EQP-11 (c): PDF export of the agency-wise due list — same puppeteer seam as EQP-10/TRN-4,
  // grouped by agency, alongside the CSV export above (the session brief called for both).
  async generateDueByAgencyPdf(tenantId: string): Promise<Buffer> {
    const entries = await this.listDueByAgency(tenantId);
    const html = calibrationDueByAgencyHtml(entries);
    return this.pdfRenderService.render(html, { preferCSSPageSize: true });
  }

  private assertValidCertificate(file: UploadedAccreditationCertificateFile): void {
    if (!file) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'An accreditation certificate file is required.', HttpStatus.BAD_REQUEST);
    }
    if (!ALLOWED_CERTIFICATE_CONTENT_TYPES.has(file.mimetype)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Only PDF, JPEG, or PNG certificate files are accepted.', HttpStatus.BAD_REQUEST);
    }
    if (file.size > MAX_CERTIFICATE_SIZE_BYTES) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Certificate file exceeds the 20 MB limit.', HttpStatus.BAD_REQUEST);
    }
  }
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = String(value);
  return /[",\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toAgencyData(doc: CalibrationAgencyDocument): CalibrationAgencyData {
  return {
    id: doc._id.toString(),
    tenantId: doc.tenantId.toString(),
    name: doc.name,
    contactName: doc.contactName,
    contactEmail: doc.contactEmail,
    contactPhone: doc.contactPhone,
    accreditationNumber: doc.accreditationNumber,
    accreditationValidUntil: doc.accreditationValidUntil ? doc.accreditationValidUntil.toISOString() : null,
    status: doc.status,
    certificates: doc.certificates.map((c) => ({
      id: c._id.toString(),
      fileName: c.fileName,
      contentType: c.contentType,
      uploadedAt: c.uploadedAt.toISOString(),
    })),
    createdAt: (doc as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

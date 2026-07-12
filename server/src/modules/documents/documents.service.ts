import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import {
  AuditAction,
  DOCUMENT_TRAINING_TARGET_CHANGED_EVENT,
  DocumentStatus,
  DocumentVersionState,
  ErrorCode,
  SignatureMeaning,
  assertDocumentVersionTransition,
  formatVersionLabel,
  type CreateDocumentRequest,
  type CreateDocumentVersionRequest,
  type DocumentData,
  type DocumentTrainingTargetChangedEvent,
  type DocumentVersionData,
  type ListDocumentsQuery,
  type UpdateDocumentDistributionRequest,
  type UpdateDocumentRequest,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import type { SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { FILE_STORAGE, type FileStorage, type StoredFile } from '../../common/storage/file-storage.interface';
import { AuditService } from '../../platform/audit/audit.service';
import { EsignService } from '../../platform/esign/esign.service';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { Department, DepartmentDocument } from '../../platform/tenant/schemas/department.schema';
import { WorkflowService } from '../../platform/workflow/workflow.service';
import { DOCUMENT_ENTITY_TYPE, DOCUMENT_VERSION_ENTITY_TYPE } from './document-entity-types';
import { DocumentEntity, DocumentEntityDocument } from './schemas/document.schema';
import { DocumentVersion, DocumentVersionDocument } from './schemas/document-version.schema';

export { DOCUMENT_ENTITY_TYPE, DOCUMENT_VERSION_ENTITY_TYPE } from './document-entity-types';

export interface UploadedDocumentFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface DocumentActor {
  userId: string;
  fullName: string;
}

const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
]);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

// States in which a version is still moving toward Effective — while one exists, no new
// version may be drafted for the same document.
const IN_FLIGHT_STATES = [
  DocumentVersionState.DRAFT,
  DocumentVersionState.UNDER_REVIEW,
  DocumentVersionState.UNDER_APPROVAL,
];

@Injectable()
export class DocumentsService {
  constructor(
    @InjectModel(DocumentEntity.name) private readonly documentModel: Model<DocumentEntityDocument>,
    @InjectModel(DocumentVersion.name) private readonly versionModel: Model<DocumentVersionDocument>,
    @InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
    @Inject(FILE_STORAGE) private readonly fileStorage: FileStorage,
    private readonly workflowService: WorkflowService,
    private readonly esignService: EsignService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // DOC-1: create the document with metadata + its 1.0 draft version from the uploaded file.
  async createDocument(
    tenantId: string,
    actor: DocumentActor,
    dto: CreateDocumentRequest,
    file: UploadedDocumentFile,
  ): Promise<DocumentData> {
    this.assertValidFile(file);

    const department = await this.departmentModel.findOne({ _id: dto.departmentId, tenantId, isActive: true });
    if (!department) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Department not found.', HttpStatus.NOT_FOUND);
    }

    // PLT-5: numbering scheme per document type (e.g. entityType SOP, prefix SOP, department
    // token -> SOP-QA-001). The department code is always passed; schemes ignore it when not
    // configured to use it.
    const docNumber = await this.numberingService.generateNumber(
      tenantId,
      dto.docType.toUpperCase(),
      department.code,
    );

    const document = await this.documentModel.create({
      tenantId,
      docNumber,
      title: dto.title,
      docType: dto.docType,
      departmentId: dto.departmentId,
      reviewFrequencyMonths: dto.reviewFrequencyMonths,
      authorId: actor.userId,
    });

    await this.createVersionDocument(tenantId, actor, document, 1, 0, null, file);

    return this.toDocumentData(tenantId, document);
  }

  async updateDocument(
    tenantId: string,
    documentId: string,
    dto: UpdateDocumentRequest,
  ): Promise<{ before: Record<string, unknown>; after: DocumentData }> {
    const document = await this.findDocumentOrThrow(tenantId, documentId);
    const before = { title: document.title, reviewFrequencyMonths: document.reviewFrequencyMonths };

    if (dto.title !== undefined) document.title = dto.title;
    if (dto.reviewFrequencyMonths !== undefined) document.reviewFrequencyMonths = dto.reviewFrequencyMonths;
    await document.save();

    return { before, after: await this.toDocumentData(tenantId, document) };
  }

  // DOC-9: who must be trained on this document (TRN-1's mapping source). Broadcasts a full
  // snapshot so TRN can sync assignments without depending on the Documents module directly.
  async updateDistribution(
    tenantId: string,
    documentId: string,
    dto: UpdateDocumentDistributionRequest,
  ): Promise<{ before: Record<string, unknown>; after: DocumentData }> {
    const document = await this.findDocumentOrThrow(tenantId, documentId);
    const before = {
      distributionRoleIds: document.distributionRoleIds,
      distributionDepartmentIds: document.distributionDepartmentIds,
    };

    document.distributionRoleIds = dto.roleIds;
    document.distributionDepartmentIds = dto.departmentIds;
    await document.save();

    await this.emitTrainingTargetChanged(tenantId, document);

    return { before, after: await this.toDocumentData(tenantId, document) };
  }

  // DOC-2 (major/minor) + DOC-8 (mandatory change summary — also enforced by the zod schema;
  // re-checked here because the service is the last line of defense).
  async createVersion(
    tenantId: string,
    actor: DocumentActor,
    documentId: string,
    dto: CreateDocumentVersionRequest,
    file: UploadedDocumentFile,
  ): Promise<DocumentVersionData> {
    this.assertValidFile(file);
    if (!dto.changeSummary || dto.changeSummary.trim().length === 0) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'A change summary (what changed and why) is required on every new version.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const document = await this.findDocumentOrThrow(tenantId, documentId);

    const inFlight = await this.versionModel.findOne({
      tenantId,
      documentId: document._id,
      state: { $in: IN_FLIGHT_STATES },
    });
    if (inFlight) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Version ${formatVersionLabel(inFlight.majorVersion, inFlight.minorVersion)} is still ${inFlight.state} — finish or cancel it before drafting another version.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const latest = await this.latestVersionOrThrow(tenantId, document._id.toString());
    const [major, minor] =
      dto.bump === 'major' ? [latest.majorVersion + 1, 0] : [latest.majorVersion, latest.minorVersion + 1];

    const version = await this.createVersionDocument(tenantId, actor, document, major, minor, dto.changeSummary, file);

    // DOC-2: recorded against the Document — its HistoryTab is the audit hub.
    await this.auditService.record({
      tenantId,
      actor: { userId: actor.userId, fullName: actor.fullName },
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: document._id.toString(),
      action: AuditAction.VERSION_CREATED,
      before: null,
      after: { version: formatVersionLabel(major, minor), fileName: file.originalname },
      reason: dto.changeSummary,
    });

    return toVersionData(version);
  }

  // The ONLY way a version's state changes (CLAUDE.md: explicit transition map; invalid throws).
  // Becoming EFFECTIVE enforces DOC-2's single-Effective invariant by auto-superseding the
  // prior Effective version — both status changes audited.
  async transitionVersion(
    tenantId: string,
    versionId: string,
    toState: DocumentVersionState,
    actor: DocumentActor | null,
    reason: string | null,
  ): Promise<DocumentVersionData> {
    const version = await this.findVersionOrThrow(tenantId, versionId);
    const fromState = version.state;

    try {
      assertDocumentVersionTransition(fromState, toState);
    } catch (error) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid document version transition.',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (toState === DocumentVersionState.EFFECTIVE) {
      // DOC-2: only one Effective version per document.
      const previousEffective = await this.versionModel.findOne({
        tenantId,
        documentId: version.documentId,
        state: DocumentVersionState.EFFECTIVE,
      });
      if (previousEffective) {
        previousEffective.state = DocumentVersionState.SUPERSEDED;
        await previousEffective.save();
        await this.auditService.record({
          tenantId,
          actor,
          entityType: DOCUMENT_ENTITY_TYPE,
          entityId: version.documentId.toString(),
          action: AuditAction.STATUS_CHANGE,
          before: { version: formatVersionLabel(previousEffective.majorVersion, previousEffective.minorVersion), state: DocumentVersionState.EFFECTIVE },
          after: { version: formatVersionLabel(previousEffective.majorVersion, previousEffective.minorVersion), state: DocumentVersionState.SUPERSEDED },
          reason: `Superseded by version ${formatVersionLabel(version.majorVersion, version.minorVersion)}.`,
        });
      }
      version.effectiveDate = new Date();
    }

    version.state = toState;
    await version.save();

    await this.auditService.record({
      tenantId,
      actor,
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: version.documentId.toString(),
      action: AuditAction.STATUS_CHANGE,
      before: { version: formatVersionLabel(version.majorVersion, version.minorVersion), state: fromState },
      after: { version: formatVersionLabel(version.majorVersion, version.minorVersion), state: toState },
      reason,
    });

    if (toState === DocumentVersionState.EFFECTIVE) {
      // TRN-3: a new Effective version retriggers retraining for every mapped user.
      const document = await this.documentModel.findOne({ _id: version.documentId, tenantId });
      if (document) {
        await this.emitTrainingTargetChanged(tenantId, document);
      }
    }

    return toVersionData(version);
  }

  // DOC-3: submit a draft version into its PLT-4 approval workflow. The workflow instance is
  // the approval authority; DocumentWorkflowListener syncs the version state from its events.
  async submitVersion(
    tenantId: string,
    actor: DocumentActor & { roleId: string },
    versionId: string,
  ): Promise<DocumentVersionData> {
    const version = await this.findVersionOrThrow(tenantId, versionId);
    if (version.state !== DocumentVersionState.DRAFT) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Only a draft version can be submitted (current state: ${version.state}).`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Validates an active DocumentVersion template exists and moves the instance to step 0
    // (emits the step-changed event that notifies the first reviewers — PLT-6).
    await this.workflowService.submit(tenantId, DOCUMENT_VERSION_ENTITY_TYPE, versionId, actor);
    return this.transitionVersion(tenantId, versionId, DocumentVersionState.UNDER_REVIEW, actor, null);
  }

  // DOC-7: e-signed obsolescence — the caller re-authenticated via PLT-3 (SignatureGuard);
  // the effective version becomes Obsolete (retained, auditable, excluded from default search).
  async obsoleteDocument(
    tenantId: string,
    signer: SigningContext,
    documentId: string,
    reason: string,
  ): Promise<DocumentData> {
    const document = await this.findDocumentOrThrow(tenantId, documentId);
    const effective = await this.versionModel.findOne({
      tenantId,
      documentId: document._id,
      state: DocumentVersionState.EFFECTIVE,
    });
    if (!effective) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Only a document with an Effective version can be obsoleted.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.QA_DISPOSITION,
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: document._id.toString(),
      entitySnapshot: {
        docNumber: document.docNumber,
        version: formatVersionLabel(effective.majorVersion, effective.minorVersion),
        action: 'obsolete',
      },
      reason,
    });

    await this.transitionVersion(
      tenantId,
      effective._id.toString(),
      DocumentVersionState.OBSOLETE,
      { userId: signer.userId, fullName: signer.fullName },
      reason,
    );

    return this.toDocumentData(tenantId, document);
  }

  // DOC-6 "reaffirm" outcome: content unchanged — a new e-signed minor version (cloned from the
  // effective one, sharing its immutable file) becomes Effective, and the review clock resets.
  // This is a creation, not a transition, so it does not pass through the draft pipeline —
  // deliberate: reaffirmation is exactly the "nothing changed" attestation.
  async reaffirmDocument(
    tenantId: string,
    signer: SigningContext,
    documentId: string,
    note: string,
  ): Promise<DocumentData> {
    const document = await this.findDocumentOrThrow(tenantId, documentId);
    const effective = await this.versionModel.findOne({
      tenantId,
      documentId: document._id,
      state: DocumentVersionState.EFFECTIVE,
    });
    if (!effective) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Only a document with an Effective version can be reaffirmed.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const inFlight = await this.versionModel.findOne({
      tenantId,
      documentId: document._id,
      state: { $in: IN_FLIGHT_STATES },
    });
    if (inFlight) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'A revision is already in progress — resolve it instead of reaffirming.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Minor bump on the latest version numbers keeps the unique version index safe even when
    // cancelled versions carry higher numbers than the effective one.
    const latest = await this.latestVersionOrThrow(tenantId, document._id.toString());
    const newMajor = latest.majorVersion;
    const newMinor = latest.minorVersion + 1;

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.REVIEWED_BY,
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: document._id.toString(),
      entitySnapshot: {
        docNumber: document.docNumber,
        reaffirmedVersion: formatVersionLabel(effective.majorVersion, effective.minorVersion),
        action: 'periodic-review-reaffirm',
      },
      reason: note,
    });

    const reaffirmed = await this.versionModel.create({
      tenantId,
      documentId: document._id,
      majorVersion: newMajor,
      minorVersion: newMinor,
      state: DocumentVersionState.EFFECTIVE,
      changeSummary: `Periodic review — reaffirmed with no content change. ${note}`,
      // The file is immutable and unchanged — the new version row shares the same object key.
      fileKey: effective.fileKey,
      fileName: effective.fileName,
      fileContentType: effective.fileContentType,
      fileSize: effective.fileSize,
      effectiveDate: new Date(),
      createdByUserId: signer.userId,
    });

    effective.state = DocumentVersionState.SUPERSEDED;
    await effective.save();

    document.lastReviewedAt = new Date();
    await document.save();

    await this.auditService.record({
      tenantId,
      actor: { userId: signer.userId, fullName: signer.fullName },
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: document._id.toString(),
      action: AuditAction.STATUS_CHANGE,
      before: { version: formatVersionLabel(effective.majorVersion, effective.minorVersion), state: DocumentVersionState.EFFECTIVE },
      after: { version: formatVersionLabel(reaffirmed.majorVersion, reaffirmed.minorVersion), state: DocumentVersionState.EFFECTIVE },
      reason: `Periodic review reaffirmed: ${note}`,
    });

    // TRN-3: reaffirmation also produces a new Effective version — same retraining trigger.
    await this.emitTrainingTargetChanged(tenantId, document);

    return this.toDocumentData(tenantId, document);
  }

  // DOC-6: documents whose periodic review is due within `withinDays` (or overdue) — feeds the
  // QA dashboard widget and the due-date scanner.
  async listReviewDue(tenantId: string, withinDays = 30, now: Date = new Date()): Promise<DocumentData[]> {
    const documents = await this.documentModel.find({ tenantId });
    const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);
    const results: DocumentData[] = [];
    for (const document of documents) {
      const data = await this.toDocumentData(tenantId, document).catch(() => null);
      if (!data || !data.nextReviewDate || data.status === DocumentStatus.OBSOLETE) {
        continue;
      }
      if (new Date(data.nextReviewDate) <= horizon) {
        results.push(data);
      }
    }
    return results.sort((a, b) => (a.nextReviewDate! < b.nextReviewDate! ? -1 : 1));
  }

  // Iron Rule 3: never-submitted drafts are cancelled, not deleted.
  async cancelDraft(
    tenantId: string,
    versionId: string,
    actor: DocumentActor,
    reason: string | null,
  ): Promise<DocumentVersionData> {
    return this.transitionVersion(tenantId, versionId, DocumentVersionState.CANCELLED, actor, reason);
  }

  async listDocuments(
    tenantId: string,
    query: ListDocumentsQuery,
  ): Promise<{ items: DocumentData[]; total: number }> {
    const filter: Record<string, unknown> = { tenantId };
    if (query.docType) {
      filter.docType = query.docType;
    }
    if (query.search) {
      filter.$or = [
        { title: { $regex: escapeRegex(query.search), $options: 'i' } },
        { docNumber: { $regex: escapeRegex(query.search), $options: 'i' } },
      ];
    }

    const docs = await this.documentModel.find(filter).sort({ docNumber: 1 });
    let items = await Promise.all(docs.map((doc) => this.toDocumentData(tenantId, doc)));
    // DOC-7: obsolete documents are excluded from user-facing lists/search unless asked for.
    if (!query.includeObsolete) {
      items = items.filter((item) => item.status !== DocumentStatus.OBSOLETE);
    }

    const total = items.length;
    const start = (query.page - 1) * query.limit;
    return { items: items.slice(start, start + query.limit), total };
  }

  async getDocument(tenantId: string, documentId: string): Promise<DocumentData> {
    const document = await this.findDocumentOrThrow(tenantId, documentId);
    return this.toDocumentData(tenantId, document);
  }

  async listVersions(tenantId: string, documentId: string): Promise<DocumentVersionData[]> {
    await this.findDocumentOrThrow(tenantId, documentId);
    const versions = await this.versionModel
      .find({ tenantId, documentId })
      .sort({ majorVersion: -1, minorVersion: -1 });
    return versions.map(toVersionData);
  }

  async getVersionWorkflow(tenantId: string, versionId: string) {
    await this.findVersionOrThrow(tenantId, versionId);
    return this.workflowService.findInstanceForEntity(tenantId, DOCUMENT_VERSION_ENTITY_TYPE, versionId);
  }

  async getVersionFile(tenantId: string, versionId: string): Promise<StoredFile & { fileName: string }> {
    const version = await this.findVersionOrThrow(tenantId, versionId);
    const stored = await this.fileStorage.get(version.fileKey);
    return { ...stored, fileName: version.fileName };
  }

  async findVersionOrThrow(tenantId: string, versionId: string): Promise<DocumentVersionDocument> {
    const version = await this.versionModel.findOne({ _id: versionId, tenantId });
    if (!version) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Document version not found.', HttpStatus.NOT_FOUND);
    }
    return version;
  }

  async findDocumentOrThrow(tenantId: string, documentId: string): Promise<DocumentEntityDocument> {
    const document = await this.documentModel.findOne({ _id: documentId, tenantId });
    if (!document) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Document not found.', HttpStatus.NOT_FOUND);
    }
    return document;
  }

  async toDocumentData(tenantId: string, document: DocumentEntityDocument): Promise<DocumentData> {
    const versions = await this.versionModel
      .find({ tenantId, documentId: document._id })
      .sort({ majorVersion: -1, minorVersion: -1 });
    if (versions.length === 0) {
      throw new AppException(ErrorCode.INTERNAL_ERROR, 'Document has no versions.', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    const effective = versions.find((v) => v.state === DocumentVersionState.EFFECTIVE) ?? null;
    const latest = versions[0];
    const status = deriveDocumentStatus(versions);

    // DOC-6: next review due = (last reaffirmation or effective date) + review frequency.
    let nextReviewDate: Date | null = null;
    const reviewAnchor = document.lastReviewedAt ?? effective?.effectiveDate ?? null;
    if (reviewAnchor && effective) {
      nextReviewDate = new Date(reviewAnchor);
      nextReviewDate.setUTCMonth(nextReviewDate.getUTCMonth() + document.reviewFrequencyMonths);
    }

    return {
      id: document._id.toString(),
      tenantId: document.tenantId.toString(),
      docNumber: document.docNumber,
      title: document.title,
      docType: document.docType,
      departmentId: document.departmentId.toString(),
      reviewFrequencyMonths: document.reviewFrequencyMonths,
      authorId: document.authorId,
      distributionRoleIds: document.distributionRoleIds,
      distributionDepartmentIds: document.distributionDepartmentIds,
      status,
      effectiveVersion: effective ? toVersionData(effective) : null,
      latestVersion: toVersionData(latest),
      nextReviewDate: nextReviewDate ? nextReviewDate.toISOString() : null,
      createdAt: (document as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }

  private async createVersionDocument(
    tenantId: string,
    actor: DocumentActor,
    document: DocumentEntityDocument,
    majorVersion: number,
    minorVersion: number,
    changeSummary: string | null,
    file: UploadedDocumentFile,
  ): Promise<DocumentVersionDocument> {
    const version = new this.versionModel({
      tenantId,
      documentId: document._id,
      majorVersion,
      minorVersion,
      state: DocumentVersionState.DRAFT,
      changeSummary,
      fileKey: '',
      fileName: file.originalname,
      fileContentType: file.mimetype,
      fileSize: file.size,
      createdByUserId: actor.userId,
    });
    // Key includes the version id so it is unique and immutable per version (CLAUDE.md).
    version.fileKey = `documents/${tenantId}/${version._id.toString()}/${file.originalname}`;
    await this.fileStorage.put(version.fileKey, file.buffer, file.mimetype);
    await version.save();
    return version;
  }

  private latestVersionOrThrow(tenantId: string, documentId: string): Promise<DocumentVersionDocument> {
    return this.versionModel
      .findOne({ tenantId, documentId })
      .sort({ majorVersion: -1, minorVersion: -1 })
      .orFail(
        () => new AppException(ErrorCode.INTERNAL_ERROR, 'Document has no versions.', HttpStatus.INTERNAL_SERVER_ERROR),
      );
  }

  // DOC-9/TRN-3: the one place that builds and emits the training-target snapshot, called
  // whenever the distribution list changes OR a version becomes Effective.
  private async emitTrainingTargetChanged(tenantId: string, document: DocumentEntityDocument): Promise<void> {
    const effective = await this.versionModel.findOne({
      tenantId,
      documentId: document._id,
      state: DocumentVersionState.EFFECTIVE,
    });
    const event: DocumentTrainingTargetChangedEvent = {
      tenantId,
      documentId: document._id.toString(),
      docNumber: document.docNumber,
      title: document.title,
      effectiveVersionId: effective ? effective._id.toString() : null,
      effectiveVersionLabel: effective ? formatVersionLabel(effective.majorVersion, effective.minorVersion) : null,
      distributionRoleIds: document.distributionRoleIds,
      distributionDepartmentIds: document.distributionDepartmentIds,
    };
    this.eventEmitter.emit(DOCUMENT_TRAINING_TARGET_CHANGED_EVENT, event);
  }

  private assertValidFile(file: UploadedDocumentFile | undefined): asserts file is UploadedDocumentFile {
    if (!file) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'A document file (PDF/DOCX) is required.', HttpStatus.BAD_REQUEST);
    }
    if (!ALLOWED_CONTENT_TYPES.has(file.mimetype)) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'Only PDF and DOCX files are accepted.', HttpStatus.BAD_REQUEST);
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new AppException(ErrorCode.VALIDATION_ERROR, 'File exceeds the 20 MB limit.', HttpStatus.BAD_REQUEST);
    }
  }
}

// SPEC §7.1 lifecycle at document level, derived from the version states.
function deriveDocumentStatus(versions: DocumentVersionDocument[]): DocumentStatus {
  const effective = versions.find((v) => v.state === DocumentVersionState.EFFECTIVE);
  const inFlight = versions.find((v) => IN_FLIGHT_STATES.includes(v.state));

  if (effective && inFlight) return DocumentStatus.UNDER_REVISION;
  if (effective) return DocumentStatus.EFFECTIVE;
  if (inFlight) {
    if (inFlight.state === DocumentVersionState.UNDER_REVIEW) return DocumentStatus.UNDER_REVIEW;
    if (inFlight.state === DocumentVersionState.UNDER_APPROVAL) return DocumentStatus.UNDER_APPROVAL;
    return DocumentStatus.DRAFT;
  }
  // No effective, nothing in flight: obsolete if any version was obsoleted, else draft-ish
  // (everything cancelled/superseded — treat a fully-superseded-with-no-effective doc as
  // obsolete for list purposes; it can no longer serve any controlled purpose).
  if (versions.some((v) => v.state === DocumentVersionState.OBSOLETE)) return DocumentStatus.OBSOLETE;
  return DocumentStatus.DRAFT;
}

function toVersionData(version: DocumentVersionDocument): DocumentVersionData {
  return {
    id: version._id.toString(),
    tenantId: version.tenantId.toString(),
    documentId: version.documentId.toString(),
    majorVersion: version.majorVersion,
    minorVersion: version.minorVersion,
    versionLabel: formatVersionLabel(version.majorVersion, version.minorVersion),
    state: version.state,
    changeSummary: version.changeSummary,
    fileName: version.fileName,
    fileContentType: version.fileContentType,
    fileSize: version.fileSize,
    effectiveDate: version.effectiveDate ? version.effectiveDate.toISOString() : null,
    createdByUserId: version.createdByUserId,
    createdAt: (version as unknown as { createdAt: Date }).createdAt.toISOString(),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

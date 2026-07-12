import { EventEmitter2 } from '@nestjs/event-emitter';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AuditAction,
  DocumentStatus,
  DocumentType,
  DocumentVersionState,
} from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { FILE_STORAGE, type FileStorage, type StoredFile } from '../../../common/storage/file-storage.interface';
import { AuditService } from '../../../platform/audit/audit.service';
import { EsignService } from '../../../platform/esign/esign.service';
import { WorkflowService } from '../../../platform/workflow/workflow.service';
import { AuditEvent, AuditEventDocument, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { Department, DepartmentDocument, DepartmentSchema } from '../../../platform/tenant/schemas/department.schema';
import { DocumentsService, type UploadedDocumentFile } from '../documents.service';
import { DocumentEntity, DocumentEntitySchema } from '../schemas/document.schema';
import { DocumentVersion, DocumentVersionDocument, DocumentVersionSchema } from '../schemas/document-version.schema';

// In-memory FileStorage — enforces the same write-once immutability as the disk implementation.
class MemoryFileStorage implements FileStorage {
  readonly files = new Map<string, StoredFile>();
  async put(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (this.files.has(key)) throw new Error(`Key already exists (immutable): ${key}`);
    this.files.set(key, { buffer, contentType });
  }
  async get(key: string): Promise<StoredFile> {
    const file = this.files.get(key);
    if (!file) throw new Error(`Not found: ${key}`);
    return file;
  }
}

describe('DOC-1 DOC-2 DOC-8 DocumentsService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let documentsService: DocumentsService;
  let numberingService: NumberingService;
  let departmentModel: Model<DepartmentDocument>;
  let versionModel: Model<DocumentVersionDocument>;
  let auditEventModel: Model<AuditEventDocument>;
  let storage: MemoryFileStorage;

  const actor = { userId: new mongoose.Types.ObjectId().toString(), fullName: 'Quinn Author' };

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    storage = new MemoryFileStorage();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: DocumentEntity.name, schema: DocumentEntitySchema },
          { name: DocumentVersion.name, schema: DocumentVersionSchema },
          { name: Department.name, schema: DepartmentSchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
        ]),
      ],
      providers: [
        DocumentsService,
        NumberingService,
        AuditService,
        { provide: FILE_STORAGE, useValue: storage },
        // DOC-3/DOC-7/DOC-9 collaborators — not exercised by this core-lifecycle spec.
        { provide: WorkflowService, useValue: {} },
        { provide: EsignService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    documentsService = moduleRef.get(DocumentsService);
    numberingService = moduleRef.get(NumberingService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
    versionModel = moduleRef.get(getModelToken(DocumentVersion.name));
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  function pdfFile(name = 'sop.pdf'): UploadedDocumentFile {
    return { originalname: name, mimetype: 'application/pdf', size: 1234, buffer: Buffer.from('%PDF-1.7 test') };
  }

  async function seedTenant(): Promise<{ tenantId: string; departmentId: string }> {
    const tenantId = id();
    const department = await departmentModel.create({ tenantId, name: 'Quality Assurance', code: 'QA' });
    await numberingService.createScheme({
      tenantId,
      entityType: 'SOP',
      prefix: 'SOP',
      useDepartmentToken: true,
      paddingWidth: 3,
      yearlyReset: false,
    });
    return { tenantId, departmentId: department._id.toString() };
  }

  async function createSop(tenantId: string, departmentId: string, title = 'Cleaning of pH meters') {
    return documentsService.createDocument(
      tenantId,
      actor,
      { title, docType: DocumentType.SOP, departmentId, reviewFrequencyMonths: 12 },
      pdfFile(),
    );
  }

  // Walks a version through the full lifecycle to Effective via the transition map.
  async function makeEffective(tenantId: string, versionId: string) {
    await documentsService.transitionVersion(tenantId, versionId, DocumentVersionState.UNDER_REVIEW, actor, null);
    await documentsService.transitionVersion(tenantId, versionId, DocumentVersionState.UNDER_APPROVAL, actor, null);
    return documentsService.transitionVersion(tenantId, versionId, DocumentVersionState.EFFECTIVE, actor, null);
  }

  it('DOC-1: creates a document with metadata, a numbered identity (SOP-QA-001), and an immutable 1.0 draft file', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);

    expect(document.docNumber).toBe('SOP-QA-001');
    expect(document.status).toBe(DocumentStatus.DRAFT);
    expect(document.latestVersion.versionLabel).toBe('1.0');
    expect(document.latestVersion.state).toBe(DocumentVersionState.DRAFT);
    expect(document.latestVersion.changeSummary).toBeNull();

    const stored = await documentsService.getVersionFile(tenantId, document.latestVersion.id);
    expect(stored.buffer.toString()).toContain('%PDF');
    expect(stored.fileName).toBe('sop.pdf');
  });

  it('DOC-1: rejects non-PDF/DOCX uploads', async () => {
    const { tenantId, departmentId } = await seedTenant();
    await expect(
      documentsService.createDocument(
        tenantId,
        actor,
        { title: 'Bad file', docType: DocumentType.SOP, departmentId, reviewFrequencyMonths: 12 },
        { originalname: 'virus.exe', mimetype: 'application/octet-stream', size: 10, buffer: Buffer.from('x') },
      ),
    ).rejects.toThrow('Only PDF and DOCX files are accepted.');
  });

  it('DOC-8: a new version without a change summary is rejected', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);
    await makeEffective(tenantId, document.latestVersion.id);

    await expect(
      documentsService.createVersion(tenantId, actor, document.id, { bump: 'major', changeSummary: '  ' }, pdfFile()),
    ).rejects.toThrow(/change summary/i);
  });

  it('DOC-2: only one Effective version — making a new version Effective auto-Supersedes the prior one (audited)', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);
    const v1 = document.latestVersion;
    await makeEffective(tenantId, v1.id);

    const v2 = await documentsService.createVersion(
      tenantId,
      actor,
      document.id,
      { bump: 'major', changeSummary: 'Updated tolerance table per new pharmacopoeia.' },
      pdfFile('sop-v2.pdf'),
    );
    expect(v2.versionLabel).toBe('2.0');
    await makeEffective(tenantId, v2.id);

    const versions = await documentsService.listVersions(tenantId, document.id);
    const byLabel = new Map(versions.map((v) => [v.versionLabel, v.state]));
    expect(byLabel.get('1.0')).toBe(DocumentVersionState.SUPERSEDED);
    expect(byLabel.get('2.0')).toBe(DocumentVersionState.EFFECTIVE);
    expect(versions.filter((v) => v.state === DocumentVersionState.EFFECTIVE)).toHaveLength(1);

    // The auto-supersede was audited as its own status change.
    const supersedeEvents = await auditEventModel.find({
      tenantId,
      entityType: 'Document',
      entityId: document.id,
      action: AuditAction.STATUS_CHANGE,
      reason: /Superseded by version 2\.0/,
    });
    expect(supersedeEvents).toHaveLength(1);
  });

  it('DOC-2: minor bump versions increment correctly (2.0 → 2.1)', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);
    await makeEffective(tenantId, document.latestVersion.id);

    const v11 = await documentsService.createVersion(
      tenantId,
      actor,
      document.id,
      { bump: 'minor', changeSummary: 'Typo fixes only.' },
      pdfFile(),
    );
    expect(v11.versionLabel).toBe('1.1');
  });

  it('DOC-2: a new version cannot be drafted while another is still in flight', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);
    // 1.0 is still DRAFT (in flight).
    await expect(
      documentsService.createVersion(tenantId, actor, document.id, { bump: 'major', changeSummary: 'x' }, pdfFile()),
    ).rejects.toThrow(/still draft/);
  });

  it('DOC-2: invalid transitions throw and change nothing — prior versions are read-only', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);
    const v1 = document.latestVersion;

    // Draft cannot jump straight to Effective.
    await expect(
      documentsService.transitionVersion(tenantId, v1.id, DocumentVersionState.EFFECTIVE, actor, null),
    ).rejects.toThrow(AppException);

    await makeEffective(tenantId, v1.id);
    const v2 = await documentsService.createVersion(
      tenantId,
      actor,
      document.id,
      { bump: 'major', changeSummary: 'Rewrite.' },
      pdfFile(),
    );
    await makeEffective(tenantId, v2.id);

    // 1.0 is now SUPERSEDED — terminal, read-only.
    await expect(
      documentsService.transitionVersion(tenantId, v1.id, DocumentVersionState.EFFECTIVE, actor, null),
    ).rejects.toThrow(/Invalid document version transition/);
    await expect(documentsService.cancelDraft(tenantId, v1.id, actor, null)).rejects.toThrow(
      /Invalid document version transition/,
    );

    const reloaded = await versionModel.findById(v1.id);
    expect(reloaded!.state).toBe(DocumentVersionState.SUPERSEDED);
  });

  it('DOC-2: document status derives correctly — Effective + new draft = Under Revision', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);
    await makeEffective(tenantId, document.latestVersion.id);

    expect((await documentsService.getDocument(tenantId, document.id)).status).toBe(DocumentStatus.EFFECTIVE);

    await documentsService.createVersion(
      tenantId,
      actor,
      document.id,
      { bump: 'major', changeSummary: 'Начало revision.' },
      pdfFile(),
    );
    expect((await documentsService.getDocument(tenantId, document.id)).status).toBe(DocumentStatus.UNDER_REVISION);
  });

  it('Iron Rule 5: documents are invisible across tenants', async () => {
    const { tenantId, departmentId } = await seedTenant();
    const document = await createSop(tenantId, departmentId);
    const otherTenant = id();

    await expect(documentsService.getDocument(otherTenant, document.id)).rejects.toThrow('Document not found.');
    await expect(documentsService.getVersionFile(otherTenant, document.latestVersion.id)).rejects.toThrow(
      'Document version not found.',
    );
  });
});

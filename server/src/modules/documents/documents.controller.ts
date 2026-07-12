import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuditAction,
  PermissionAction,
  PermissionModule,
  createDocumentRequestSchema,
  createDocumentVersionRequestSchema,
  listDocumentsQuerySchema,
  obsoleteDocumentRequestSchema,
  reaffirmDocumentRequestSchema,
  updateDocumentDistributionRequestSchema,
  updateDocumentRequestSchema,
  type AuthenticatedUser,
  type CreateDocumentRequest,
  type CreateDocumentVersionRequest,
  type ListDocumentsQuery,
  type ObsoleteDocumentRequest,
  type ReaffirmDocumentRequest,
  type UpdateDocumentDistributionRequest,
  type UpdateDocumentRequest,
} from '@pharmaqms/shared';
import type { Response } from 'express';
import { Audited } from '../../common/decorators/audited.decorator';
import {
  CurrentSigningContext,
  type SigningContext,
} from '../../common/decorators/current-signing-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ControlledCopyService } from './controlled-copy.service';
import { DOCUMENT_ENTITY_TYPE, DocumentsService } from './documents.service';

// DOC-1/DOC-2/DOC-8: document + version CRUD. Lifecycle transitions beyond draft-cancel happen
// through the PLT-4 workflow integration (Session DOC-3), never through a direct status write.
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly controlledCopyService: ControlledCopyService,
  ) {}

  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.CREATE)
  @Audited({ entityType: DOCUMENT_ENTITY_TYPE, action: AuditAction.CREATE })
  @UseInterceptors(FileInterceptor('file'))
  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDocumentRequestSchema)) dto: CreateDocumentRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const document = await this.documentsService.createDocument(
      tenantId,
      { userId: user.userId, fullName: user.fullName },
      dto,
      file,
    );
    return {
      data: document,
      audit: {
        entityId: document.id,
        before: null,
        after: {
          docNumber: document.docNumber,
          title: document.title,
          docType: document.docType,
          reviewFrequencyMonths: document.reviewFrequencyMonths,
        },
      },
    };
  }

  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.EDIT)
  @Audited({ entityType: DOCUMENT_ENTITY_TYPE, action: AuditAction.UPDATE })
  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDocumentRequestSchema)) dto: UpdateDocumentRequest,
  ) {
    const { before, after } = await this.documentsService.updateDocument(tenantId, id, dto);
    return {
      data: after,
      audit: {
        entityId: after.id,
        before,
        after: { title: after.title, reviewFrequencyMonths: after.reviewFrequencyMonths },
      },
    };
  }

  // DOC-2/DOC-8: new version (the audit event is written inside the service so the change
  // summary lands as the audit reason).
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.EDIT)
  @UseInterceptors(FileInterceptor('file'))
  @Post(':id/versions')
  async createVersion(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createDocumentVersionRequestSchema)) dto: CreateDocumentVersionRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const version = await this.documentsService.createVersion(
      tenantId,
      { userId: user.userId, fullName: user.fullName },
      id,
      dto,
      file,
    );
    return { data: version };
  }

  // Iron Rule 3: never-submitted drafts are cancelled, never hard-deleted (audited in-service).
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.EDIT)
  @Post(':id/versions/:versionId/cancel')
  async cancelDraft(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Body() body: { reason?: string },
  ) {
    const version = await this.documentsService.cancelDraft(
      tenantId,
      versionId,
      { userId: user.userId, fullName: user.fullName },
      body?.reason ?? null,
    );
    return { data: version };
  }

  // DOC-9: who must be trained on this document (TRN-1's mapping source).
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.EDIT)
  @Audited({ entityType: DOCUMENT_ENTITY_TYPE, action: AuditAction.DISTRIBUTION_UPDATED })
  @Patch(':id/distribution')
  async updateDistribution(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDocumentDistributionRequestSchema)) dto: UpdateDocumentDistributionRequest,
  ) {
    const { before, after } = await this.documentsService.updateDistribution(tenantId, id, dto);
    return {
      data: after,
      audit: {
        entityId: after.id,
        before,
        after: { distributionRoleIds: after.distributionRoleIds, distributionDepartmentIds: after.distributionDepartmentIds },
      },
    };
  }

  // DOC-3: submit a draft version into its approval workflow (PLT-4). Audited via the version's
  // status-change event written inside the service.
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.EDIT)
  @Post(':id/versions/:versionId/submit')
  async submitVersion(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
  ) {
    const data = await this.documentsService.submitVersion(
      tenantId,
      { userId: user.userId, fullName: user.fullName, roleId: user.roleId },
      versionId,
    );
    return { data };
  }

  // DOC-7: e-signed obsolescence — SignatureGuard verifies + consumes the PLT-3 signing token
  // (a live session alone is never sufficient, Iron Rule 4).
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.APPROVE)
  @UseGuards(SignatureGuard)
  @Post(':id/obsolete')
  async obsolete(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(obsoleteDocumentRequestSchema)) dto: ObsoleteDocumentRequest,
  ) {
    const data = await this.documentsService.obsoleteDocument(tenantId, signer, id, dto.reason);
    return { data };
  }

  // DOC-6: periodic-review outcome "reaffirm" — e-signed, resets the review clock via an
  // e-signed minor version. The "revise" outcome is simply POST :id/versions (a new draft).
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.APPROVE)
  @UseGuards(SignatureGuard)
  @Post(':id/review/reaffirm')
  async reaffirm(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reaffirmDocumentRequestSchema)) dto: ReaffirmDocumentRequest,
  ) {
    const data = await this.documentsService.reaffirmDocument(tenantId, signer, id, dto.note);
    return { data };
  }

  // DOC-6: QA dashboard widget — declared before ':id' so the literal route wins.
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.VIEW)
  @Get('review-due')
  async reviewDue(@CurrentTenant() tenantId: string) {
    const data = await this.documentsService.listReviewDue(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.VIEW)
  @Get()
  async list(
    @CurrentTenant() tenantId: string,
    @Query(new ZodValidationPipe(listDocumentsQuerySchema)) query: ListDocumentsQuery,
  ) {
    const { items, total } = await this.documentsService.listDocuments(tenantId, query);
    return { data: items, meta: { page: query.page, limit: query.limit, total } };
  }

  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.VIEW)
  @Get(':id')
  async get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.documentsService.getDocument(tenantId, id);
    return { data };
  }

  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.VIEW)
  @Get(':id/versions')
  async listVersions(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.documentsService.listVersions(tenantId, id);
    return { data };
  }

  // DOC-3: the version's approval instance (null before first submission) — feeds the detail
  // page's WorkflowStepper and its "open approval task" link.
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.VIEW)
  @Get(':id/versions/:versionId/workflow')
  async versionWorkflow(@CurrentTenant() tenantId: string, @Param('versionId') versionId: string) {
    const data = await this.documentsService.getVersionWorkflow(tenantId, versionId);
    return { data };
  }

  // DOC-4: controlled-copy print — header block, watermark footer, and the DOC-5 version-check
  // QR stamped on every page. The print itself is audited in-service (who/which version/when).
  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.VIEW)
  @Get(':id/versions/:versionId/controlled-copy.pdf')
  async controlledCopy(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('versionId') versionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { pdf, fileName } = await this.controlledCopyService.generateControlledCopy(
      tenantId,
      { userId: user.userId, fullName: user.fullName },
      versionId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdf);
  }

  @RequirePermission(PermissionModule.DOCUMENTS, PermissionAction.VIEW)
  @Get(':id/versions/:versionId/file')
  async getFile(
    @CurrentTenant() tenantId: string,
    @Param('versionId') versionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.documentsService.getVersionFile(tenantId, versionId);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName.replace(/"/g, '')}"`);
    res.send(file.buffer);
  }
}

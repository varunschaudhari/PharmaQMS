import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
  AuditAction,
  PermissionAction,
  PermissionModule,
  createTestRecordRequestSchema,
  updateTestRecordRequestSchema,
  type AuthenticatedUser,
  type CreateTestRecordRequest,
  type UpdateTestRecordRequest,
} from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { TEST_RECORD_ENTITY_TYPE, TestRecordService } from './test-record.service';

// Phase 0 gate demo controller. Reads need only an authenticated tenant session (reviewers and
// approvers must open the record); writes are admin-gated. Submission/approval go through the
// generic PLT-4 endpoints — this controller owns only the entity itself.
@Controller('test-records')
export class TestRecordController {
  constructor(private readonly testRecordService: TestRecordService) {}

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.CREATE)
  @Audited({ entityType: TEST_RECORD_ENTITY_TYPE, action: AuditAction.CREATE })
  @Post()
  async create(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTestRecordRequestSchema)) dto: CreateTestRecordRequest,
  ) {
    const record = await this.testRecordService.create(tenantId, user.userId, dto);
    return {
      data: record,
      audit: {
        entityId: record.id,
        before: null,
        after: { recordNumber: record.recordNumber, title: record.title, description: record.description },
      },
    };
  }

  @RequirePermission(PermissionModule.ADMIN, PermissionAction.EDIT)
  @Audited({ entityType: TEST_RECORD_ENTITY_TYPE, action: AuditAction.UPDATE })
  @Patch(':id')
  async update(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTestRecordRequestSchema)) dto: UpdateTestRecordRequest,
  ) {
    const { before, after } = await this.testRecordService.update(tenantId, id, dto);
    return {
      data: after,
      audit: { entityId: after.id, before, after: { title: after.title, description: after.description } },
    };
  }

  @Get()
  async list(@CurrentTenant() tenantId: string) {
    const data = await this.testRecordService.list(tenantId);
    return { data };
  }

  @Get(':id')
  async get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.testRecordService.get(tenantId, id);
    return { data };
  }
}

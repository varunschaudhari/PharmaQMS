import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuditAction, PermissionAction, PermissionModule, type AuthenticatedUser } from '@pharmaqms/shared';
import { Audited } from '../../common/decorators/audited.decorator';
import { CurrentSigningContext, type SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { SignatureGuard } from '../../common/guards/signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createMaterialLotRequestSchema,
  listMaterialLotsQuerySchema,
  transitionMaterialLotStatusRequestSchema,
  type CreateMaterialLotRequest,
  type ListMaterialLotsQuery,
  type TransitionMaterialLotStatusRequest,
} from './dto/material-lot.dto';
import { MATERIAL_LOT_ENTITY_TYPE } from './material-lot-entity-types';
import { MaterialLotService } from './material-lot.service';

// QRX-2: material lot master + QR + status verification scan view (SPEC.md §7.4, Non-Goals §3 —
// status verification only). The scan view needs only authentication (any operator scanning a
// label must see the live status — the scan itself, via /s/:code, is the access gate), matching
// EQP-3/QRX-1's precedent exactly. Status changes are the one QA-only, e-signed action.
@Controller('materials')
export class MaterialLotController {
  constructor(private readonly materialLotService: MaterialLotService) {}

  @RequirePermission(PermissionModule.MATERIALS, PermissionAction.CREATE)
  @Audited({ entityType: MATERIAL_LOT_ENTITY_TYPE, action: AuditAction.CREATE })
  @Post()
  async create(@CurrentTenant() tenantId: string, @Body(new ZodValidationPipe(createMaterialLotRequestSchema)) dto: CreateMaterialLotRequest) {
    const lot = await this.materialLotService.create(tenantId, dto);
    return {
      data: lot,
      audit: { entityId: lot.id, before: null, after: { lotCode: lot.lotCode, materialName: lot.materialName, status: lot.status } },
    };
  }

  @RequirePermission(PermissionModule.MATERIALS, PermissionAction.VIEW)
  @Get()
  async list(@CurrentTenant() tenantId: string, @Query(new ZodValidationPipe(listMaterialLotsQuerySchema)) query: ListMaterialLotsQuery) {
    const { items, total } = await this.materialLotService.list(tenantId, query);
    return { data: items, meta: { page: query.page, limit: query.limit, total } };
  }

  // QRX-2 (e): QA dashboard feed. Registered ahead of the `:id` route below — 'rejected' has a
  // single path segment too, but is a fixed literal Express/Nest matches before falling through to
  // the param route only because this handler is declared first (same convention as
  // CalibrationController's 'calibration/due').
  @RequirePermission(PermissionModule.MATERIALS, PermissionAction.VIEW)
  @Get('rejected')
  async listRejected(@CurrentTenant() tenantId: string) {
    const data = await this.materialLotService.listRejected(tenantId);
    return { data };
  }

  @RequirePermission(PermissionModule.MATERIALS, PermissionAction.VIEW)
  @Get(':id')
  async get(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const data = await this.materialLotService.get(tenantId, id);
    return { data };
  }

  // QRX-2: reached by the mobile scan flow — any authenticated tenant user.
  @Get(':id/scan-view')
  async scanView(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const data = await this.materialLotService.getScanView(tenantId, id, { permissions: user.permissions });
    return { data };
  }

  // QRX-2 (b) / Iron Rule 4: a status change IS an e-signature (meaning QA Disposition) — QA
  // permission-gated AND SignatureGuard-enforced, same double-gate as EQP-4/5's verify/disposition.
  @RequirePermission(PermissionModule.MATERIALS, PermissionAction.APPROVE)
  @UseGuards(SignatureGuard)
  @Post(':id/status')
  async dispositionStatus(
    @CurrentTenant() tenantId: string,
    @CurrentSigningContext() signer: SigningContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(transitionMaterialLotStatusRequestSchema)) dto: TransitionMaterialLotStatusRequest,
  ) {
    const data = await this.materialLotService.dispositionStatus(tenantId, id, signer, dto.status, dto.note);
    return { data };
  }
}

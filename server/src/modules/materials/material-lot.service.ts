import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  assertMaterialLotStatusTransition,
  AuditAction,
  ErrorCode,
  MaterialLotStatus,
  SignatureMeaning,
  type CreateMaterialLotRequest,
  type ListMaterialLotsQuery,
  type MaterialLotData,
  type MaterialLotDispositionData,
  type MaterialLotRejectedEntryData,
  type MaterialLotScanData,
} from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { SigningContext } from '../../common/decorators/current-signing-context.decorator';
import { AuditService } from '../../platform/audit/audit.service';
import { EsignService } from '../../platform/esign/esign.service';
import { NumberingService } from '../../platform/numbering/numbering.service';
import { QrService } from '../../platform/qr/qr.service';
import { MATERIAL_LOT_ENTITY_TYPE, MATERIAL_LOT_NUMBERING_TYPE } from './material-lot-entity-types';
import { MaterialLot, MaterialLotDocument } from './schemas/material-lot.schema';

export interface MaterialLotActor {
  userId: string;
  fullName: string;
}

const MATERIALS_APPROVE_PERMISSION = 'materials:approve';

// QRX-2 (SPEC.md §7.4): material lot status verification — no quantities, no stock movement, no
// consumption, no warehouse logic (Non-Goals §3). Every status change is a QA-permission-gated,
// e-signed disposition (meaning "QA Disposition") — there is no plain, unsigned transition path.
@Injectable()
export class MaterialLotService {
  constructor(
    @InjectModel(MaterialLot.name) private readonly lotModel: Model<MaterialLotDocument>,
    private readonly numberingService: NumberingService,
    private readonly qrService: QrService,
    private readonly esignService: EsignService,
    private readonly auditService: AuditService,
  ) {}

  // QRX-2: create the master record and mint its QR identity in the same call — every lot is
  // scannable from the moment it exists (same EQP-1/EQP-2 / QRX-1 precedent). The QR label
  // deliberately encodes ONLY lotCode/materialName (via QrService's entityCode/entityName) — NEVER
  // status — so a printed label can never go stale; status must always come from a live scan.
  // This is the integrity point SPEC.md §7.4 QRX-2 calls out explicitly.
  async create(tenantId: string, dto: CreateMaterialLotRequest): Promise<MaterialLotData> {
    const lotCode = await this.numberingService.generateNumber(tenantId, MATERIAL_LOT_NUMBERING_TYPE);

    const lot = await this.lotModel.create({
      tenantId,
      lotCode,
      materialName: dto.materialName,
      manufacturer: dto.manufacturer ?? null,
      receivedDate: new Date(dto.receivedDate),
      status: MaterialLotStatus.QUARANTINE,
    });

    await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: MATERIAL_LOT_ENTITY_TYPE,
      entityId: lot._id.toString(),
      entityCode: lotCode,
      entityName: dto.materialName,
    });

    return this.toData(tenantId, lot);
  }

  async list(tenantId: string, options: ListMaterialLotsQuery): Promise<{ items: MaterialLotData[]; total: number }> {
    const filter: Record<string, unknown> = { tenantId };
    if (options.status) filter.status = options.status;
    if (options.search) {
      filter.$or = [
        { materialName: { $regex: escapeRegex(options.search), $options: 'i' } },
        { lotCode: { $regex: escapeRegex(options.search), $options: 'i' } },
      ];
    }

    const [docs, total] = await Promise.all([
      this.lotModel
        .find(filter)
        .sort({ lotCode: 1 })
        .skip((options.page - 1) * options.limit)
        .limit(options.limit),
      this.lotModel.countDocuments(filter),
    ]);
    return { items: await Promise.all(docs.map((doc) => this.toData(tenantId, doc))), total };
  }

  async get(tenantId: string, lotId: string): Promise<MaterialLotData> {
    const lot = await this.findOrThrow(tenantId, lotId);
    return this.toData(tenantId, lot);
  }

  // QRX-2: the scan-to-status view — a large color-coded status banner is a client concern; this
  // supplies the status plus the latest QA disposition sign-off (sourced from PLT-3's signatures,
  // not duplicated onto the lot itself) and the actor-gated `change_status` action. Reached by any
  // authenticated user (the scan itself is the access gate, same EQP-3/QRX-1 precedent) — but the
  // action is only offered to an actor holding materials:approve AND when a transition still exists.
  async getScanView(tenantId: string, lotId: string, actor: { permissions: string[] }): Promise<MaterialLotScanData> {
    const lot = await this.findOrThrow(tenantId, lotId);
    const signatures = await this.esignService.findForEntity(tenantId, MATERIAL_LOT_ENTITY_TYPE, lotId);
    const lastDisposition: MaterialLotDispositionData | null = signatures[0]
      ? {
          userFullName: signatures[0].userFullName,
          meaning: signatures[0].meaning,
          reason: signatures[0].reason,
          signedAt: signatures[0].signedAt,
        }
      : null;

    const canChangeStatus =
      actor.permissions.includes(MATERIALS_APPROVE_PERMISSION) && hasAnyTransition(lot.status);

    return {
      id: lot._id.toString(),
      lotCode: lot.lotCode,
      materialName: lot.materialName,
      manufacturer: lot.manufacturer,
      receivedDate: lot.receivedDate.toISOString(),
      status: lot.status,
      lastDisposition,
      availableActions: canChangeStatus ? ['change_status'] : [],
    };
  }

  // QRX-2 (b): the ONLY way status changes — an explicit transition map (invalid throws, CLAUDE.md)
  // AND a fresh e-signature (meaning QA Disposition, Iron Rule 4 — a valid session is never
  // sufficient). `signer` comes from SignatureGuard's verified+consumed signing token, not just
  // @CurrentUser().
  async dispositionStatus(
    tenantId: string,
    lotId: string,
    signer: SigningContext,
    toStatus: MaterialLotStatus,
    note?: string,
  ): Promise<MaterialLotData> {
    const lot = await this.findOrThrow(tenantId, lotId);
    const fromStatus = lot.status;

    try {
      assertMaterialLotStatusTransition(fromStatus, toStatus);
    } catch (error) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid material lot status transition.',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.esignService.createSignature({
      tenantId,
      userId: signer.userId,
      userFullName: signer.fullName,
      meaning: SignatureMeaning.QA_DISPOSITION,
      entityType: MATERIAL_LOT_ENTITY_TYPE,
      entityId: lotId,
      entitySnapshot: { lotCode: lot.lotCode, fromStatus, toStatus, note: note ?? null },
      reason: note ?? null,
    });

    lot.status = toStatus;
    await lot.save();

    await this.auditService.record({
      tenantId,
      actor: { userId: signer.userId, fullName: signer.fullName },
      entityType: MATERIAL_LOT_ENTITY_TYPE,
      entityId: lotId,
      action: AuditAction.MATERIAL_LOT_DISPOSITIONED,
      before: { status: fromStatus },
      after: { status: toStatus },
      reason: note ?? null,
    });

    return this.toData(tenantId, lot);
  }

  // QRX-2 (e): rejected-lots dashboard feed for QA.
  async listRejected(tenantId: string): Promise<MaterialLotRejectedEntryData[]> {
    const lots = await this.lotModel.find({ tenantId, status: MaterialLotStatus.REJECTED }).sort({ lotCode: 1 });
    if (lots.length === 0) {
      return [];
    }

    const dispositions = await Promise.all(
      lots.map((lot) => this.esignService.findForEntity(tenantId, MATERIAL_LOT_ENTITY_TYPE, lot._id.toString())),
    );

    return lots.map((lot, index) => ({
      lotId: lot._id.toString(),
      lotCode: lot.lotCode,
      materialName: lot.materialName,
      rejectedAt: dispositions[index][0]?.signedAt ?? null,
    }));
  }

  async findOrThrow(tenantId: string, lotId: string): Promise<MaterialLotDocument> {
    const lot = await this.lotModel.findOne({ _id: lotId, tenantId });
    if (!lot) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Material lot not found.', HttpStatus.NOT_FOUND);
    }
    return lot;
  }

  private async toData(tenantId: string, lot: MaterialLotDocument): Promise<MaterialLotData> {
    const { data: qr } = await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: MATERIAL_LOT_ENTITY_TYPE,
      entityId: lot._id.toString(),
      entityCode: lot.lotCode,
      entityName: lot.materialName,
    });

    return {
      id: lot._id.toString(),
      tenantId: lot.tenantId.toString(),
      lotCode: lot.lotCode,
      materialName: lot.materialName,
      manufacturer: lot.manufacturer,
      receivedDate: lot.receivedDate.toISOString(),
      status: lot.status,
      qr: { code: qr.code, scanUrl: qr.scanUrl },
      createdAt: (lot as unknown as { createdAt: Date }).createdAt.toISOString(),
    };
  }
}

function hasAnyTransition(status: MaterialLotStatus): boolean {
  return status !== MaterialLotStatus.APPROVED && status !== MaterialLotStatus.REJECTED;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

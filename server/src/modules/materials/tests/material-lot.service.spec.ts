import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MaterialLotStatus, SignatureMeaning } from '@pharmaqms/shared';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { AuditService } from '../../../platform/audit/audit.service';
import { AuditEvent, AuditEventDocument, AuditEventSchema } from '../../../platform/audit/schemas/audit-event.schema';
import { esignConfig } from '../../../platform/esign/config/esign.config';
import { EsignService } from '../../../platform/esign/esign.service';
import { Signature, SignatureSchema } from '../../../platform/esign/schemas/signature.schema';
import { SigningTokenUsage, SigningTokenUsageSchema } from '../../../platform/esign/schemas/signing-token-usage.schema';
import { User, UserSchema } from '../../../platform/auth/schemas/user.schema';
import { Tenant, TenantSchema } from '../../../platform/tenant/schemas/tenant.schema';
import { NumberingService } from '../../../platform/numbering/numbering.service';
import { NumberingCounter, NumberingCounterSchema } from '../../../platform/numbering/schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeSchema } from '../../../platform/numbering/schemas/numbering-scheme.schema';
import { qrConfig } from '../../../platform/qr/config/qr.config';
import { QrService } from '../../../platform/qr/qr.service';
import { QrCode, QrCodeSchema } from '../../../platform/qr/schemas/qr-code.schema';
import { MATERIAL_LOT_NUMBERING_TYPE } from '../material-lot-entity-types';
import { MaterialLotService } from '../material-lot.service';
import { MaterialLot, MaterialLotSchema } from '../schemas/material-lot.schema';
import type { Model } from 'mongoose';

describe('QRX-2 MaterialLotService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let materialLotService: MaterialLotService;
  let numberingService: NumberingService;
  let auditEventModel: Model<AuditEventDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    process.env.APP_BASE_URL = 'https://qms.example.com';
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [qrConfig, esignConfig] }),
        JwtModule.register({}),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: MaterialLot.name, schema: MaterialLotSchema },
          { name: User.name, schema: UserSchema },
          { name: Tenant.name, schema: TenantSchema },
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
          { name: QrCode.name, schema: QrCodeSchema },
          { name: AuditEvent.name, schema: AuditEventSchema },
          { name: Signature.name, schema: SignatureSchema },
          { name: SigningTokenUsage.name, schema: SigningTokenUsageSchema },
        ]),
      ],
      providers: [MaterialLotService, NumberingService, QrService, PdfRenderService, AuditService, EsignService],
    }).compile();

    materialLotService = moduleRef.get(MaterialLotService);
    numberingService = moduleRef.get(NumberingService);
    auditEventModel = moduleRef.get(getModelToken(AuditEvent.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const qa = { userId: id(), fullName: 'Quinn Qahead' };

  async function seedTenant(): Promise<string> {
    const tenantId = id();
    await numberingService.createScheme({
      tenantId,
      entityType: MATERIAL_LOT_NUMBERING_TYPE,
      prefix: 'LOT',
      useDepartmentToken: false,
      paddingWidth: 3,
      yearlyReset: false,
    });
    return tenantId;
  }

  it('QRX-2: creates a lot with a numbered code, Quarantine by default, and a minted QR with no status on it', async () => {
    const tenantId = await seedTenant();
    const lot = await materialLotService.create(tenantId, { materialName: 'Lactose Monohydrate', manufacturer: 'DFE Pharma', receivedDate: '2026-07-01' });

    expect(lot.lotCode).toBe('LOT-001');
    expect(lot.status).toBe(MaterialLotStatus.QUARANTINE);
    expect(lot.qr).not.toBeNull();
    expect(lot.qr!.scanUrl).toBe(`https://qms.example.com/s/${lot.qr!.code}`);
  });

  it('QRX-2: a QA disposition follows the explicit map — Quarantine -> Under Test -> Approved, e-signed and audited', async () => {
    const tenantId = await seedTenant();
    const lot = await materialLotService.create(tenantId, { materialName: 'Microcrystalline Cellulose', receivedDate: '2026-07-01' });

    const underTest = await materialLotService.dispositionStatus(
      tenantId,
      lot.id,
      { userId: qa.userId, tenantId, fullName: qa.fullName },
      MaterialLotStatus.UNDER_TEST,
      'Sent to QC for testing.',
    );
    expect(underTest.status).toBe(MaterialLotStatus.UNDER_TEST);

    const approved = await materialLotService.dispositionStatus(
      tenantId,
      lot.id,
      { userId: qa.userId, tenantId, fullName: qa.fullName },
      MaterialLotStatus.APPROVED,
      'COA conforms — releasing.',
    );
    expect(approved.status).toBe(MaterialLotStatus.APPROVED);

    const signatures = await moduleRef.get(EsignService).findForEntity(tenantId, 'MaterialLot', lot.id);
    expect(signatures).toHaveLength(2);
    expect(signatures.every((s) => s.meaning === SignatureMeaning.QA_DISPOSITION)).toBe(true);

    const auditEvents = await auditEventModel.find({ tenantId, entityType: 'MaterialLot', action: 'material_lot_dispositioned' });
    expect(auditEvents).toHaveLength(2);
  });

  it('QRX-2: an invalid transition (Quarantine straight to Approved) is rejected', async () => {
    const tenantId = await seedTenant();
    const lot = await materialLotService.create(tenantId, { materialName: 'Magnesium Stearate', receivedDate: '2026-07-01' });

    await expect(
      materialLotService.dispositionStatus(tenantId, lot.id, { userId: qa.userId, tenantId, fullName: qa.fullName }, MaterialLotStatus.APPROVED),
    ).rejects.toThrow(AppException);
  });

  it('QRX-2: Approved and Rejected are terminal — no further disposition is possible', async () => {
    const tenantId = await seedTenant();
    const lot = await materialLotService.create(tenantId, { materialName: 'Talc', receivedDate: '2026-07-01' });
    await materialLotService.dispositionStatus(tenantId, lot.id, { userId: qa.userId, tenantId, fullName: qa.fullName }, MaterialLotStatus.REJECTED, 'Failed identification test.');

    await expect(
      materialLotService.dispositionStatus(tenantId, lot.id, { userId: qa.userId, tenantId, fullName: qa.fullName }, MaterialLotStatus.UNDER_TEST),
    ).rejects.toThrow(AppException);
  });

  it('QRX-2: the scan view offers change_status only to an actor holding materials:approve, and never once terminal', async () => {
    const tenantId = await seedTenant();
    const lot = await materialLotService.create(tenantId, { materialName: 'Povidone', receivedDate: '2026-07-01' });

    const operatorView = await materialLotService.getScanView(tenantId, lot.id, { permissions: [] });
    expect(operatorView.availableActions).toEqual([]);
    expect(operatorView.lastDisposition).toBeNull();

    const qaView = await materialLotService.getScanView(tenantId, lot.id, { permissions: ['materials:approve'] });
    expect(qaView.availableActions).toEqual(['change_status']);

    await materialLotService.dispositionStatus(tenantId, lot.id, { userId: qa.userId, tenantId, fullName: qa.fullName }, MaterialLotStatus.REJECTED, 'Contaminated on receipt.');
    const afterRejection = await materialLotService.getScanView(tenantId, lot.id, { permissions: ['materials:approve'] });
    expect(afterRejection.availableActions).toEqual([]);
    expect(afterRejection.lastDisposition).not.toBeNull();
    expect(afterRejection.lastDisposition!.userFullName).toBe(qa.fullName);
  });

  it('QRX-2: listRejected only returns Rejected-status lots', async () => {
    const tenantId = await seedTenant();
    const rejected = await materialLotService.create(tenantId, { materialName: 'Bad Batch', receivedDate: '2026-07-01' });
    await materialLotService.create(tenantId, { materialName: 'Good Batch', receivedDate: '2026-07-01' });
    await materialLotService.dispositionStatus(tenantId, rejected.id, { userId: qa.userId, tenantId, fullName: qa.fullName }, MaterialLotStatus.REJECTED, 'OOS result.');

    const feed = await materialLotService.listRejected(tenantId);
    expect(feed).toHaveLength(1);
    expect(feed[0].lotId).toBe(rejected.id);
    expect(feed[0].rejectedAt).not.toBeNull();
  });

  it('Iron Rule 5: material lots are invisible across tenants', async () => {
    const tenantId = await seedTenant();
    const lot = await materialLotService.create(tenantId, { materialName: 'Cross Tenant', receivedDate: '2026-07-01' });
    const otherTenant = id();

    await expect(materialLotService.get(otherTenant, lot.id)).rejects.toThrow('Material lot not found.');
    const list = await materialLotService.list(otherTenant, { page: 1, limit: 20 });
    expect(list.total).toBe(0);
  });
});

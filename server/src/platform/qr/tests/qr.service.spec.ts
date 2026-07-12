import { ConfigModule } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { PdfRenderService } from '../../../common/pdf/pdf-render.service';
import { qrConfig } from '../config/qr.config';
import { QrService } from '../qr.service';
import { QrCode, QrCodeDocument, QrCodeSchema } from '../schemas/qr-code.schema';

describe('PLT-7 QrService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let qrService: QrService;
  let qrCodeModel: Model<QrCodeDocument>;

  beforeAll(async () => {
    process.env.APP_BASE_URL = 'https://qms.example.com';
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [qrConfig] }),
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: QrCode.name, schema: QrCodeSchema }]),
      ],
      providers: [QrService, PdfRenderService],
    }).compile();

    qrService = moduleRef.get(QrService);
    qrCodeModel = moduleRef.get(getModelToken(QrCode.name));
    // The unique code index is the collision arbiter — make sure it exists before tests
    // exercise the retry path.
    await qrCodeModel.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await qrCodeModel.collection.deleteMany({});
    jest.restoreAllMocks();
  });

  function id(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  const equipmentDto = {
    entityType: 'Equipment',
    entityId: 'eqp-1',
    entityCode: 'EQP-0042',
    entityName: 'pH Meter — QC Lab',
  };

  it('PLT-7: mints an opaque short code and builds the /s/:code scan URL', async () => {
    const tenantId = id();
    const { data, created } = await qrService.getOrCreateForEntity(tenantId, equipmentDto);

    expect(created).toBe(true);
    // Opaque: unambiguous-alphabet, fixed length, and derived from nothing the entity exposes.
    expect(data.code).toMatch(/^[A-HJ-KM-NP-TV-Z2-9]{10}$/);
    expect(data.code).not.toContain('EQP');
    expect(data.scanUrl).toBe(`https://qms.example.com/s/${data.code}`);
  });

  it('PLT-7: get-or-create is idempotent — one code per entity, re-posting returns the same code', async () => {
    const tenantId = id();
    const first = await qrService.getOrCreateForEntity(tenantId, equipmentDto);
    const second = await qrService.getOrCreateForEntity(tenantId, equipmentDto);

    expect(second.created).toBe(false);
    expect(second.data.code).toBe(first.data.code);
    expect(await qrCodeModel.countDocuments({ tenantId })).toBe(1);
  });

  it('PLT-7: a code collision is survived by regenerating — the unique index is the arbiter', async () => {
    const tenantId = id();
    const existing = await qrService.getOrCreateForEntity(tenantId, equipmentDto);

    // Force the generator to first return the already-taken code, then a fresh one.
    const generateSpy = jest.spyOn(
      qrService as unknown as { generateCode: () => string },
      'generateCode',
    );
    generateSpy.mockReturnValueOnce(existing.data.code).mockReturnValue('FRESHCODE2');

    const collided = await qrService.getOrCreateForEntity(tenantId, {
      ...equipmentDto,
      entityId: 'eqp-2',
      entityCode: 'EQP-0043',
    });

    expect(collided.created).toBe(true);
    expect(collided.data.code).toBe('FRESHCODE2');
    expect(generateSpy).toHaveBeenCalledTimes(2);
  });

  it('PLT-7: resolve() maps the code back to its entity within the owning tenant', async () => {
    const tenantId = id();
    const { data } = await qrService.getOrCreateForEntity(tenantId, equipmentDto);

    const resolution = await qrService.resolve(tenantId, data.code);
    expect(resolution).toEqual({
      code: data.code,
      entityType: 'Equipment',
      entityId: 'eqp-1',
      entityCode: 'EQP-0042',
      entityName: 'pH Meter — QC Lab',
    });
  });

  it('PLT-7: a cross-tenant scan is blocked — a foreign code resolves as NOT_FOUND, indistinguishable from an unknown code', async () => {
    const tenantA = id();
    const tenantB = id();
    const { data } = await qrService.getOrCreateForEntity(tenantA, equipmentDto);

    await expect(qrService.resolve(tenantB, data.code)).rejects.toThrow(AppException);
    await expect(qrService.resolve(tenantB, data.code)).rejects.toThrow('QR code not found.');
    await expect(qrService.resolve(tenantB, 'NOSUCHCODE')).rejects.toThrow('QR code not found.');
  });

  it('PLT-7: generatePng() returns a PNG image for the tenant\'s own code', async () => {
    const tenantId = id();
    const { data } = await qrService.getOrCreateForEntity(tenantId, equipmentDto);

    const png = await qrService.generatePng(tenantId, data.code);
    // PNG magic bytes.
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });
});

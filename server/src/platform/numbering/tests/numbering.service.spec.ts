import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { NumberingService } from '../numbering.service';
import { NumberingCounter, NumberingCounterDocument, NumberingCounterSchema } from '../schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeDocument, NumberingSchemeSchema } from '../schemas/numbering-scheme.schema';

describe('PLT-5 NumberingService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let numberingService: NumberingService;
  let schemeModel: Model<NumberingSchemeDocument>;
  let counterModel: Model<NumberingCounterDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([
          { name: NumberingScheme.name, schema: NumberingSchemeSchema },
          { name: NumberingCounter.name, schema: NumberingCounterSchema },
        ]),
      ],
      providers: [NumberingService],
    }).compile();

    numberingService = moduleRef.get(NumberingService);
    schemeModel = moduleRef.get(getModelToken(NumberingScheme.name));
    counterModel = moduleRef.get(getModelToken(NumberingCounter.name));
    // A bare TestingModule.compile() doesn't run onModuleInit lifecycle hooks (unlike a full app
    // bootstrap), so explicitly wait for the counter's unique index here too — see
    // NumberingService.onModuleInit for why this matters for the concurrency test below.
    await counterModel.init();
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await schemeModel.collection.deleteMany({});
    await counterModel.collection.deleteMany({});
  });

  function tenantId(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  it('PLT-5: generates a simple padded sequence (EQP-0042 style)', async () => {
    const tenant = tenantId();
    await numberingService.createScheme({
      tenantId: tenant,
      entityType: 'EQP',
      prefix: 'EQP',
      useDepartmentToken: false,
      paddingWidth: 4,
      yearlyReset: false,
    });

    expect(await numberingService.generateNumber(tenant, 'EQP')).toBe('EQP-0001');
    expect(await numberingService.generateNumber(tenant, 'EQP')).toBe('EQP-0002');
  });

  it('PLT-5: generates a department-token sequence (SOP-QA-001 style), independent per department', async () => {
    const tenant = tenantId();
    await numberingService.createScheme({
      tenantId: tenant,
      entityType: 'SOP',
      prefix: 'SOP',
      useDepartmentToken: true,
      paddingWidth: 3,
      yearlyReset: false,
    });

    expect(await numberingService.generateNumber(tenant, 'SOP', 'qa')).toBe('SOP-QA-001');
    expect(await numberingService.generateNumber(tenant, 'SOP', 'qa')).toBe('SOP-QA-002');
    // A different department starts its own independent sequence at 001.
    expect(await numberingService.generateNumber(tenant, 'SOP', 'qc')).toBe('SOP-QC-001');
  });

  it('PLT-5: generates a yearly-reset sequence (TRN-2026-0113 style)', async () => {
    const tenant = tenantId();
    await numberingService.createScheme({
      tenantId: tenant,
      entityType: 'TRN',
      prefix: 'TRN',
      useDepartmentToken: false,
      paddingWidth: 4,
      yearlyReset: true,
    });

    const code = await numberingService.generateNumber(tenant, 'TRN');
    const currentYear = new Date().getUTCFullYear();
    expect(code).toBe(`TRN-${currentYear}-0001`);
  });

  it('PLT-5: rejects generation for an entityType with no configured scheme', async () => {
    await expect(numberingService.generateNumber(tenantId(), 'UNKNOWN')).rejects.toThrow(AppException);
  });

  it('PLT-5: rejects generation when the scheme requires a departmentCode and none is given', async () => {
    const tenant = tenantId();
    await numberingService.createScheme({
      tenantId: tenant,
      entityType: 'SOP',
      prefix: 'SOP',
      useDepartmentToken: true,
      paddingWidth: 3,
      yearlyReset: false,
    });
    await expect(numberingService.generateNumber(tenant, 'SOP')).rejects.toThrow(AppException);
  });

  it('PLT-5: numbering is tenant-isolated — two tenants each get their own sequence starting at 1', async () => {
    const tenantA = tenantId();
    const tenantB = tenantId();
    for (const tenant of [tenantA, tenantB]) {
      // eslint-disable-next-line no-await-in-loop
      await numberingService.createScheme({
        tenantId: tenant,
        entityType: 'EQP',
        prefix: 'EQP',
        useDepartmentToken: false,
        paddingWidth: 3,
        yearlyReset: false,
      });
    }

    expect(await numberingService.generateNumber(tenantA, 'EQP')).toBe('EQP-001');
    expect(await numberingService.generateNumber(tenantA, 'EQP')).toBe('EQP-002');
    // Tenant B's sequence is completely independent, despite the same entityType/prefix.
    expect(await numberingService.generateNumber(tenantB, 'EQP')).toBe('EQP-001');
  });

  it('PLT-5: 50 concurrent generateNumber calls produce a gapless, duplicate-free sequence', async () => {
    const tenant = tenantId();
    await numberingService.createScheme({
      tenantId: tenant,
      entityType: 'EQP',
      prefix: 'EQP',
      useDepartmentToken: false,
      paddingWidth: 4,
      yearlyReset: false,
    });

    const codes = await Promise.all(
      Array.from({ length: 50 }, () => numberingService.generateNumber(tenant, 'EQP')),
    );

    const numbers = codes.map((code) => Number(code.split('-')[1]));
    const unique = new Set(numbers);

    expect(codes).toHaveLength(50);
    expect(unique.size).toBe(50); // no duplicates
    expect([...unique].sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1)); // no gaps: exactly 1..50
  });

  it('PLT-5: updateScheme() applies changes and reports a before/after snapshot', async () => {
    const tenant = tenantId();
    const scheme = await numberingService.createScheme({
      tenantId: tenant,
      entityType: 'EQP',
      prefix: 'EQP',
      useDepartmentToken: false,
      paddingWidth: 3,
      yearlyReset: false,
    });

    const { before, after } = await numberingService.updateScheme(tenant, scheme.id, { paddingWidth: 5 });
    expect(before.paddingWidth).toBe(3);
    expect(after.paddingWidth).toBe(5);

    expect(await numberingService.generateNumber(tenant, 'EQP')).toBe('EQP-00001');
  });
});

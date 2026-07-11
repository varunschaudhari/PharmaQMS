import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose, { Model } from 'mongoose';
import { AppException } from '../../../common/exceptions/app.exception';
import { DepartmentService } from '../department.service';
import { Department, DepartmentDocument, DepartmentSchema } from '../schemas/department.schema';

describe('PLT-8 DepartmentService', () => {
  let mongod: MongoMemoryServer;
  let moduleRef: TestingModule;
  let departmentService: DepartmentService;
  let departmentModel: Model<DepartmentDocument>;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseModule.forFeature([{ name: Department.name, schema: DepartmentSchema }]),
      ],
      providers: [DepartmentService],
    }).compile();

    departmentService = moduleRef.get(DepartmentService);
    departmentModel = moduleRef.get(getModelToken(Department.name));
  });

  afterAll(async () => {
    await moduleRef.close();
    await mongod.stop();
  });

  afterEach(async () => {
    await departmentModel.collection.deleteMany({});
  });

  function tenantId(): string {
    return new mongoose.Types.ObjectId().toString();
  }

  it('PLT-8: creates a department with an uppercased code', async () => {
    const department = await departmentService.create({ tenantId: tenantId(), name: 'Quality Assurance', code: 'qa' });
    expect(department.code).toBe('QA');
    expect(department.isActive).toBe(true);
  });

  it('PLT-8: rejects a duplicate department code within the same tenant', async () => {
    const tenant = tenantId();
    await departmentService.create({ tenantId: tenant, name: 'Quality Assurance', code: 'QA' });
    await expect(departmentService.create({ tenantId: tenant, name: 'Quality Assurance 2', code: 'qa' })).rejects.toThrow(
      AppException,
    );
  });

  it('PLT-8: the same department code is allowed across different tenants (tenant isolation)', async () => {
    const departmentA = await departmentService.create({ tenantId: tenantId(), name: 'Quality Assurance', code: 'QA' });
    const departmentB = await departmentService.create({ tenantId: tenantId(), name: 'Quality Assurance', code: 'QA' });
    expect(departmentA.id).not.toBe(departmentB.id);
  });

  it('PLT-8: update() deactivates a department instead of deleting it (Iron Rule 3)', async () => {
    const tenant = tenantId();
    const department = await departmentService.create({ tenantId: tenant, name: 'Quality Assurance', code: 'QA' });

    const { before, after } = await departmentService.update(tenant, department.id, { isActive: false });
    expect(before.isActive).toBe(true);
    expect(after.isActive).toBe(false);

    const stillExists = await departmentModel.findById(department.id);
    expect(stillExists).not.toBeNull();
  });

  it('PLT-8: list() only returns departments for the given tenant', async () => {
    const tenantA = tenantId();
    const tenantB = tenantId();
    await departmentService.create({ tenantId: tenantA, name: 'Quality Assurance', code: 'QA' });
    await departmentService.create({ tenantId: tenantB, name: 'Production', code: 'PROD' });

    const departments = await departmentService.list(tenantA);
    expect(departments).toHaveLength(1);
    expect(departments[0].code).toBe('QA');
  });
});

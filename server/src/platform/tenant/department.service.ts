import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, type DepartmentData } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { Department, DepartmentDocument } from './schemas/department.schema';

export interface CreateDepartmentInput {
  tenantId: string;
  name: string;
  code: string;
}

export interface UpdateDepartmentInput {
  name?: string;
  isActive?: boolean;
}

@Injectable()
export class DepartmentService {
  constructor(@InjectModel(Department.name) private readonly departmentModel: Model<DepartmentDocument>) {}

  async create(input: CreateDepartmentInput): Promise<DepartmentData> {
    const existing = await this.departmentModel.findOne({ tenantId: input.tenantId, code: input.code.toUpperCase() });
    if (existing) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `Department code "${input.code}" is already in use.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    const doc = await this.departmentModel.create({ tenantId: input.tenantId, name: input.name, code: input.code });
    return toDepartmentData(doc);
  }

  async update(
    tenantId: string,
    departmentId: string,
    input: UpdateDepartmentInput,
  ): Promise<{ before: Record<string, unknown>; after: DepartmentData }> {
    const department = await this.departmentModel.findOne({ _id: departmentId, tenantId });
    if (!department) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Department not found.', HttpStatus.NOT_FOUND);
    }
    const before = { name: department.name, isActive: department.isActive };

    if (input.name !== undefined) department.name = input.name;
    // Iron Rule 3: no hard delete — "removing" a department is deactivation via isActive.
    if (input.isActive !== undefined) department.isActive = input.isActive;
    await department.save();

    return { before, after: toDepartmentData(department) };
  }

  async list(tenantId: string): Promise<DepartmentData[]> {
    const docs = await this.departmentModel.find({ tenantId }).sort({ name: 1 }).lean();
    return docs.map(toDepartmentData);
  }
}

function toDepartmentData(doc: {
  _id: unknown;
  tenantId: unknown;
  name: string;
  code: string;
  isActive: boolean;
}): DepartmentData {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    name: doc.name,
    code: doc.code,
    isActive: doc.isActive,
  };
}

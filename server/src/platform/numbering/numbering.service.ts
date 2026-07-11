import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, type NumberingSchemeData } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { AppException } from '../../common/exceptions/app.exception';
import { NumberingCounter, NumberingCounterDocument } from './schemas/numbering-counter.schema';
import { NumberingScheme, NumberingSchemeDocument } from './schemas/numbering-scheme.schema';

export interface CreateNumberingSchemeInput {
  tenantId: string;
  entityType: string;
  prefix: string;
  useDepartmentToken: boolean;
  paddingWidth: number;
  yearlyReset: boolean;
}

export interface UpdateNumberingSchemeInput {
  prefix?: string;
  useDepartmentToken?: boolean;
  paddingWidth?: number;
  yearlyReset?: boolean;
}

@Injectable()
export class NumberingService implements OnModuleInit {
  constructor(
    @InjectModel(NumberingScheme.name) private readonly schemeModel: Model<NumberingSchemeDocument>,
    @InjectModel(NumberingCounter.name) private readonly counterModel: Model<NumberingCounterDocument>,
  ) {}

  // Mongoose builds indexes asynchronously in the background (autoIndex) after a model is
  // registered. The unique (tenantId, entityType, departmentCode, year) index is what makes
  // generateNumber()'s upsert race-safe for a scope's very first counter document — without
  // waiting for it here, concurrent requests hitting a brand-new counter immediately after
  // server startup could each insert their own document instead of sharing one. Nest awaits
  // every module's onModuleInit before the app starts accepting traffic, so this closes the
  // window entirely.
  async onModuleInit(): Promise<void> {
    await this.counterModel.init();
  }

  async createScheme(input: CreateNumberingSchemeInput): Promise<NumberingSchemeData> {
    const doc = await this.schemeModel.create({
      tenantId: input.tenantId,
      entityType: input.entityType,
      prefix: input.prefix,
      useDepartmentToken: input.useDepartmentToken,
      paddingWidth: input.paddingWidth,
      yearlyReset: input.yearlyReset,
    });
    return toSchemeData(doc);
  }

  async updateScheme(
    tenantId: string,
    schemeId: string,
    input: UpdateNumberingSchemeInput,
  ): Promise<{ before: Record<string, unknown>; after: NumberingSchemeData }> {
    const scheme = await this.schemeModel.findOne({ _id: schemeId, tenantId });
    if (!scheme) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Numbering scheme not found.', HttpStatus.NOT_FOUND);
    }
    const before = schemeSnapshot(scheme);

    if (input.prefix !== undefined) scheme.prefix = input.prefix;
    if (input.useDepartmentToken !== undefined) scheme.useDepartmentToken = input.useDepartmentToken;
    if (input.paddingWidth !== undefined) scheme.paddingWidth = input.paddingWidth;
    if (input.yearlyReset !== undefined) scheme.yearlyReset = input.yearlyReset;
    await scheme.save();

    return { before, after: toSchemeData(scheme) };
  }

  async listSchemes(tenantId: string): Promise<NumberingSchemeData[]> {
    const docs = await this.schemeModel.find({ tenantId }).sort({ entityType: 1 }).lean();
    return docs.map(toSchemeData);
  }

  // PLT-5: atomic, gapless, duplicate-proof sequence generation (SPEC.md §6.1) — a single
  // findOneAndUpdate $inc/upsert against the unique (tenantId, entityType, departmentCode, year)
  // counter key. See numbering-counter.schema.ts for why this is safe under concurrency.
  async generateNumber(tenantId: string, entityType: string, departmentCode?: string): Promise<string> {
    const normalizedEntityType = entityType.toUpperCase();
    const scheme = await this.schemeModel.findOne({ tenantId, entityType: normalizedEntityType });
    if (!scheme) {
      throw new AppException(
        ErrorCode.NOT_FOUND,
        `No numbering scheme configured for entityType "${entityType}".`,
        HttpStatus.NOT_FOUND,
      );
    }

    if (scheme.useDepartmentToken && !departmentCode) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        `entityType "${entityType}" requires a departmentCode.`,
        HttpStatus.BAD_REQUEST,
      );
    }

    const year = scheme.yearlyReset ? new Date().getUTCFullYear() : null;
    const departmentKey = scheme.useDepartmentToken ? (departmentCode as string).toUpperCase() : null;

    const counter = await this.counterModel.findOneAndUpdate(
      { tenantId, entityType: normalizedEntityType, departmentCode: departmentKey, year },
      { $inc: { lastNumber: 1 } },
      { upsert: true, new: true },
    );

    return formatCode(scheme, counter.lastNumber, departmentKey, year);
  }
}

function formatCode(
  scheme: NumberingSchemeDocument,
  number: number,
  departmentKey: string | null,
  year: number | null,
): string {
  const padded = String(number).padStart(scheme.paddingWidth, '0');
  const segments = [scheme.prefix];
  if (departmentKey) {
    segments.push(departmentKey);
  }
  if (year) {
    segments.push(String(year));
  }
  segments.push(padded);
  return segments.join('-');
}

function schemeSnapshot(scheme: NumberingSchemeDocument): Record<string, unknown> {
  return {
    prefix: scheme.prefix,
    useDepartmentToken: scheme.useDepartmentToken,
    paddingWidth: scheme.paddingWidth,
    yearlyReset: scheme.yearlyReset,
  };
}

function toSchemeData(doc: {
  _id: unknown;
  tenantId: unknown;
  entityType: string;
  prefix: string;
  useDepartmentToken: boolean;
  paddingWidth: number;
  yearlyReset: boolean;
}): NumberingSchemeData {
  return {
    id: String(doc._id),
    tenantId: String(doc.tenantId),
    entityType: doc.entityType,
    prefix: doc.prefix,
    useDepartmentToken: doc.useDepartmentToken,
    paddingWidth: doc.paddingWidth,
    yearlyReset: doc.yearlyReset,
  };
}

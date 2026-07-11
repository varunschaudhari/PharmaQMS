import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type NumberingSchemeDocument = HydratedDocument<NumberingScheme>;

// PLT-5: tenant-configurable numbering scheme for one entity type (e.g. 'SOP', 'EQP', 'TRN').
// Formats as {prefix}[-{departmentCode}][-{year}]-{paddedNumber}, e.g. SOP-QA-001, EQP-0042,
// TRN-2026-0113 (SPEC.md §6.1). CLAUDE.md: "Entity codes come from PLT-5 — never generate
// identifiers inline" — future DOC/EQP/TRN modules call NumberingService.generateNumber().
@Schema({ collection: 'numberingSchemes', timestamps: true })
export class NumberingScheme {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  entityType!: string;

  @Prop({ required: true, trim: true, uppercase: true })
  prefix!: string;

  @Prop({ default: false })
  useDepartmentToken!: boolean;

  @Prop({ required: true, default: 3 })
  paddingWidth!: number;

  @Prop({ default: false })
  yearlyReset!: boolean;
}

export const NumberingSchemeSchema = SchemaFactory.createForClass(NumberingScheme);

// Iron Rule 5: every compound index starts with tenantId. One scheme per entity type per tenant.
NumberingSchemeSchema.index({ tenantId: 1, entityType: 1 }, { unique: true });

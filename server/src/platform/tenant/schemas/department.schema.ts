import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type DepartmentDocument = HydratedDocument<Department>;

// PLT-8: department master. `code` doubles as the department token used by PLT-5 numbering
// (e.g. the "QA" in SOP-QA-001) — regulated entity, no hard delete (Iron Rule 3), deactivate via
// `isActive` instead.
@Schema({ collection: 'departments', timestamps: true })
export class Department {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, uppercase: true })
  code!: string;

  @Prop({ default: true })
  isActive!: boolean;
}

export const DepartmentSchema = SchemaFactory.createForClass(Department);

// Iron Rule 5: every compound index starts with tenantId. Department codes are unique per tenant.
DepartmentSchema.index({ tenantId: 1, code: 1 }, { unique: true });

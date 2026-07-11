import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type NumberingCounterDocument = HydratedDocument<NumberingCounter>;

// PLT-5: the atomic counter itself, kept separate from NumberingScheme (the display/format
// config). departmentCode/year are always present (null when the scheme doesn't use them) so the
// compound unique index below fully determines the counter's scope for every scheme combination.
@Schema({ collection: 'numberingCounters', timestamps: false })
export class NumberingCounter {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true, uppercase: true })
  entityType!: string;

  @Prop({ type: String, default: null })
  departmentCode!: string | null;

  @Prop({ type: Number, default: null })
  year!: number | null;

  @Prop({ type: Number, required: true, default: 0 })
  lastNumber!: number;
}

export const NumberingCounterSchema = SchemaFactory.createForClass(NumberingCounter);

// This is THE atomicity/gaplessness/uniqueness guarantee (SPEC.md §6.1): findOneAndUpdate's
// $inc against this unique compound key is a single atomic Mongo operation, so concurrent
// callers can never observe or receive the same lastNumber twice, and upsert races on a
// not-yet-existing counter are resolved by the index itself.
NumberingCounterSchema.index(
  { tenantId: 1, entityType: 1, departmentCode: 1, year: 1 },
  { unique: true },
);

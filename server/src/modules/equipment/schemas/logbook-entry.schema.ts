import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CleaningType, LogbookEntryType } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { applyAppendOnly } from '../../../common/database/append-only.plugin';

export type LogbookEntryDocument = HydratedDocument<LogbookEntry>;

// EQP-6: one digital logbook entry (SPEC.md §7.3). Regulated entity — IMMUTABLE, never edited
// after creation (Iron Rule 3-adjacent). A correction is a NEW entry of type AMENDMENT
// referencing `amendsEntryId`; no service method may update/delete an existing entry (enforced
// by the append-only plugin below, same pattern as PLT-2 auditEvents / PLT-3 signatures).
@Schema({ collection: 'logbookEntries', timestamps: false })
export class LogbookEntry {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Equipment', required: true })
  equipmentId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(LogbookEntryType), required: true })
  entryType!: LogbookEntryType;

  @Prop({ type: String, default: null })
  productBatchRef!: string | null;

  @Prop({ type: String, enum: Object.values(CleaningType), default: null })
  cleaningType!: CleaningType | null;

  @Prop({ type: String, default: null })
  description!: string | null;

  @Prop({ type: String, default: null })
  photoFileKey!: string | null;

  @Prop({ type: String, default: null })
  photoFileName!: string | null;

  @Prop({ type: String, default: null })
  photoContentType!: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'LogbookEntry', default: null })
  amendsEntryId!: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  performedByUserId!: string;

  @Prop({ type: String, required: true })
  performedByUserFullName!: string;

  // Server UTC timestamp only (Iron Rule 6) — set explicitly, not via `timestamps: true`, since
  // this collection has no updatedAt (entries are never updated).
  @Prop({ type: Date, required: true, default: () => new Date() })
  occurredAt!: Date;
}

export const LogbookEntrySchema = SchemaFactory.createForClass(LogbookEntry);

LogbookEntrySchema.index({ tenantId: 1, equipmentId: 1, occurredAt: -1 });

// EQP-6: entries are immutable — enforced at the Mongoose layer, not just convention (same
// pattern as PLT-2 auditEvents / PLT-3 signatures).
applyAppendOnly(LogbookEntrySchema, 'logbookEntries is append-only: corrections are a new AMENDMENT entry, never an edit.');

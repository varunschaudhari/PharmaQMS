import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CleaningType, RoomCleaningEntryType } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { applyAppendOnly } from '../../../common/database/append-only.plugin';

export type RoomCleaningEntryDocument = HydratedDocument<RoomCleaningEntry>;

// QRX-1: one digital cleaning-log entry (SPEC.md §7.4). Regulated entity — IMMUTABLE, never
// edited after creation (Iron Rule 3-adjacent, mirrors EQP-6's LogbookEntry exactly). A
// correction is a NEW entry of type AMENDMENT referencing `amendsEntryId`; no service method may
// update/delete an existing entry (enforced by the append-only plugin below, same pattern as
// PLT-2 auditEvents / PLT-3 signatures / EQP-6 logbookEntries).
@Schema({ collection: 'roomCleaningEntries', timestamps: false })
export class RoomCleaningEntry {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(RoomCleaningEntryType), required: true })
  entryType!: RoomCleaningEntryType;

  @Prop({ type: String, enum: Object.values(CleaningType), default: null })
  cleaningType!: CleaningType | null;

  @Prop({ type: String, default: null })
  remarks!: string | null;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'RoomCleaningEntry', default: null })
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

export const RoomCleaningEntrySchema = SchemaFactory.createForClass(RoomCleaningEntry);

RoomCleaningEntrySchema.index({ tenantId: 1, roomId: 1, occurredAt: -1 });

// QRX-1: entries are immutable — enforced at the Mongoose layer, not just convention (same
// pattern as PLT-2 auditEvents / PLT-3 signatures / EQP-6 logbookEntries).
applyAppendOnly(RoomCleaningEntrySchema, 'roomCleaningEntries is append-only: corrections are a new AMENDMENT entry, never an edit.');

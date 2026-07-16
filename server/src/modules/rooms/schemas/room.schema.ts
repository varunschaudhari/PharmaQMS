import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { RoomClassification, RoomStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type RoomDocument = HydratedDocument<Room>;

// QRX-1: room/area master (SPEC.md §7.4) — thin v1.5 layer, built the same way as Equipment's own
// master (EQP-1). Regulated entity: no hard delete (Iron Rule 3); "removal" is the terminal
// Retired status, never document deletion.
@Schema({ collection: 'rooms', timestamps: true })
export class Room {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // PLT-5: e.g. ROOM-001 — assigned by the numbering service at creation, never inline.
  @Prop({ required: true, trim: true })
  roomCode!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: null, trim: true })
  block!: string | null;

  @Prop({ type: String, enum: Object.values(RoomClassification), required: true, default: RoomClassification.GENERAL })
  classification!: RoomClassification;

  @Prop({ type: String, enum: Object.values(RoomStatus), required: true, default: RoomStatus.ACTIVE })
  status!: RoomStatus;

  // Optional — when set, the room's overdue-cleaning notifications go to this department's head
  // (same recipient precedent as EQP-4's calibration scanner / TRN-5).
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Department', default: null })
  departmentId!: Types.ObjectId | null;
}

export const RoomSchema = SchemaFactory.createForClass(Room);

// Iron Rule 5: every compound index starts with tenantId.
RoomSchema.index({ tenantId: 1, roomCode: 1 }, { unique: true });
RoomSchema.index({ tenantId: 1, name: 1 });

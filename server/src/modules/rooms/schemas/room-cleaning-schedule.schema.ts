import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { RoomCleaningFrequency } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type RoomCleaningScheduleDocument = HydratedDocument<RoomCleaningSchedule>;

// QRX-1: one active recurring cleaning schedule per room (SPEC.md §7.4) — mirrors EQP-4's
// CalibrationSchedule shape. Two independently-tracked due dates: the routine cadence and the
// separate full/deep-clean interval; nextRoutineDueDate/nextFullDueDate are set at creation and
// recomputed only when a matching cleaning entry is logged (see RoomCleaningService.logCleaning).
@Schema({ collection: 'roomCleaningSchedules', timestamps: true })
export class RoomCleaningSchedule {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(RoomCleaningFrequency), required: true })
  routineFrequency!: RoomCleaningFrequency;

  @Prop({ type: Number, required: true })
  fullCleaningIntervalDays!: number;

  @Prop({ type: Date, required: true })
  nextRoutineDueDate!: Date;

  @Prop({ type: Date, required: true })
  nextFullDueDate!: Date;
}

export const RoomCleaningScheduleSchema = SchemaFactory.createForClass(RoomCleaningSchedule);

// Iron Rule 5 + QRX-1: one schedule per room.
RoomCleaningScheduleSchema.index({ tenantId: 1, roomId: 1 }, { unique: true });
RoomCleaningScheduleSchema.index({ tenantId: 1, nextRoutineDueDate: 1 });
RoomCleaningScheduleSchema.index({ tenantId: 1, nextFullDueDate: 1 });

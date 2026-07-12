import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type DueDateScanRunDocument = HydratedDocument<DueDateScanRun>;

// PLT-6: one completed due-date scan per (tenant, scanner, calendar day) — the idempotency
// record that makes the daily scan job safe to re-run (crash recovery, overlapping schedules,
// manual triggers). runDate is the day in the TENANT's timezone, formatted YYYY-MM-DD.
@Schema({ collection: 'dueDateScanRuns', timestamps: true })
export class DueDateScanRun {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  scannerKey!: string;

  @Prop({ required: true })
  runDate!: string;

  @Prop({ required: true, default: 0 })
  notificationsCreated!: number;

  @Prop({ type: Date, required: true })
  completedAt!: Date;
}

export const DueDateScanRunSchema = SchemaFactory.createForClass(DueDateScanRun);

// Iron Rule 5 + PLT-6 idempotency: at most one completed run per tenant/scanner/day.
DueDateScanRunSchema.index({ tenantId: 1, scannerKey: 1, runDate: 1 }, { unique: true });

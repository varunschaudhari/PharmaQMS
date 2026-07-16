import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CalibrationAgencyStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ _id: true, timestamps: false })
export class CalibrationAgencyCertificate {
  @Prop({ required: true })
  fileKey!: string;

  @Prop({ required: true })
  fileName!: string;

  @Prop({ required: true })
  contentType!: string;

  @Prop({ type: Date, required: true, default: () => new Date() })
  uploadedAt!: Date;
}

const CalibrationAgencyCertificateSchema = SchemaFactory.createForClass(CalibrationAgencyCertificate);

export type CalibrationAgencyDocument = HydratedDocument<CalibrationAgency>;

// EQP-11 (SPEC.md §7.3): external calibration agency master — a sub-concern of the Equipment
// module (same as CalibrationSchedule/CalibrationRecord), so `agencyId` on CalibrationSchedule is
// a REAL Mongoose reference, not an opaque cross-module string. Regulated entity: no hard delete
// (Iron Rule 3) — Suspended is the "removal" state, never document deletion.
@Schema({ collection: 'calibrationAgencies', timestamps: true })
export class CalibrationAgency {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: null, trim: true })
  contactName!: string | null;

  @Prop({ type: String, default: null, trim: true })
  contactEmail!: string | null;

  @Prop({ type: String, default: null, trim: true })
  contactPhone!: string | null;

  // e.g. an NABL accreditation number.
  @Prop({ type: String, default: null, trim: true })
  accreditationNumber!: string | null;

  @Prop({ type: Date, default: null })
  accreditationValidUntil!: Date | null;

  @Prop({ type: String, enum: Object.values(CalibrationAgencyStatus), required: true, default: CalibrationAgencyStatus.ACTIVE })
  status!: CalibrationAgencyStatus;

  // Multiple uploads over time as accreditation renews — each independently addressable.
  @Prop({ type: [CalibrationAgencyCertificateSchema], default: [] })
  certificates!: Types.DocumentArray<CalibrationAgencyCertificate>;
}

export const CalibrationAgencySchema = SchemaFactory.createForClass(CalibrationAgency);

// Iron Rule 5: every compound index starts with tenantId.
CalibrationAgencySchema.index({ tenantId: 1, name: 1 });
CalibrationAgencySchema.index({ tenantId: 1, status: 1 });

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { EquipmentStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type EquipmentDocument = HydratedDocument<Equipment>;

// EQP-1: equipment master (SPEC.md §7.3) — flagship, QR-first. Regulated entity: no hard delete
// (Iron Rule 3); "removal" is the terminal Retired status, never document deletion.
@Schema({ collection: 'equipment', timestamps: true })
export class Equipment {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // PLT-5: e.g. EQP-0042 — assigned by the numbering service at creation, never inline.
  @Prop({ required: true, trim: true })
  equipmentCode!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: null, trim: true })
  make!: string | null;

  @Prop({ type: String, default: null, trim: true })
  modelName!: string | null;

  @Prop({ type: String, default: null, trim: true })
  serialNumber!: string | null;

  // Free-text in v1 — no Room master yet (QRX-1 is v1.5, out of scope for this build phase).
  @Prop({ required: true, trim: true })
  location!: string;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'Department', required: true })
  departmentId!: Types.ObjectId;

  @Prop({ required: true })
  isGmpCritical!: boolean;

  @Prop({ type: String, enum: Object.values(EquipmentStatus), required: true, default: EquipmentStatus.ACTIVE })
  status!: EquipmentStatus;

  @Prop({ type: Date, default: null })
  installDate!: Date | null;
}

export const EquipmentSchema = SchemaFactory.createForClass(Equipment);

// Iron Rule 5: every compound index starts with tenantId.
EquipmentSchema.index({ tenantId: 1, equipmentCode: 1 }, { unique: true });
EquipmentSchema.index({ tenantId: 1, departmentId: 1, status: 1 });

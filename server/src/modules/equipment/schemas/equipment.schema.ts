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

  // Free-text location, kept for backward compatibility with pre-QRX-1 records that predate the
  // Room master. New/updated equipment should prefer `roomId` below.
  @Prop({ required: true, trim: true })
  location!: string;

  // QRX-1: opaque reference to a Room — deliberately NOT validated against the Rooms module here
  // (business modules never depend on each other directly, CLAUDE.md). Same polymorphic-reference
  // precedent as AuditEvent/Signature/Notification/WorkflowInstance/QrCode's entityType+entityId;
  // see EquipmentData's header comment in packages/shared for the full rationale. Back-filled for
  // existing records by scripts/migrate-equipment-rooms.ts.
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Room', default: null })
  roomId!: Types.ObjectId | null;

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

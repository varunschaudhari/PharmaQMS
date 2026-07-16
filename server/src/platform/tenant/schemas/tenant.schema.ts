import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { CredentialType, NotificationChannel, NotificationEmailMode } from '@pharmaqms/shared';
import { HydratedDocument } from 'mongoose';

export type TenantDocument = HydratedDocument<Tenant>;

// PLT-8: tenant-configurable settings (SPEC.md §5.4 timezone; §5.2 e-sign mode; §5.3 session
// timeouts; PLT-6 notification email mode). JWT *secrets* are never tenant-stored — see
// AuthService/EsignService, which fall back to the platform env config when a tenant (or a
// specific setting) has no override.
@Schema({ _id: false })
export class TenantSettings {
  @Prop({ type: String, required: true, default: 'Asia/Kolkata' })
  timezone!: string;

  @Prop({ type: String, enum: Object.values(CredentialType), required: true, default: CredentialType.PASSWORD })
  signatureCredentialType!: CredentialType;

  @Prop({ type: Number, required: true, default: 15 })
  accessTokenTtlMinutes!: number;

  @Prop({ type: Number, required: true, default: 12 })
  refreshTokenTtlHoursDefault!: number;

  @Prop({ type: Number, required: true, default: 30 })
  refreshTokenTtlDaysRemembered!: number;

  // PLT-6: immediate per-event emails, or one daily digest per user.
  @Prop({
    type: String,
    enum: Object.values(NotificationEmailMode),
    required: true,
    default: NotificationEmailMode.IMMEDIATE,
  })
  notificationEmailMode!: NotificationEmailMode;

  // TRN-5: grace period (days from assignment) before a pending training becomes overdue.
  @Prop({ type: Number, required: true, default: 7 })
  trainingGracePeriodDays!: number;

  // EQP-4: whether overdue calibration blocks usage logging (with a warning) or just warns.
  @Prop({ type: Boolean, required: true, default: true })
  blockUsageWhenCalibrationOverdue!: boolean;

  // EQP-7: the Role a breakdown-triggered maintenance task is assigned to; null until configured.
  @Prop({ type: String, default: null })
  maintenanceRoleId!: string | null;

  // EQP-7: whether a closed maintenance task additionally requires a QA/user verification e-sign.
  @Prop({ type: Boolean, required: true, default: true })
  requireMaintenanceVerification!: boolean;

  // PLT-6-WA: which channel(s) this tenant has enabled — defaults to email-only everywhere, so an
  // unconfigured tenant's behavior is byte-for-byte unchanged from before WhatsApp existed.
  @Prop({ type: [String], enum: Object.values(NotificationChannel), required: true, default: [NotificationChannel.EMAIL] })
  notificationChannels!: NotificationChannel[];

  // PLT-6-WA: per-tenant Meta template-name overrides, keyed by internal template key. Never
  // holds provider credentials — those are env-only (see whatsapp.config.ts).
  @Prop({ type: Object, default: {} })
  whatsappTemplateNames!: Partial<Record<string, string>>;

  // TRN-6: minimum score (percentage, 0-100) to pass a document assessment.
  @Prop({ type: Number, required: true, default: 80 })
  trainingAssessmentPassMarkPercentage!: number;

  // TRN-6: attempts allowed before escalating to the department head.
  @Prop({ type: Number, required: true, default: 3 })
  trainingAssessmentMaxAttempts!: number;
}

const TenantSettingsSchema = SchemaFactory.createForClass(TenantSettings);

// PLT-8: the root tenant entity — everything else's `tenantId` refers to this document's `_id`.
// This is the one collection that is not itself tenant-scoped (it IS the tenant).
@Schema({ collection: 'tenants', timestamps: true })
export class Tenant {
  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, trim: true, lowercase: true, unique: true })
  slug!: string;

  @Prop({ type: TenantSettingsSchema, required: true, default: () => ({}) })
  settings!: TenantSettings;

  @Prop({ default: true })
  isActive!: boolean;
}

export const TenantSchema = SchemaFactory.createForClass(Tenant);

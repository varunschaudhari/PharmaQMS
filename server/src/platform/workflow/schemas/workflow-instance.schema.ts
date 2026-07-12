import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { WorkflowInstanceStatus } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type WorkflowInstanceDocument = HydratedDocument<WorkflowInstance>;

// PLT-4: a workflow instance attached to any entity via a polymorphic ref (entityType/entityId —
// same pattern as AuditEvent/Signature). One instance per entity: re-submitting after a
// rejection reuses the same instance rather than creating a new one.
@Schema({ collection: 'workflowInstances', timestamps: true })
export class WorkflowInstance {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: SchemaTypes.ObjectId, ref: 'WorkflowTemplate', required: true })
  templateId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  entityType!: string;

  @Prop({ type: String, required: true })
  entityId!: string;

  @Prop({ type: String, enum: Object.values(WorkflowInstanceStatus), required: true })
  status!: WorkflowInstanceStatus;

  // -1 while DRAFT (never submitted, or rejected all the way back to the author); the index into
  // the template's `steps` array once IN_PROGRESS.
  @Prop({ type: Number, required: true, default: -1 })
  currentStepIndex!: number;

  // Denormalized from template.steps[currentStepIndex].roleId, kept in sync on every step
  // change, so GET /workflow/my-pending-tasks can query directly instead of an N+1 template
  // lookup per instance.
  @Prop({ type: String, default: null })
  currentStepRoleId!: string | null;

  // Admin override (PLT-4 reassign) — when set, only this specific user (not the step's role
  // generally) may act on the current step. Cleared whenever the step changes.
  @Prop({ type: String, default: null })
  overrideAssigneeUserId!: string | null;

  // PLT-6: the author who (last) submitted this instance — the recipient of approved/rejected
  // outcome notifications. Set on every submit.
  @Prop({ type: String, default: null })
  submittedByUserId!: string | null;
}

export const WorkflowInstanceSchema = SchemaFactory.createForClass(WorkflowInstance);

WorkflowInstanceSchema.index({ tenantId: 1, entityType: 1, entityId: 1 }, { unique: true });
WorkflowInstanceSchema.index({ tenantId: 1, status: 1, currentStepRoleId: 1 });
WorkflowInstanceSchema.index({ tenantId: 1, status: 1, overrideAssigneeUserId: 1 });

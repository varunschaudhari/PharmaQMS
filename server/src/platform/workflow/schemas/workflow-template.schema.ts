import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SignatureMeaning } from '@pharmaqms/shared';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

// PLT-4: one ordered step in a tenant-configurable approval flow (SPEC.md §6.1 / §7.1 DOC-3,
// e.g. Author -> Dept Head review -> QA Head approval).
@Schema({ _id: false })
export class WorkflowTemplateStep {
  @Prop({ required: true, trim: true })
  name!: string;

  // Role-based assignee resolution — any active user holding this role may act on the step
  // (or whoever it's been reassigned to for a specific instance — see WorkflowInstance).
  @Prop({ type: SchemaTypes.ObjectId, ref: 'Role', required: true })
  roleId!: Types.ObjectId;

  @Prop({ type: String, enum: Object.values(SignatureMeaning), required: true })
  signatureMeaning!: SignatureMeaning;

  // null = a rejection at this step returns the instance to DRAFT (the author); a number is the
  // index of an earlier step to re-enter IN_PROGRESS at instead (SPEC.md: "reject-back-to-step").
  @Prop({ type: Number, default: null })
  rejectToStepIndex!: number | null;
}

const WorkflowTemplateStepSchema = SchemaFactory.createForClass(WorkflowTemplateStep);

export type WorkflowTemplateDocument = HydratedDocument<WorkflowTemplate>;

@Schema({ collection: 'workflowTemplates', timestamps: true })
export class WorkflowTemplate {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  tenantId!: Types.ObjectId;

  // Which business entity type this template applies to (e.g. 'Document') — one template per
  // (tenantId, entityType), same convention as PLT-5's NumberingScheme.
  @Prop({ required: true, trim: true })
  entityType!: string;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ type: [WorkflowTemplateStepSchema], required: true })
  steps!: WorkflowTemplateStep[];

  @Prop({ default: true })
  isActive!: boolean;
}

export const WorkflowTemplateSchema = SchemaFactory.createForClass(WorkflowTemplate);

WorkflowTemplateSchema.index({ tenantId: 1, entityType: 1 }, { unique: true });

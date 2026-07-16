// PLT-6-WA: the highest-value notification events mapped to pre-approved WhatsApp Business
// templates (SPEC.md §6.1 PLT-6 events, narrowed to the set worth a WhatsApp send). Each key maps
// 1:1 to a Meta template name via DEFAULT_WHATSAPP_TEMPLATE_NAMES (tenant-overridable — see
// resolveWhatsAppTemplateName) and to a positional parameter list via whatsapp-templates.ts's
// builder functions. See docs/whatsapp-templates.md for the literal template bodies submitted to
// Meta for approval.
export enum WhatsAppTemplateKey {
  TASK_ASSIGNED = 'task_assigned',
  APPROVAL_COMPLETED = 'approval_completed',
  CALIBRATION_DUE = 'calibration_due',
  CALIBRATION_OVERDUE = 'calibration_overdue',
  TRAINING_OVERDUE = 'training_overdue',
  DOCUMENT_REVIEW_DUE = 'document_review_due',
}

// The literal Meta-registered template name for each key, used unless a tenant has its own
// override configured (Tenant.settings.whatsappTemplateNames) — e.g. because their WhatsApp
// Business Account had the template approved under a different name.
export const DEFAULT_WHATSAPP_TEMPLATE_NAMES: Record<WhatsAppTemplateKey, string> = {
  [WhatsAppTemplateKey.TASK_ASSIGNED]: 'pharmaqms_task_assigned',
  [WhatsAppTemplateKey.APPROVAL_COMPLETED]: 'pharmaqms_approval_completed',
  [WhatsAppTemplateKey.CALIBRATION_DUE]: 'pharmaqms_calibration_due',
  [WhatsAppTemplateKey.CALIBRATION_OVERDUE]: 'pharmaqms_calibration_overdue',
  [WhatsAppTemplateKey.TRAINING_OVERDUE]: 'pharmaqms_training_overdue',
  [WhatsAppTemplateKey.DOCUMENT_REVIEW_DUE]: 'pharmaqms_document_review_due',
};

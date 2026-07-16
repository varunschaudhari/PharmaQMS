import { WhatsAppTemplateKey } from './enums/whatsapp-template-key';

// PLT-6-WA: WhatsApp template parameter mapping — the shared source of truth for which Meta
// template a notification maps to and what positional {{1}}, {{2}}, ... parameters it carries.
// Mirrors workflow-notification-templates.ts's plain-text content builders (same call sites build
// both — see workflow-notification.listener.ts and the three due-date scanners), but returns
// structured data instead of freeform text, since WhatsApp Business templates require pre-approved
// bodies with named parameter slots (see docs/whatsapp-templates.md for the literal bodies).
export interface WhatsAppTemplateParams {
  templateKey: WhatsAppTemplateKey;
  // Positional parameters, in the exact order the approved template body expects them.
  params: string[];
}

export function taskAssignedWhatsAppParams(
  entityType: string,
  entityId: string,
  stepName: string,
): WhatsAppTemplateParams {
  return {
    templateKey: WhatsAppTemplateKey.TASK_ASSIGNED,
    params: [entityType, entityId, stepName],
  };
}

export function approvalCompletedWhatsAppParams(
  entityType: string,
  entityId: string,
  actorFullName: string,
): WhatsAppTemplateParams {
  return {
    templateKey: WhatsAppTemplateKey.APPROVAL_COMPLETED,
    params: [entityType, entityId, actorFullName],
  };
}

// EQP-4: dueDate is formatted YYYY-MM-DD (same as the scanner's dedupeKey date), overdue selects
// the OVERDUE template variant (distinct wording/urgency from the DUE_SOON one).
export function calibrationDueWhatsAppParams(
  equipmentCode: string,
  equipmentName: string,
  dueDate: string,
  overdue: boolean,
): WhatsAppTemplateParams {
  return {
    templateKey: overdue ? WhatsAppTemplateKey.CALIBRATION_OVERDUE : WhatsAppTemplateKey.CALIBRATION_DUE,
    params: [equipmentCode, equipmentName, dueDate],
  };
}

export function trainingOverdueWhatsAppParams(
  userFullName: string,
  docNumber: string,
  documentTitle: string,
): WhatsAppTemplateParams {
  return {
    templateKey: WhatsAppTemplateKey.TRAINING_OVERDUE,
    params: [userFullName, docNumber, documentTitle],
  };
}

export function documentReviewDueWhatsAppParams(
  docNumber: string,
  title: string,
  dueDate: string,
): WhatsAppTemplateParams {
  return {
    templateKey: WhatsAppTemplateKey.DOCUMENT_REVIEW_DUE,
    params: [docNumber, title, dueDate],
  };
}

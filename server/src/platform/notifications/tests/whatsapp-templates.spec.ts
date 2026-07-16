import {
  WhatsAppTemplateKey,
  approvalCompletedWhatsAppParams,
  calibrationDueWhatsAppParams,
  documentReviewDueWhatsAppParams,
  taskAssignedWhatsAppParams,
  trainingOverdueWhatsAppParams,
} from '@pharmaqms/shared';

// PLT-6-WA: the shared template-parameter-mapping builder functions (packages/shared's source of
// truth — same pattern as workflow-transitions.spec.ts testing a shared pure-function module from
// the server's Jest suite, since packages/shared has no test runner of its own).
describe('PLT-6-WA WhatsApp template parameter mapping', () => {
  it('PLT-6-WA: taskAssignedWhatsAppParams maps to the TASK_ASSIGNED template with entityType/entityId/stepName in order', () => {
    const result = taskAssignedWhatsAppParams('DocumentVersion', 'v-1', 'Dept Head Review');
    expect(result).toEqual({
      templateKey: WhatsAppTemplateKey.TASK_ASSIGNED,
      params: ['DocumentVersion', 'v-1', 'Dept Head Review'],
    });
  });

  it('PLT-6-WA: approvalCompletedWhatsAppParams maps to the APPROVAL_COMPLETED template with entityType/entityId/actorFullName in order', () => {
    const result = approvalCompletedWhatsAppParams('DocumentVersion', 'v-1', 'Quinn Qahead');
    expect(result).toEqual({
      templateKey: WhatsAppTemplateKey.APPROVAL_COMPLETED,
      params: ['DocumentVersion', 'v-1', 'Quinn Qahead'],
    });
  });

  it('PLT-6-WA: calibrationDueWhatsAppParams selects CALIBRATION_DUE for due-soon', () => {
    const result = calibrationDueWhatsAppParams('EQP-0001', 'Autoclave', '2026-08-01', false);
    expect(result).toEqual({
      templateKey: WhatsAppTemplateKey.CALIBRATION_DUE,
      params: ['EQP-0001', 'Autoclave', '2026-08-01'],
    });
  });

  it('PLT-6-WA: calibrationDueWhatsAppParams selects CALIBRATION_OVERDUE for overdue', () => {
    const result = calibrationDueWhatsAppParams('EQP-0001', 'Autoclave', '2026-01-01', true);
    expect(result.templateKey).toBe(WhatsAppTemplateKey.CALIBRATION_OVERDUE);
    expect(result.params).toEqual(['EQP-0001', 'Autoclave', '2026-01-01']);
  });

  it('PLT-6-WA: trainingOverdueWhatsAppParams maps to the TRAINING_OVERDUE template with userFullName/docNumber/documentTitle in order', () => {
    const result = trainingOverdueWhatsAppParams('Olive Operator', 'SOP-QA-001', 'Cleaning of pH meters');
    expect(result).toEqual({
      templateKey: WhatsAppTemplateKey.TRAINING_OVERDUE,
      params: ['Olive Operator', 'SOP-QA-001', 'Cleaning of pH meters'],
    });
  });

  it('PLT-6-WA: documentReviewDueWhatsAppParams maps to the DOCUMENT_REVIEW_DUE template with docNumber/title/dueDate in order', () => {
    const result = documentReviewDueWhatsAppParams('SOP-QA-002', 'Change Control SOP', '2026-09-01');
    expect(result).toEqual({
      templateKey: WhatsAppTemplateKey.DOCUMENT_REVIEW_DUE,
      params: ['SOP-QA-002', 'Change Control SOP', '2026-09-01'],
    });
  });
});

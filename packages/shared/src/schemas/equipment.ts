import { z } from 'zod';
import {
  CalibrationDispositionOutcome,
  CalibrationResult,
  EquipmentStatus,
  QualificationResult,
  QualificationType,
} from '../enums/equipment';
import { CleaningType } from '../enums/logbook';

export const createEquipmentRequestSchema = z.object({
  name: z.string().min(1, 'name is required'),
  make: z.string().optional(),
  modelName: z.string().optional(),
  serialNumber: z.string().optional(),
  location: z.string().min(1, 'location is required'),
  departmentId: z.string().min(1, 'departmentId is required'),
  isGmpCritical: z.coerce.boolean().default(false),
  installDate: z.string().optional(),
});
export type CreateEquipmentRequest = z.infer<typeof createEquipmentRequestSchema>;

export const updateEquipmentRequestSchema = z.object({
  name: z.string().min(1).optional(),
  make: z.string().optional(),
  modelName: z.string().optional(),
  serialNumber: z.string().optional(),
  location: z.string().min(1).optional(),
  isGmpCritical: z.coerce.boolean().optional(),
  installDate: z.string().optional(),
});
export type UpdateEquipmentRequest = z.infer<typeof updateEquipmentRequestSchema>;

// EQP-1: the only way status changes — never a direct field write (CLAUDE.md transition maps).
export const transitionEquipmentStatusRequestSchema = z.object({
  status: z.nativeEnum(EquipmentStatus),
  reason: z.string().optional(),
});
export type TransitionEquipmentStatusRequest = z.infer<typeof transitionEquipmentStatusRequestSchema>;

// EQP-4: recurring calibration schedule (create or replace — one active schedule per equipment).
export const createCalibrationScheduleRequestSchema = z.object({
  frequencyMonths: z.coerce.number().int().min(1).max(120),
  parameters: z.string().min(1, 'parameters is required'),
  toleranceClass: z.string().min(1, 'toleranceClass is required'),
  agencyType: z.enum(['internal', 'external']),
  agencyName: z.string().optional(),
  nextDueDate: z.string().min(1, 'nextDueDate is required'),
});
export type CreateCalibrationScheduleRequest = z.infer<typeof createCalibrationScheduleRequestSchema>;

// EQP-4: recording a performed calibration (multipart — the certificate travels alongside these
// fields, so numeric/boolean fields arrive as strings and are coerced).
export const recordCalibrationResultRequestSchema = z
  .object({
    performedDate: z.string().min(1, 'performedDate is required'),
    result: z.nativeEnum(CalibrationResult),
    toleranceNotes: z.string().optional(),
    // EQP-5: mandatory impact-assessment note when the result is FAIL — enforced here AND
    // re-checked in the service as the last line of defense (DOC-8's change-summary pattern).
    impactAssessmentNote: z.string().optional(),
  })
  .refine((value) => value.result !== CalibrationResult.FAIL || Boolean(value.impactAssessmentNote?.trim()), {
    message: 'An impact-assessment note is required when a calibration fails (out-of-tolerance).',
    path: ['impactAssessmentNote'],
  });
export type RecordCalibrationResultRequest = z.infer<typeof recordCalibrationResultRequestSchema>;

// EQP-4: QA verification sign-off for a PASS result.
export const verifyCalibrationRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
});
export type VerifyCalibrationRequest = z.infer<typeof verifyCalibrationRequestSchema>;

// EQP-5: QA disposition sign-off for a FAIL/OOT result.
export const dispositionCalibrationRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
  outcome: z.nativeEnum(CalibrationDispositionOutcome),
  note: z.string().min(1, 'A disposition note is required.'),
  // Phase 2 placeholder — optional now, populated by a future Deviations module.
  deviationRef: z.string().optional(),
});
export type DispositionCalibrationRequest = z.infer<typeof dispositionCalibrationRequestSchema>;

// EQP-6: usage start/stop free-text product/batch ref (v1 — no Batch master yet).
export const logUsageStartRequestSchema = z.object({
  productBatchRef: z.string().min(1, 'productBatchRef is required'),
});
export type LogUsageStartRequest = z.infer<typeof logUsageStartRequestSchema>;

export const logUsageStopRequestSchema = z.object({
  productBatchRef: z.string().optional(),
});
export type LogUsageStopRequest = z.infer<typeof logUsageStopRequestSchema>;

export const logCleaningRequestSchema = z.object({
  cleaningType: z.nativeEnum(CleaningType),
});
export type LogCleaningRequest = z.infer<typeof logCleaningRequestSchema>;

// EQP-6: breakdown report — multipart (an optional photo travels alongside the description).
export const logBreakdownRequestSchema = z.object({
  description: z.string().min(1, 'description is required'),
});
export type LogBreakdownRequest = z.infer<typeof logBreakdownRequestSchema>;

// EQP-6: a correction — NEVER an edit. References the entry it corrects.
export const createLogbookAmendmentRequestSchema = z.object({
  amendsEntryId: z.string().min(1, 'amendsEntryId is required'),
  description: z.string().min(1, 'A correction note is required'),
});
export type CreateLogbookAmendmentRequest = z.infer<typeof createLogbookAmendmentRequestSchema>;

// EQP-7: engineer completion of a breakdown-triggered maintenance task.
export const closeMaintenanceTaskRequestSchema = z.object({
  completionNote: z.string().min(1, 'A completion note is required'),
});
export type CloseMaintenanceTaskRequest = z.infer<typeof closeMaintenanceTaskRequestSchema>;

// EQP-7: (configurable) QA/user verification sign-off after engineer completion.
export const verifyMaintenanceTaskRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
  note: z.string().optional(),
});
export type VerifyMaintenanceTaskRequest = z.infer<typeof verifyMaintenanceTaskRequestSchema>;

// EQP-8: recording a performed IQ/OQ/PQ/REQUALIFICATION event (multipart — protocol is
// mandatory, report optional at creation and attachable later via a separate endpoint).
export const createQualificationRecordRequestSchema = z.object({
  qualificationType: z.nativeEnum(QualificationType),
  performedDate: z.string().min(1, 'performedDate is required'),
  result: z.nativeEnum(QualificationResult),
  notes: z.string().optional(),
  // Only meaningful for PQ/REQUALIFICATION + PASS; ignored otherwise (checked in the service).
  requalificationFrequencyMonths: z.coerce.number().int().min(1).max(120).optional(),
});
export type CreateQualificationRecordRequest = z.infer<typeof createQualificationRecordRequestSchema>;

// EQP-8: attaching the formal report after the fact (multipart, file only — no other fields).
export const attachQualificationReportRequestSchema = z.object({});
export type AttachQualificationReportRequest = z.infer<typeof attachQualificationReportRequestSchema>;

// EQP-9: recurring PM plan (create or replace — one active plan per equipment).
export const upsertPmPlanRequestSchema = z.object({
  frequencyMonths: z.coerce.number().int().min(1).max(120),
  checklistText: z.string().min(1, 'checklistText is required'),
  nextDueDate: z.string().min(1, 'nextDueDate is required'),
});
export type UpsertPmPlanRequest = z.infer<typeof upsertPmPlanRequestSchema>;

// EQP-9: PM task completion — an e-signature (Iron Rule 4).
export const completePmTaskRequestSchema = z.object({
  signingToken: z.string().min(1, 'A signing token is required.'),
  completionNote: z.string().min(1, 'A completion note is required'),
});
export type CompletePmTaskRequest = z.infer<typeof completePmTaskRequestSchema>;

export const listEquipmentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(EquipmentStatus).optional(),
  departmentId: z.string().optional(),
  search: z.string().optional(),
});
export type ListEquipmentQuery = z.infer<typeof listEquipmentQuerySchema>;

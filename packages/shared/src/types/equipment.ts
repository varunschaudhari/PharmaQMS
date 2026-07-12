import type {
  CalibrationRecordStatus,
  CalibrationResult,
  CalibrationStatus,
  EquipmentStatus,
  PmTaskStatus,
  QualificationResult,
  QualificationStatus,
  QualificationType,
} from '../enums/equipment';
import type { CleaningType, LogbookEntryType, MaintenanceTaskStatus } from '../enums/logbook';

// EQP-1: equipment master (SPEC.md §7.3). `location` is free-text in v1 — a Room master
// (QRX-1) is v1.5/out of scope for these sessions, so there is no Room entity to reference yet.
export interface EquipmentData {
  id: string;
  tenantId: string;
  // PLT-5: e.g. EQP-0042 — assigned by the numbering service at creation, never inline.
  equipmentCode: string;
  name: string;
  make: string | null;
  modelName: string | null;
  serialNumber: string | null;
  location: string;
  departmentId: string;
  isGmpCritical: boolean;
  status: EquipmentStatus;
  installDate: string | null;
  qr: { code: string; scanUrl: string } | null;
  createdAt: string;
}

// EQP-4: the recurring calibration schedule — one active schedule per equipment.
export interface CalibrationScheduleData {
  id: string;
  tenantId: string;
  equipmentId: string;
  frequencyMonths: number;
  parameters: string;
  toleranceClass: string;
  agencyType: 'internal' | 'external';
  agencyName: string | null;
  nextDueDate: string;
}

// EQP-4/EQP-5: one performed calibration event — immutable except its QA sign-off fields, which
// are only ever set by the verify/disposition e-signature endpoints (never edited directly).
export interface CalibrationRecordData {
  id: string;
  tenantId: string;
  equipmentId: string;
  scheduleId: string;
  performedDate: string;
  result: CalibrationResult;
  certificateFileName: string;
  certificateContentType: string;
  toleranceNotes: string | null;
  // Mandatory when result is FAIL (EQP-5 OOT impact assessment).
  impactAssessmentNote: string | null;
  status: CalibrationRecordStatus;
  // Phase 2 placeholder (EQP-5): a future Deviations module will populate this; nullable now.
  deviationRef: string | null;
  recordedByUserId: string;
  createdAt: string;
}

// EQP-4: one row of the calibration-due dashboard (QA-facing list of DUE_SOON/OVERDUE
// equipment, independent of the per-tenant daily notification scan).
export interface CalibrationDueEntryData {
  equipmentId: string;
  equipmentCode: string;
  equipmentName: string;
  departmentId: string;
  calibrationStatus: CalibrationStatus;
  nextDueDate: string;
}

// EQP-6: one digital logbook entry — immutable (Iron Rule 3-adjacent: never edited). A
// correction is a NEW entry of type AMENDMENT referencing the entry it corrects via
// `amendsEntryId`; the client renders the original strike-through-style alongside it.
export interface LogbookEntryData {
  id: string;
  tenantId: string;
  equipmentId: string;
  entryType: LogbookEntryType;
  // USAGE_START/USAGE_STOP: free-text product/batch reference (v1 — no Batch master yet).
  productBatchRef: string | null;
  // CLEANING only.
  cleaningType: CleaningType | null;
  // BREAKDOWN description, or the AMENDMENT's correction note.
  description: string | null;
  photoFileName: string | null;
  photoContentType: string | null;
  // AMENDMENT only — the entry this one corrects (never edits).
  amendsEntryId: string | null;
  performedByUserId: string;
  performedByUserFullName: string;
  occurredAt: string;
}

// EQP-7: a maintenance task auto-created from a BREAKDOWN logbook entry.
export interface MaintenanceTaskData {
  id: string;
  tenantId: string;
  equipmentId: string;
  // Denormalized snapshot at creation (same pattern as TrainingAssignmentData's docNumber) so a
  // maintenance queue/dashboard needs no extra per-row equipment lookup.
  equipmentCode: string;
  equipmentName: string;
  sourceLogbookEntryId: string;
  status: MaintenanceTaskStatus;
  // The tenant's configured "maintenance role" (Tenant.settings.maintenanceRoleId) at the time
  // this task was created — null if the tenant has not configured one yet.
  assignedRoleId: string | null;
  engineerCompletionNote: string | null;
  completedByUserId: string | null;
  completedAt: string | null;
  // Snapshot of the tenant setting at creation time, so a later setting change never silently
  // reinterprets an in-flight task's requirement.
  verificationRequired: boolean;
  verifiedByUserId: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  createdAt: string;
}

// EQP-8: one IQ/OQ/PQ/REQUALIFICATION event. Protocol upload is mandatory at creation; the
// formal report commonly follows later, so it may be attached afterward via a separate endpoint.
export interface QualificationRecordData {
  id: string;
  tenantId: string;
  equipmentId: string;
  qualificationType: QualificationType;
  performedDate: string;
  result: QualificationResult;
  protocolFileName: string;
  protocolContentType: string;
  reportFileName: string | null;
  reportContentType: string | null;
  notes: string | null;
  // Only meaningful on a PASSed PQ/REQUALIFICATION — the cadence for the NEXT requalification.
  // Null means "no requalification required" (a one-time qualification, e.g. most IQ/OQ events).
  requalificationFrequencyMonths: number | null;
  recordedByUserId: string;
  createdAt: string;
}

// EQP-9: the recurring PM schedule — one active plan per equipment (mirrors EQP-4's
// CalibrationScheduleData shape).
export interface PmPlanData {
  id: string;
  tenantId: string;
  equipmentId: string;
  frequencyMonths: number;
  checklistText: string;
  nextDueDate: string;
}

// EQP-9: one auto-generated (by the daily due-date scanner) or completed PM task.
export interface PmTaskData {
  id: string;
  tenantId: string;
  equipmentId: string;
  // Denormalized snapshot at creation (same pattern as MaintenanceTaskData) so the PM queue
  // dashboard needs no extra per-row equipment lookup.
  equipmentCode: string;
  equipmentName: string;
  planId: string;
  status: PmTaskStatus;
  dueDate: string;
  completionNote: string | null;
  completedByUserId: string | null;
  completedAt: string | null;
  createdAt: string;
}

// EQP-3: the scan-to-status-card view (SPEC.md §7.3). Calibration (EQP-4), logbook (EQP-6),
// qualification (EQP-8), and PM (EQP-9) all now feed real data.
export interface EquipmentStatusCardData {
  id: string;
  equipmentCode: string;
  name: string;
  location: string;
  departmentId: string;
  isGmpCritical: boolean;
  status: EquipmentStatus;
  calibrationStatus: CalibrationStatus;
  calibrationNextDueDate: string | null;
  // EQP-4: tenant-configurable — true when overdue calibration should block usage logging.
  // EQP-6 is the actual enforcement point (LogbookService rejects usage_start when true).
  calibrationBlocksUsage: boolean;
  qualificationStatus: QualificationStatus;
  qualificationNextDueDate: string | null;
  pmStatus: CalibrationStatus;
  pmDueDate: string | null;
  recentLogbookEntries: LogbookEntryData[];
  // EQP-3 "action buttons per user role" — real handlers as of EQP-4 (calibration)/EQP-6
  // (logbook)/EQP-8 (qualification)/EQP-9 (PM).
  availableActions: string[];
}

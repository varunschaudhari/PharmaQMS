// EQP-1: equipment lifecycle status (SPEC.md §7.3).
export enum EquipmentStatus {
  ACTIVE = 'active',
  UNDER_MAINTENANCE = 'under_maintenance',
  UNDER_QUALIFICATION = 'under_qualification',
  // EQP-5: forced by an out-of-tolerance calibration result — never a manual admin choice via
  // the generic status-transition endpoint. Only a QA disposition e-signature can release it.
  DO_NOT_USE = 'do_not_use',
  // Terminal (Iron Rule 3 — no un-retiring; a genuinely returned-to-service instrument gets a
  // new equipment record, same principle as "no hard delete").
  RETIRED = 'retired',
}

// EQP-4: a calibration result. FAIL = out-of-tolerance (OOT), triggering EQP-5 handling.
export enum CalibrationResult {
  PASS = 'pass',
  FAIL = 'fail',
}

// EQP-4/EQP-5: a calibration record's QA-sign-off lifecycle.
export enum CalibrationRecordStatus {
  PENDING_QA_VERIFICATION = 'pending_qa_verification',
  // PASS records: QA has e-signed "Verified by" and the schedule's next due date advanced.
  VERIFIED = 'verified',
  // FAIL/OOT records: QA has e-signed a disposition (release or retain Do Not Use).
  DISPOSITIONED = 'dispositioned',
}

// EQP-5: QA's decision when dispositioning an OOT calibration.
export enum CalibrationDispositionOutcome {
  RELEASE = 'release',
  RETAIN_DO_NOT_USE = 'retain_do_not_use',
}

// EQP-3/EQP-4: the status card's calibration indicator. NOT_SCHEDULED is the only value
// possible until EQP-4 (calibration schedules) exists — the derivation function and this enum
// are built now so EQP-4 only has to start feeding it real due dates.
export enum CalibrationStatus {
  NOT_SCHEDULED = 'not_scheduled',
  VALID = 'valid',
  DUE_SOON = 'due_soon',
  OVERDUE = 'overdue',
}

// EQP-8: an IQ/OQ/PQ qualification event, or a later REQUALIFICATION.
export enum QualificationType {
  IQ = 'iq',
  OQ = 'oq',
  PQ = 'pq',
  REQUALIFICATION = 'requalification',
}

export enum QualificationResult {
  PASS = 'pass',
  FAIL = 'fail',
}

// EQP-8/EQP-3: the status card's qualification indicator — mirrors CalibrationStatus's shape.
// NOT_QUALIFIED until a PQ (or later REQUALIFICATION) record passes; QUALIFIED thereafter unless
// a requalification frequency was set, in which case DUE_SOON/OVERDUE apply exactly like EQP-4.
export enum QualificationStatus {
  NOT_QUALIFIED = 'not_qualified',
  QUALIFIED = 'qualified',
  DUE_SOON = 'due_soon',
  OVERDUE = 'overdue',
}

// EQP-9: a preventive-maintenance task's lifecycle — auto-generated OPEN by the daily due-date
// scanner, COMPLETED with an e-sign (Iron Rule 4).
export enum PmTaskStatus {
  OPEN = 'open',
  COMPLETED = 'completed',
}

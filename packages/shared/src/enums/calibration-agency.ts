// EQP-11 (SPEC.md §7.3): an external calibration agency's own status — distinct from any
// equipment/schedule status. Suspended is reversible (unlike Room/Equipment's terminal Retired) —
// an agency can be reinstated once its accreditation issue is resolved, so both directions are
// permitted in the transition map.
export enum CalibrationAgencyStatus {
  ACTIVE = 'active',
  SUSPENDED = 'suspended',
}

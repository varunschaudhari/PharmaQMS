// DOC-1: controlled document types (SPEC.md §7.1).
export enum DocumentType {
  SOP = 'sop',
  SPECIFICATION = 'specification',
  PROTOCOL = 'protocol',
  FORMAT = 'format',
  POLICY = 'policy',
}

// DOC-2/DOC-7: the lifecycle state of one document VERSION. SPEC §7.1's "Under Revision" is a
// DOCUMENT-level derived status (an Effective version coexists with a newer in-progress one),
// not a version state — see DocumentStatus below.
export enum DocumentVersionState {
  DRAFT = 'draft',
  UNDER_REVIEW = 'under_review',
  UNDER_APPROVAL = 'under_approval',
  EFFECTIVE = 'effective',
  // DOC-2: auto-set on the prior Effective version when a new one becomes Effective; retained
  // read-only forever.
  SUPERSEDED = 'superseded',
  // DOC-7: e-signed obsolescence; excluded from user-facing search, retained and auditable.
  OBSOLETE = 'obsolete',
  // Iron Rule 3: the only exit for never-submitted drafts (no hard delete).
  CANCELLED = 'cancelled',
}

// Derived, document-level status shown in lists (SPEC §7.1 lifecycle line).
export enum DocumentStatus {
  DRAFT = 'draft',
  UNDER_REVIEW = 'under_review',
  UNDER_APPROVAL = 'under_approval',
  EFFECTIVE = 'effective',
  UNDER_REVISION = 'under_revision',
  OBSOLETE = 'obsolete',
}

import type { DocumentStatus, DocumentType, DocumentVersionState } from '../enums/document';

// DOC-1/DOC-2: one uploaded, immutable file per version — a new file means a new version.
export interface DocumentVersionData {
  id: string;
  tenantId: string;
  documentId: string;
  majorVersion: number;
  minorVersion: number;
  // e.g. "3.0" — always derived, never stored separately.
  versionLabel: string;
  state: DocumentVersionState;
  // DOC-8: mandatory on every version after the first ("what changed and why").
  changeSummary: string | null;
  fileName: string;
  fileContentType: string;
  fileSize: number;
  effectiveDate: string | null;
  createdByUserId: string;
  createdAt: string;
}

export interface DocumentData {
  id: string;
  tenantId: string;
  // PLT-5: e.g. SOP-QA-001 — scheme per document type.
  docNumber: string;
  title: string;
  docType: DocumentType;
  departmentId: string;
  reviewFrequencyMonths: number;
  authorId: string;
  // DOC-9: which roles/departments must be trained on this document (TRN-1's mapping source).
  distributionRoleIds: string[];
  distributionDepartmentIds: string[];
  // Derived from version states — see DocumentStatus in enums/document.ts.
  status: DocumentStatus;
  effectiveVersion: DocumentVersionData | null;
  latestVersion: DocumentVersionData;
  // DOC-6: next periodic review due date (effective/reaffirm date + review frequency).
  nextReviewDate: string | null;
  createdAt: string;
}

export function formatVersionLabel(majorVersion: number, minorVersion: number): string {
  return `${majorVersion}.${minorVersion}`;
}

// DOC-5: the public QR version check — deliberately no PII and no content, just enough to stamp
// a printed copy CURRENT or OBSOLETE. Login is required only to open the document itself.
export interface DocVersionCheckData {
  status: 'current' | 'obsolete';
  docNumber: string;
  scannedVersion: string;
  scannedEffectiveDate: string | null;
  // Set when status is 'obsolete' and a newer Effective version exists.
  currentVersion: string | null;
  // Opaque id for the "log in to open the document" deep link.
  documentId: string;
}

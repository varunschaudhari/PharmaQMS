import { DocumentVersionState } from './enums/document';

// DOC-2/DOC-3/DOC-7 lifecycle (SPEC.md §7.1), as an explicit transition map per CLAUDE.md —
// status fields are never set directly; an invalid transition throws.
export const DOCUMENT_VERSION_TRANSITIONS: Record<DocumentVersionState, readonly DocumentVersionState[]> = {
  [DocumentVersionState.DRAFT]: [DocumentVersionState.UNDER_REVIEW, DocumentVersionState.CANCELLED],
  // Reject at the review step returns to the author.
  [DocumentVersionState.UNDER_REVIEW]: [DocumentVersionState.UNDER_APPROVAL, DocumentVersionState.DRAFT],
  // Approve makes it Effective; reject returns to Draft or back to an earlier review step.
  [DocumentVersionState.UNDER_APPROVAL]: [
    DocumentVersionState.EFFECTIVE,
    DocumentVersionState.UNDER_REVIEW,
    DocumentVersionState.DRAFT,
  ],
  // DOC-2 auto-supersede; DOC-7 e-signed obsolescence.
  [DocumentVersionState.EFFECTIVE]: [DocumentVersionState.SUPERSEDED, DocumentVersionState.OBSOLETE],
  // Terminal: retained read-only (Iron Rule 3 — no deletes, ever).
  [DocumentVersionState.SUPERSEDED]: [],
  [DocumentVersionState.OBSOLETE]: [],
  [DocumentVersionState.CANCELLED]: [],
};

export function isDocumentVersionTransitionAllowed(
  from: DocumentVersionState,
  to: DocumentVersionState,
): boolean {
  return DOCUMENT_VERSION_TRANSITIONS[from].includes(to);
}

export function assertDocumentVersionTransition(from: DocumentVersionState, to: DocumentVersionState): void {
  if (!isDocumentVersionTransitionAllowed(from, to)) {
    throw new Error(`Invalid document version transition: ${from} -> ${to}`);
  }
}

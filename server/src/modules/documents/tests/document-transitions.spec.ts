import {
  DOCUMENT_VERSION_TRANSITIONS,
  DocumentVersionState,
  assertDocumentVersionTransition,
  isDocumentVersionTransitionAllowed,
} from '@pharmaqms/shared';

describe('DOC-2 document version transition map', () => {
  it('DOC-2: the happy path Draft → Under Review → Under Approval → Effective is allowed', () => {
    expect(() => {
      assertDocumentVersionTransition(DocumentVersionState.DRAFT, DocumentVersionState.UNDER_REVIEW);
      assertDocumentVersionTransition(DocumentVersionState.UNDER_REVIEW, DocumentVersionState.UNDER_APPROVAL);
      assertDocumentVersionTransition(DocumentVersionState.UNDER_APPROVAL, DocumentVersionState.EFFECTIVE);
    }).not.toThrow();
  });

  it('DOC-3: rejections travel backwards — approval → review/draft, review → draft', () => {
    expect(isDocumentVersionTransitionAllowed(DocumentVersionState.UNDER_APPROVAL, DocumentVersionState.UNDER_REVIEW)).toBe(true);
    expect(isDocumentVersionTransitionAllowed(DocumentVersionState.UNDER_APPROVAL, DocumentVersionState.DRAFT)).toBe(true);
    expect(isDocumentVersionTransitionAllowed(DocumentVersionState.UNDER_REVIEW, DocumentVersionState.DRAFT)).toBe(true);
  });

  it('DOC-2/DOC-7: Effective can only become Superseded or Obsolete', () => {
    expect(DOCUMENT_VERSION_TRANSITIONS[DocumentVersionState.EFFECTIVE]).toEqual([
      DocumentVersionState.SUPERSEDED,
      DocumentVersionState.OBSOLETE,
    ]);
  });

  it('DOC-2: terminal states (Superseded/Obsolete/Cancelled) allow NO transitions — retained read-only forever', () => {
    for (const terminal of [DocumentVersionState.SUPERSEDED, DocumentVersionState.OBSOLETE, DocumentVersionState.CANCELLED]) {
      expect(DOCUMENT_VERSION_TRANSITIONS[terminal]).toEqual([]);
      for (const target of Object.values(DocumentVersionState)) {
        expect(() => assertDocumentVersionTransition(terminal, target)).toThrow(/Invalid document version transition/);
      }
    }
  });

  it('DOC-2: a draft can never jump straight to Effective — every version passes through review and approval', () => {
    expect(isDocumentVersionTransitionAllowed(DocumentVersionState.DRAFT, DocumentVersionState.EFFECTIVE)).toBe(false);
    expect(isDocumentVersionTransitionAllowed(DocumentVersionState.UNDER_REVIEW, DocumentVersionState.EFFECTIVE)).toBe(false);
  });
});

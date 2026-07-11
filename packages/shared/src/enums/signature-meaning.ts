// PLT-3: the "meaning" of an e-signature (SPEC.md §5.2) — always shown alongside the signer's
// name and timestamp in the signature manifest.
export enum SignatureMeaning {
  REVIEWED_BY = 'reviewed_by',
  APPROVED_BY = 'approved_by',
  TRAINED_READ_AND_UNDERSTOOD = 'trained_read_and_understood',
  VERIFIED_BY = 'verified_by',
  QA_DISPOSITION = 'qa_disposition',
}

export const SIGNATURE_MEANING_LABELS: Record<SignatureMeaning, string> = {
  [SignatureMeaning.REVIEWED_BY]: 'Reviewed by',
  [SignatureMeaning.APPROVED_BY]: 'Approved by',
  [SignatureMeaning.TRAINED_READ_AND_UNDERSTOOD]: 'Trained — read and understood',
  [SignatureMeaning.VERIFIED_BY]: 'Verified by',
  [SignatureMeaning.QA_DISPOSITION]: 'QA Disposition',
};

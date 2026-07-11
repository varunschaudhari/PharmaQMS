import { SIGNATURE_MEANING_LABELS, type SignatureData } from '@pharmaqms/shared';

export interface SignatureManifestProps {
  signatures: SignatureData[];
}

// PLT-3: signed records display the signature manifest — name, meaning, timestamp — on screen
// and on printed/PDF output (SPEC.md §5.2). Pure/prop-driven so it can be reused in both places.
export function SignatureManifest({ signatures }: SignatureManifestProps) {
  if (signatures.length === 0) {
    return <p className="text-sm text-slate-500">No signatures yet.</p>;
  }

  return (
    <ul className="space-y-2 text-sm">
      {signatures.map((signature) => (
        <li key={signature.id} className="rounded border border-slate-200 p-2">
          <span className="font-medium">{signature.userFullName}</span> —{' '}
          {SIGNATURE_MEANING_LABELS[signature.meaning]}
          <span className="block text-xs text-slate-500">{new Date(signature.signedAt).toLocaleString()}</span>
          {signature.reason && <span className="block text-xs text-slate-500">Reason: {signature.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

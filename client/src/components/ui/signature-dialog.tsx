import { SIGNATURE_MEANING_LABELS, type SignatureMeaning } from '@pharmaqms/shared';
import { useState, type FormEvent } from 'react';
import { extractErrorMessage } from '../../lib/api-error';
import { challengeSignature } from '../../lib/esign-api';

export interface SignatureDialogProps {
  meaning: SignatureMeaning;
  // The dialog only gets a fresh signingToken (PLT-3's challenge) and hands it to the caller —
  // it does not itself decide what gets signed. A plain e-sign caller wires this to
  // createSignature(); PLT-4's approve action wires it to POST /workflow/instances/:id/act
  // instead, since a workflow step's signature must be created as part of advancing the step.
  onSign: (signingToken: string) => Promise<void>;
  onCancel: () => void;
}

// PLT-3 / Iron Rule 4: always re-challenges for a fresh credential — a valid session is never
// enough to sign. Shared across every regulated entity's approve/review/train/verify action.
export function SignatureDialog({ meaning, onSign, onCancel }: SignatureDialogProps) {
  const [credential, setCredential] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const { signingToken } = await challengeSignature(credential);
      await onSign(signingToken);
    } catch (err) {
      setError(extractErrorMessage(err) ?? 'Signing failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 flex items-center justify-center bg-black/40">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow-lg">
        <h2 className="text-base font-semibold text-slate-900">{SIGNATURE_MEANING_LABELS[meaning]}</h2>
        <p className="text-sm text-slate-600">Re-enter your password to sign. A valid session alone is not enough.</p>

        <div>
          <label htmlFor="signature-credential" className="block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="signature-credential"
            type="password"
            required
            autoFocus
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            className="rounded border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting || !credential}
            className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isSubmitting ? 'Signing…' : 'Sign'}
          </button>
        </div>
      </form>
    </div>
  );
}

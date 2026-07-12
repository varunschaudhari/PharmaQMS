import { SignatureMeaning } from '@pharmaqms/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SignatureDialog } from '../../../components/ui/signature-dialog';
import { extractErrorMessage } from '../../../lib/api-error';
import { fetchReviewDue, reaffirmDocument } from '../../../lib/documents-api';

// DOC-6: QA dashboard widget — documents past (or approaching) their periodic review, with the
// two outcomes: reaffirm (e-signed, minor version) or revise (starts a new version draft).
export function ReviewDuePage() {
  const queryClient = useQueryClient();
  const { data: documents, isLoading } = useQuery({ queryKey: ['review-due'], queryFn: fetchReviewDue });

  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [signingDocumentId, setSigningDocumentId] = useState<string | null>(null);

  async function handleReaffirmSign(signingToken: string): Promise<void> {
    if (!signingDocumentId) return;
    try {
      await reaffirmDocument(signingDocumentId, { signingToken, note: notes[signingDocumentId] ?? '' });
      setSigningDocumentId(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['review-due'] });
    } catch (err) {
      setSigningDocumentId(null);
      setError(extractErrorMessage(err) ?? 'Failed to reaffirm.');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Periodic review due</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (documents ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No documents due for review.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Number</th>
              <th className="py-1 pr-4 font-medium">Title</th>
              <th className="py-1 pr-4 font-medium">Review due</th>
              <th className="py-1 pr-4 font-medium">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {(documents ?? []).map((document) => {
              const overdue = document.nextReviewDate ? new Date(document.nextReviewDate) <= new Date() : false;
              const note = notes[document.id] ?? '';
              return (
                <tr key={document.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium">
                    <Link to={`/documents/${document.id}`} className="underline">
                      {document.docNumber}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{document.title}</td>
                  <td className={`py-2 pr-4 ${overdue ? 'font-semibold text-red-600' : ''}`}>
                    {document.nextReviewDate?.slice(0, 10)}
                    {overdue ? ' (overdue)' : ''}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`Review note for ${document.docNumber}`}
                        placeholder="Review note…"
                        value={note}
                        onChange={(event) => setNotes((current) => ({ ...current, [document.id]: event.target.value }))}
                        className="w-44 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        disabled={!note.trim()}
                        onClick={() => setSigningDocumentId(document.id)}
                        className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Reaffirm…
                      </button>
                      <Link to={`/documents/${document.id}/new-version`} className="text-xs underline">
                        Revise
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {signingDocumentId && (
        <SignatureDialog
          meaning={SignatureMeaning.REVIEWED_BY}
          onSign={handleReaffirmSign}
          onCancel={() => setSigningDocumentId(null)}
        />
      )}
    </div>
  );
}

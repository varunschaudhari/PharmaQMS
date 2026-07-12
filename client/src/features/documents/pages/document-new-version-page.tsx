import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { extractErrorMessage } from '../../../lib/api-error';
import { createDocumentVersion, fetchDocument } from '../../../lib/documents-api';

// DOC-2/DOC-8: draft a new version (also DOC-6's "revise" review outcome). The change summary
// is mandatory — it becomes the version_created audit reason and shows in version history.
export function DocumentNewVersionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: document } = useQuery({
    queryKey: ['document', id],
    queryFn: () => fetchDocument(id as string),
    enabled: Boolean(id),
  });

  const [bump, setBump] = useState<'major' | 'minor'>('major');
  const [changeSummary, setChangeSummary] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createDocumentVersion(id as string, { bump, changeSummary, file: file as File }),
    onSuccess: () => navigate(`/documents/${id}`),
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create version.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!file) {
      setError('A PDF or DOCX file is required.');
      return;
    }
    createMutation.mutate();
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">
        New version{document ? ` — ${document.docNumber}` : ''}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Version bump</legend>
          <label className="mr-4 mt-1 inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={bump === 'major'} onChange={() => setBump('major')} />
            Major (content change)
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked={bump === 'minor'} onChange={() => setBump('minor')} />
            Minor (editorial)
          </label>
        </fieldset>
        <div>
          <label htmlFor="version-change-summary" className="block text-sm font-medium text-slate-700">
            Change summary — what changed and why (required)
          </label>
          <textarea
            id="version-change-summary"
            required
            rows={3}
            value={changeSummary}
            onChange={(event) => setChangeSummary(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="version-file" className="block text-sm font-medium text-slate-700">
            File (PDF or DOCX)
          </label>
          <input
            id="version-file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending || !changeSummary.trim()}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create draft version
        </button>
      </form>
    </div>
  );
}

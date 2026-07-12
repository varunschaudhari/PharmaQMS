import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { extractErrorMessage } from '../../../lib/api-error';
import { createTestRecord, fetchTestRecords } from '../../../lib/test-record-api';

// Phase 0 gate demo UI (SPEC.md §8) — throwaway alongside server/src/demo.
export function TestRecordsPage() {
  const queryClient = useQueryClient();
  const { data: records, isLoading } = useQuery({ queryKey: ['test-records'], queryFn: fetchTestRecords });

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createTestRecord({ title, description }),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['test-records'] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create record.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Test records (Phase 0 demo)</h1>

      <form onSubmit={handleSubmit} className="space-y-3 rounded border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="tr-title" className="block text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="tr-title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="tr-description" className="block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            id="tr-description"
            required
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Create record
        </button>
      </form>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Number</th>
              <th className="py-1 pr-4 font-medium">Title</th>
              <th className="py-1 pr-4 font-medium">Approval status</th>
              <th className="py-1 pr-4 font-medium" />
            </tr>
          </thead>
          <tbody>
            {(records ?? []).map((record) => (
              <tr key={record.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium">{record.recordNumber}</td>
                <td className="py-2 pr-4">{record.title}</td>
                <td className="py-2 pr-4">{record.workflow?.status ?? 'not submitted'}</td>
                <td className="py-2 pr-4">
                  <Link to={`/test-records/${record.id}`} className="text-slate-600 underline">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

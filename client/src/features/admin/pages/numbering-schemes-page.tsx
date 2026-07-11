import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { extractErrorMessage } from '../../../lib/api-error';
import { createNumberingScheme, fetchNumberingSchemes, previewNumber } from '../../../lib/admin-api';

export function NumberingSchemesPage() {
  const queryClient = useQueryClient();
  const { data: schemes, isLoading } = useQuery({ queryKey: ['numbering-schemes'], queryFn: fetchNumberingSchemes });

  const [entityType, setEntityType] = useState('');
  const [prefix, setPrefix] = useState('');
  const [useDepartmentToken, setUseDepartmentToken] = useState(false);
  const [paddingWidth, setPaddingWidth] = useState(3);
  const [yearlyReset, setYearlyReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createNumberingScheme,
    onSuccess: () => {
      setEntityType('');
      setPrefix('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['numbering-schemes'] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create numbering scheme.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate({ entityType, prefix, useDepartmentToken, paddingWidth, yearlyReset });
  }

  async function handlePreview(scheme: { entityType: string; useDepartmentToken: boolean }): Promise<void> {
    setPreview(null);
    try {
      const code = await previewNumber(scheme.entityType, scheme.useDepartmentToken ? 'QA' : undefined);
      setPreview(code);
    } catch (err) {
      setError(extractErrorMessage(err) ?? 'Failed to generate a preview number.');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Numbering schemes</h1>
      <p className="text-sm text-slate-600">
        Formats as prefix[-department][-year]-number, e.g. SOP-QA-001, EQP-0042, TRN-2026-0113.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded border border-slate-200 p-4">
        <div>
          <label htmlFor="scheme-entity-type" className="block text-xs font-medium text-slate-700">
            Entity type
          </label>
          <input
            id="scheme-entity-type"
            required
            placeholder="SOP"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm uppercase"
          />
        </div>
        <div>
          <label htmlFor="scheme-prefix" className="block text-xs font-medium text-slate-700">
            Prefix
          </label>
          <input
            id="scheme-prefix"
            required
            placeholder="SOP"
            value={prefix}
            onChange={(event) => setPrefix(event.target.value)}
            className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm uppercase"
          />
        </div>
        <div>
          <label htmlFor="scheme-padding" className="block text-xs font-medium text-slate-700">
            Padding width
          </label>
          <input
            id="scheme-padding"
            type="number"
            min={1}
            max={10}
            value={paddingWidth}
            onChange={(event) => setPaddingWidth(Number(event.target.value))}
            className="mt-1 w-20 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={useDepartmentToken}
            onChange={(event) => setUseDepartmentToken(event.target.checked)}
          />
          Department token
        </label>
        <label className="flex items-center gap-1 text-sm text-slate-600">
          <input type="checkbox" checked={yearlyReset} onChange={(event) => setYearlyReset(event.target.checked)} />
          Yearly reset
        </label>
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          Add scheme
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {preview && <p className="text-sm text-slate-700">Preview: {preview}</p>}

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Entity type</th>
              <th className="py-1 pr-4 font-medium">Prefix</th>
              <th className="py-1 pr-4 font-medium">Department token</th>
              <th className="py-1 pr-4 font-medium">Yearly reset</th>
              <th className="py-1 pr-4 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {(schemes ?? []).map((scheme) => (
              <tr key={scheme.id} className="border-b border-slate-100">
                <td className="py-2 pr-4">{scheme.entityType}</td>
                <td className="py-2 pr-4">{scheme.prefix}</td>
                <td className="py-2 pr-4">{scheme.useDepartmentToken ? 'Yes' : 'No'}</td>
                <td className="py-2 pr-4">{scheme.yearlyReset ? 'Yes' : 'No'}</td>
                <td className="py-2 pr-4">
                  <button type="button" onClick={() => handlePreview(scheme)} className="text-slate-600 underline">
                    Preview next
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

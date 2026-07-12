import { DocumentType } from '@pharmaqms/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDepartments } from '../../../lib/admin-api';
import { extractErrorMessage } from '../../../lib/api-error';
import { createDocument } from '../../../lib/documents-api';

// DOC-1: new controlled document — metadata + the version 1.0 file.
export function DocumentCreatePage() {
  const navigate = useNavigate();
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });

  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocumentType>(DocumentType.SOP);
  const [departmentId, setDepartmentId] = useState('');
  const [reviewFrequencyMonths, setReviewFrequencyMonths] = useState(12);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createDocument({ title, docType, departmentId, reviewFrequencyMonths, file: file as File }),
    onSuccess: (document) => navigate(`/documents/${document.id}`),
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create document.'),
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
      <h1 className="text-lg font-semibold text-slate-900">New document</h1>
      <form onSubmit={handleSubmit} className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="doc-title" className="block text-sm font-medium text-slate-700">
            Title
          </label>
          <input
            id="doc-title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="doc-type" className="block text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="doc-type"
            value={docType}
            onChange={(event) => setDocType(event.target.value as DocumentType)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value={DocumentType.SOP}>SOP</option>
            <option value={DocumentType.SPECIFICATION}>Specification</option>
            <option value={DocumentType.PROTOCOL}>Protocol</option>
            <option value={DocumentType.FORMAT}>Format</option>
            <option value={DocumentType.POLICY}>Policy</option>
          </select>
        </div>
        <div>
          <label htmlFor="doc-department" className="block text-sm font-medium text-slate-700">
            Department
          </label>
          <select
            id="doc-department"
            required
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Select department…</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name} ({department.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="doc-review-frequency" className="block text-sm font-medium text-slate-700">
            Review frequency (months)
          </label>
          <input
            id="doc-review-frequency"
            type="number"
            min={1}
            max={120}
            required
            value={reviewFrequencyMonths}
            onChange={(event) => setReviewFrequencyMonths(Number(event.target.value))}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="doc-file" className="block text-sm font-medium text-slate-700">
            File (PDF or DOCX)
          </label>
          <input
            id="doc-file"
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="mt-1 w-full text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create document
        </button>
      </form>
    </div>
  );
}

import type { DocumentType } from '@pharmaqms/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportAuditButton } from '../../../components/ui/export-audit-button';
import { fetchDocuments } from '../../../lib/documents-api';

const DOC_TYPE_LABELS: Record<string, string> = {
  sop: 'SOP',
  specification: 'Specification',
  protocol: 'Protocol',
  format: 'Format',
  policy: 'Policy',
};

const STATUS_STYLES: Record<string, string> = {
  effective: 'bg-emerald-100 text-emerald-700',
  under_revision: 'bg-amber-100 text-amber-700',
  under_review: 'bg-sky-100 text-sky-700',
  under_approval: 'bg-sky-100 text-sky-700',
  draft: 'bg-slate-200 text-slate-600',
  obsolete: 'bg-red-100 text-red-700',
};

// DOC-1/DOC-7: document register with filters; obsolete documents excluded unless requested.
export function DocumentsPage() {
  const [search, setSearch] = useState('');
  const [docType, setDocType] = useState<DocumentType | ''>('');
  const [includeObsolete, setIncludeObsolete] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', search, docType, includeObsolete],
    queryFn: () =>
      fetchDocuments({
        search: search || undefined,
        docType: docType || undefined,
        includeObsolete,
        limit: 50,
      }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Documents</h1>
        <div className="flex items-center gap-3">
          <ExportAuditButton entityType="Document" label="Export audit history (CSV)" />
          <Link to="/documents/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            New document
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Search documents"
          placeholder="Search number or title…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Filter by type"
          value={docType}
          onChange={(event) => setDocType(event.target.value as DocumentType | '')}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All types</option>
          {Object.entries(DOC_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={includeObsolete}
            onChange={(event) => setIncludeObsolete(event.target.checked)}
          />
          Include obsolete
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Number</th>
              <th className="py-1 pr-4 font-medium">Title</th>
              <th className="py-1 pr-4 font-medium">Type</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Effective</th>
              <th className="py-1 pr-4 font-medium">Next review</th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map((document) => (
              <tr key={document.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium">
                  <Link to={`/documents/${document.id}`} className="underline">
                    {document.docNumber}
                  </Link>
                </td>
                <td className="py-2 pr-4">{document.title}</td>
                <td className="py-2 pr-4">{DOC_TYPE_LABELS[document.docType]}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[document.status] ?? ''}`}>
                    {document.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="py-2 pr-4">{document.effectiveVersion?.versionLabel ?? '—'}</td>
                <td className="py-2 pr-4">{document.nextReviewDate ? document.nextReviewDate.slice(0, 10) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

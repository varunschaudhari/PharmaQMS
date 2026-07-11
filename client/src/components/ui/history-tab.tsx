import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { fetchAuditHistory } from '../../lib/audit-api';

export interface HistoryTabProps {
  entityType: string;
  entityId: string;
  pageSize?: number;
}

// PLT-2: shared audit-trail viewer — every regulated entity's detail page mounts this with its
// own entityType/entityId (CLAUDE.md: "every regulated entity detail page includes HistoryTab").
export function HistoryTab({ entityType, entityId, pageSize = 20 }: HistoryTabProps) {
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-history', entityType, entityId, page, pageSize],
    queryFn: () => fetchAuditHistory(entityType, entityId, page, pageSize),
  });

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading history…</p>;
  }
  if (isError) {
    return <p className="text-sm text-red-600">Failed to load history.</p>;
  }

  const events = data?.data ?? [];
  const total = data?.meta.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-900">History</h2>

      {events.length === 0 ? (
        <p className="text-sm text-slate-500">No history yet.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">When</th>
              <th className="py-1 pr-4 font-medium">Who</th>
              <th className="py-1 pr-4 font-medium">Action</th>
              <th className="py-1 pr-4 font-medium">Changes</th>
              <th className="py-1 pr-4 font-medium">Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-slate-100 align-top">
                <td className="whitespace-nowrap py-2 pr-4">{new Date(event.occurredAt).toLocaleString()}</td>
                <td className="py-2 pr-4">{event.actorName ?? '—'}</td>
                <td className="py-2 pr-4">{event.action}</td>
                <td className="py-2 pr-4">
                  {event.changes.length === 0 ? (
                    '—'
                  ) : (
                    <ul>
                      {event.changes.map((change) => (
                        <li key={change.field}>
                          <span className="font-medium">{change.field}</span>: {String(change.oldValue)} →{' '}
                          {String(change.newValue)}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="py-2 pr-4">{event.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {totalPages > 1 && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => current + 1)}
            className="rounded border border-slate-300 px-2 py-1 disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

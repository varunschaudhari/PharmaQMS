import type { MaterialLotStatus } from '@pharmaqms/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportAuditButton } from '../../../components/ui/export-audit-button';
import { fetchMaterialLotList } from '../../../lib/material-lot-api';

const STATUS_LABELS: Record<string, string> = {
  quarantine: 'Quarantine',
  under_test: 'Under Test',
  approved: 'Approved',
  rejected: 'Rejected',
};

const STATUS_STYLES: Record<string, string> = {
  quarantine: 'bg-amber-100 text-amber-700',
  under_test: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

// QRX-2: material lot register (SPEC.md §7.4) — status verification only, no quantities.
export function MaterialLotsListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<MaterialLotStatus | ''>('');

  const { data, isLoading } = useQuery({
    queryKey: ['material-lots', search, status],
    queryFn: () => fetchMaterialLotList({ search: search || undefined, status: status || undefined, limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Material Lots</h1>
        <div className="flex items-center gap-3">
          <ExportAuditButton entityType="MaterialLot" label="Export audit history (CSV)" />
          <Link to="/materials/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            New lot
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Search material lots"
          placeholder="Search lot code or material…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value as MaterialLotStatus | '')}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Lot code</th>
              <th className="py-1 pr-4 font-medium">Material</th>
              <th className="py-1 pr-4 font-medium">Manufacturer</th>
              <th className="py-1 pr-4 font-medium">Received</th>
              <th className="py-1 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map((lot) => (
              <tr key={lot.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium">
                  <Link to={`/materials/${lot.id}`} className="underline">
                    {lot.lotCode}
                  </Link>
                </td>
                <td className="py-2 pr-4">{lot.materialName}</td>
                <td className="py-2 pr-4">{lot.manufacturer ?? '—'}</td>
                <td className="py-2 pr-4">{lot.receivedDate.slice(0, 10)}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[lot.status]}`}>
                    {STATUS_LABELS[lot.status]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

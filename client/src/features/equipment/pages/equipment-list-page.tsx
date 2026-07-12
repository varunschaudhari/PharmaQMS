import type { EquipmentStatus } from '@pharmaqms/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportAuditButton } from '../../../components/ui/export-audit-button';
import { fetchEquipmentList } from '../../../lib/equipment-api';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  under_maintenance: 'Under Maintenance',
  under_qualification: 'Under Qualification',
  retired: 'Retired',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  under_maintenance: 'bg-amber-100 text-amber-700',
  under_qualification: 'bg-sky-100 text-sky-700',
  retired: 'bg-slate-200 text-slate-600',
};

// EQP-1: equipment register.
export function EquipmentListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<EquipmentStatus | ''>('');

  const { data, isLoading } = useQuery({
    queryKey: ['equipment', search, status],
    queryFn: () => fetchEquipmentList({ search: search || undefined, status: status || undefined, limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Equipment</h1>
        <div className="flex items-center gap-3">
          <ExportAuditButton entityType="Equipment" label="Export audit history (CSV)" />
          <Link to="/equipment/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            New equipment
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Search equipment"
          placeholder="Search code or name…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value as EquipmentStatus | '')}
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
              <th className="py-1 pr-4 font-medium">Code</th>
              <th className="py-1 pr-4 font-medium">Name</th>
              <th className="py-1 pr-4 font-medium">Location</th>
              <th className="py-1 pr-4 font-medium">GMP-critical</th>
              <th className="py-1 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map((equipment) => (
              <tr key={equipment.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium">
                  <Link to={`/equipment/${equipment.id}`} className="underline">
                    {equipment.equipmentCode}
                  </Link>
                </td>
                <td className="py-2 pr-4">{equipment.name}</td>
                <td className="py-2 pr-4">{equipment.location}</td>
                <td className="py-2 pr-4">{equipment.isGmpCritical ? 'Yes' : 'No'}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[equipment.status]}`}>
                    {STATUS_LABELS[equipment.status]}
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

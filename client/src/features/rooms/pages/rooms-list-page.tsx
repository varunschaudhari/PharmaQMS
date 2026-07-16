import type { RoomStatus } from '@pharmaqms/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ExportAuditButton } from '../../../components/ui/export-audit-button';
import { fetchRoomList } from '../../../lib/room-api';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  retired: 'Retired',
};

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  retired: 'bg-slate-200 text-slate-600',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  general: 'General',
  controlled: 'Controlled',
};

// QRX-1: room/area register (SPEC.md §7.4).
export function RoomsListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<RoomStatus | ''>('');

  const { data, isLoading } = useQuery({
    queryKey: ['rooms', search, status],
    queryFn: () => fetchRoomList({ search: search || undefined, status: status || undefined, limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Rooms / Areas</h1>
        <div className="flex items-center gap-3">
          <ExportAuditButton entityType="Room" label="Export audit history (CSV)" />
          <Link to="/rooms/new" className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white">
            New room
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          aria-label="Search rooms"
          placeholder="Search code or name…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="w-64 rounded border border-slate-300 px-3 py-1.5 text-sm"
        />
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(event) => setStatus(event.target.value as RoomStatus | '')}
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
              <th className="py-1 pr-4 font-medium">Block</th>
              <th className="py-1 pr-4 font-medium">Classification</th>
              <th className="py-1 pr-4 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).map((room) => (
              <tr key={room.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 font-medium">
                  <Link to={`/rooms/${room.id}`} className="underline">
                    {room.roomCode}
                  </Link>
                </td>
                <td className="py-2 pr-4">{room.name}</td>
                <td className="py-2 pr-4">{room.block ?? '—'}</td>
                <td className="py-2 pr-4">{CLASSIFICATION_LABELS[room.classification] ?? room.classification}</td>
                <td className="py-2 pr-4">
                  <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[room.status]}`}>
                    {STATUS_LABELS[room.status]}
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

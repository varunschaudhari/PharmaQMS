import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchRoomCleaningDue } from '../../../lib/room-api';

const STATUS_STYLES: Record<string, string> = {
  due_soon: 'text-amber-600',
  overdue: 'font-semibold text-red-600',
};

// QRX-1: QA-facing overdue-room-cleaning dashboard.
export function RoomCleaningDuePage() {
  const { data: due, isLoading } = useQuery({ queryKey: ['room-cleaning-due'], queryFn: fetchRoomCleaningDue });

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">Room cleaning due</h1>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (due ?? []).length === 0 ? (
        <p className="text-sm text-slate-500">No rooms are due or overdue for cleaning.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-1 pr-4 font-medium">Room</th>
              <th className="py-1 pr-4 font-medium">Status</th>
              <th className="py-1 pr-4 font-medium">Next due</th>
            </tr>
          </thead>
          <tbody>
            {(due ?? []).map((entry) => (
              <tr key={entry.roomId} className="border-b border-slate-100">
                <td className="py-2 pr-4">
                  <Link to={`/rooms/${entry.roomId}`} className="underline">
                    {entry.roomCode} — {entry.roomName}
                  </Link>
                </td>
                <td className={`py-2 pr-4 ${STATUS_STYLES[entry.cleaningStatus] ?? ''}`}>
                  {entry.cleaningStatus.replace('_', ' ').toUpperCase()}
                </td>
                <td className="py-2 pr-4">{entry.nextDueDate.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

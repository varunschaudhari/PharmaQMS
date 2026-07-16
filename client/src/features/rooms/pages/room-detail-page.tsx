import { ROOM_STATUS_TRANSITIONS, RoomStatus } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HistoryTab } from '../../../components/ui/history-tab';
import { extractErrorMessage } from '../../../lib/api-error';
import { downloadRoomLabel, fetchRoom, transitionRoomStatus } from '../../../lib/room-api';
import { RoomCleaningPanel } from '../components/room-cleaning-panel';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  retired: 'Retired',
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  general: 'General',
  controlled: 'Controlled',
};

// QRX-1: room detail — metadata, QR label downloads, status transitions (explicit map, never a
// direct field write), cleaning schedule/log, and the mandatory HistoryTab.
export function RoomDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: room, isLoading } = useQuery({
    queryKey: ['room', id],
    queryFn: () => fetchRoom(id as string),
    enabled: Boolean(id),
  });

  const transitionMutation = useMutation({
    mutationFn: (status: RoomStatus) => transitionRoomStatus(id as string, { status, reason: reason || undefined }),
    onSuccess: () => {
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['room', id] });
      void queryClient.invalidateQueries({ queryKey: ['audit-history', 'Room', id] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to change status.'),
  });

  if (isLoading || !room) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const allowedTransitions = ROOM_STATUS_TRANSITIONS[room.status] ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {room.roomCode} — {STATUS_LABELS[room.status]}
          </p>
          <h1 className="text-lg font-semibold text-slate-900">{room.name}</h1>
          <p className="text-sm text-slate-600">
            {room.block ? `${room.block} — ` : ''}
            {CLASSIFICATION_LABELS[room.classification] ?? room.classification}
          </p>
        </div>
        {room.qr && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void downloadRoomLabel(room.qr!.code, 'single')}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Single label PDF
            </button>
            <button
              type="button"
              onClick={() => void downloadRoomLabel(room.qr!.code, 'a4')}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              A4 sheet PDF
            </button>
            <Link to={`/s/${room.qr.code}`} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Open mobile view
            </Link>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {allowedTransitions.length > 0 && (
        <section className="rounded border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Change status</h2>
          <textarea
            aria-label="Reason for status change"
            placeholder="Reason (optional)…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="mt-2 flex gap-2">
            {allowedTransitions.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => transitionMutation.mutate(status)}
                disabled={transitionMutation.isPending}
                className="rounded border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </section>
      )}

      <RoomCleaningPanel roomId={room.id} />

      <section className="rounded border border-slate-200 bg-white p-4">
        <HistoryTab entityType="Room" entityId={room.id} />
      </section>
    </div>
  );
}

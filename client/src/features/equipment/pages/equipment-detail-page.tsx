import { EquipmentStatus, EQUIPMENT_STATUS_TRANSITIONS } from '@pharmaqms/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { HistoryTab } from '../../../components/ui/history-tab';
import { extractErrorMessage } from '../../../lib/api-error';
import {
  downloadEquipmentHistoryReport,
  downloadEquipmentLabel,
  fetchEquipment,
  transitionEquipmentStatus,
} from '../../../lib/equipment-api';
import { CalibrationPanel } from '../components/calibration-panel';
import { LogbookPanel } from '../components/logbook-panel';
import { MaintenanceTaskPanel } from '../components/maintenance-task-panel';
import { PmPanel } from '../components/pm-panel';
import { QualificationPanel } from '../components/qualification-panel';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  under_maintenance: 'Under Maintenance',
  under_qualification: 'Under Qualification',
  do_not_use: 'Do Not Use',
  retired: 'Retired',
};

// EQP-1/EQP-2: equipment detail — metadata, QR label downloads, status transitions (explicit
// map, never a direct field write), and the mandatory HistoryTab.
export function EquipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const { data: equipment, isLoading } = useQuery({
    queryKey: ['equipment', id],
    queryFn: () => fetchEquipment(id as string),
    enabled: Boolean(id),
  });

  const transitionMutation = useMutation({
    mutationFn: (status: EquipmentStatus) => transitionEquipmentStatus(id as string, { status, reason: reason || undefined }),
    onSuccess: () => {
      setReason('');
      void queryClient.invalidateQueries({ queryKey: ['equipment', id] });
      void queryClient.invalidateQueries({ queryKey: ['audit-history', 'Equipment', id] });
    },
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to change status.'),
  });

  if (isLoading || !equipment) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  const allowedTransitions = EQUIPMENT_STATUS_TRANSITIONS[equipment.status] ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {equipment.equipmentCode} — {STATUS_LABELS[equipment.status]}
          </p>
          <h1 className="text-lg font-semibold text-slate-900">{equipment.name}</h1>
          <p className="text-sm text-slate-600">
            {equipment.location}
            {equipment.make ? ` — ${equipment.make}` : ''}
            {equipment.modelName ? ` ${equipment.modelName}` : ''}
            {equipment.isGmpCritical ? ' — GMP-critical' : ''}
          </p>
        </div>
        {equipment.qr && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void downloadEquipmentLabel(equipment.qr!.code, 'single')}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              Single label PDF
            </button>
            <button
              type="button"
              onClick={() => void downloadEquipmentLabel(equipment.qr!.code, 'a4')}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm"
            >
              A4 sheet PDF
            </button>
            <Link to={`/s/${equipment.qr.code}`} className="rounded border border-slate-300 px-3 py-1.5 text-sm">
              Open mobile view
            </Link>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void downloadEquipmentHistoryReport(equipment.id)}
          className="rounded border border-slate-300 px-3 py-1.5 text-sm"
        >
          Download history report (EQP-10)
        </button>
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

      <CalibrationPanel equipmentId={equipment.id} />

      <QualificationPanel equipmentId={equipment.id} />

      <PmPanel equipmentId={equipment.id} />

      <LogbookPanel equipmentId={equipment.id} />

      <MaintenanceTaskPanel equipmentId={equipment.id} />

      <section className="rounded border border-slate-200 bg-white p-4">
        <HistoryTab entityType="Equipment" entityId={equipment.id} />
      </section>
    </div>
  );
}

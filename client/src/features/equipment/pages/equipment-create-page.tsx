import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDepartments } from '../../../lib/admin-api';
import { extractErrorMessage } from '../../../lib/api-error';
import { createEquipment } from '../../../lib/equipment-api';
import { fetchRoomList } from '../../../lib/room-api';

// EQP-1: new equipment master record.
export function EquipmentCreatePage() {
  const navigate = useNavigate();
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  // QRX-1: rooms are an opaque reference on Equipment (no cross-module validation server-side —
  // see EquipmentData's header comment in packages/shared) — this dropdown is purely a UX
  // convenience for picking a valid room id.
  const { data: rooms } = useQuery({ queryKey: ['rooms', '', ''], queryFn: () => fetchRoomList({ limit: 100 }) });

  const [name, setName] = useState('');
  const [make, setMake] = useState('');
  const [modelName, setModelName] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const [location, setLocation] = useState('');
  const [roomId, setRoomId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [isGmpCritical, setIsGmpCritical] = useState(false);
  const [installDate, setInstallDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createEquipment({
        name,
        make: make || undefined,
        modelName: modelName || undefined,
        serialNumber: serialNumber || undefined,
        location,
        roomId: roomId || undefined,
        departmentId,
        isGmpCritical,
        installDate: installDate || undefined,
      }),
    onSuccess: (equipment) => navigate(`/equipment/${equipment.id}`),
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create equipment.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">New equipment</h1>
      <form onSubmit={handleSubmit} className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="eq-name" className="block text-sm font-medium text-slate-700">
            Name
          </label>
          <input
            id="eq-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="eq-make" className="block text-sm font-medium text-slate-700">
              Make
            </label>
            <input
              id="eq-make"
              value={make}
              onChange={(event) => setMake(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="eq-model" className="block text-sm font-medium text-slate-700">
              Model
            </label>
            <input
              id="eq-model"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label htmlFor="eq-serial" className="block text-sm font-medium text-slate-700">
            Serial number
          </label>
          <input
            id="eq-serial"
            value={serialNumber}
            onChange={(event) => setSerialNumber(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="eq-location" className="block text-sm font-medium text-slate-700">
            Location
          </label>
          <input
            id="eq-location"
            required
            placeholder="e.g. QC Lab — Bench 3"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="eq-room" className="block text-sm font-medium text-slate-700">
            Room (QRX-1)
          </label>
          <select
            id="eq-room"
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">No room linked</option>
            {(rooms?.data ?? []).map((room) => (
              <option key={room.id} value={room.id}>
                {room.roomCode} — {room.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="eq-department" className="block text-sm font-medium text-slate-700">
            Department
          </label>
          <select
            id="eq-department"
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
          <label htmlFor="eq-install-date" className="block text-sm font-medium text-slate-700">
            Install date
          </label>
          <input
            id="eq-install-date"
            type="date"
            value={installDate}
            onChange={(event) => setInstallDate(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isGmpCritical} onChange={(event) => setIsGmpCritical(event.target.checked)} />
          GMP-critical
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create equipment
        </button>
      </form>
    </div>
  );
}

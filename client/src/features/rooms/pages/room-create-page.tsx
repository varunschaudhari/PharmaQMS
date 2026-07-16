import { RoomClassification } from '@pharmaqms/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchDepartments } from '../../../lib/admin-api';
import { extractErrorMessage } from '../../../lib/api-error';
import { createRoom } from '../../../lib/room-api';

// QRX-1: new room/area master record.
export function RoomCreatePage() {
  const navigate = useNavigate();
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });

  const [name, setName] = useState('');
  const [block, setBlock] = useState('');
  const [classification, setClassification] = useState<RoomClassification>(RoomClassification.GENERAL);
  const [departmentId, setDepartmentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createRoom({
        name,
        block: block || undefined,
        classification,
        departmentId: departmentId || undefined,
      }),
    onSuccess: (room) => navigate(`/rooms/${room.id}`),
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create room.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">New room / area</h1>
      <form onSubmit={handleSubmit} className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="room-name" className="block text-sm font-medium text-slate-700">
            Name
          </label>
          <input
            id="room-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="room-block" className="block text-sm font-medium text-slate-700">
            Block / building
          </label>
          <input
            id="room-block"
            value={block}
            onChange={(event) => setBlock(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="room-classification" className="block text-sm font-medium text-slate-700">
            Classification
          </label>
          <select
            id="room-classification"
            value={classification}
            onChange={(event) => setClassification(event.target.value as RoomClassification)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value={RoomClassification.GENERAL}>General</option>
            <option value={RoomClassification.CONTROLLED}>Controlled</option>
          </select>
        </div>
        <div>
          <label htmlFor="room-department" className="block text-sm font-medium text-slate-700">
            Department (owns overdue-cleaning notifications)
          </label>
          <select
            id="room-department"
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">No department</option>
            {(departments ?? []).map((department) => (
              <option key={department.id} value={department.id}>
                {department.name} ({department.code})
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create room
        </button>
      </form>
    </div>
  );
}

import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractErrorMessage } from '../../../lib/api-error';
import { createMaterialLot } from '../../../lib/material-lot-api';

// QRX-2: new material lot record — always created as Quarantine (status is never settable here).
export function MaterialLotCreatePage() {
  const navigate = useNavigate();

  const [materialName, setMaterialName] = useState('');
  const [manufacturer, setManufacturer] = useState('');
  const [receivedDate, setReceivedDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createMaterialLot({
        materialName,
        manufacturer: manufacturer || undefined,
        receivedDate,
      }),
    onSuccess: (lot) => navigate(`/materials/${lot.id}`),
    onError: (err) => setError(extractErrorMessage(err) ?? 'Failed to create material lot.'),
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createMutation.mutate();
  }

  return (
    <div className="max-w-lg space-y-6">
      <h1 className="text-lg font-semibold text-slate-900">New material lot</h1>
      <form onSubmit={handleSubmit} className="space-y-4 rounded border border-slate-200 bg-white p-4">
        <div>
          <label htmlFor="lot-material-name" className="block text-sm font-medium text-slate-700">
            Material name
          </label>
          <input
            id="lot-material-name"
            required
            value={materialName}
            onChange={(event) => setMaterialName(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="lot-manufacturer" className="block text-sm font-medium text-slate-700">
            Manufacturer / supplier
          </label>
          <input
            id="lot-manufacturer"
            value={manufacturer}
            onChange={(event) => setManufacturer(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="lot-received-date" className="block text-sm font-medium text-slate-700">
            Received date
          </label>
          <input
            id="lot-received-date"
            type="date"
            required
            value={receivedDate}
            onChange={(event) => setReceivedDate(event.target.value)}
            className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Create lot
        </button>
      </form>
    </div>
  );
}

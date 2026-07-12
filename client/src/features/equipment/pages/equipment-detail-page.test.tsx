import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../../lib/jwt.test-helpers';
import { EquipmentDetailPage } from './equipment-detail-page';

const {
  fetchEquipment,
  transitionEquipmentStatus,
  downloadEquipmentLabel,
  downloadEquipmentHistoryReport,
  fetchCalibrationSchedule,
  fetchCalibrationRecords,
  fetchLogbook,
  fetchMaintenanceTasksForEquipment,
  fetchQualificationRecords,
  fetchPmPlan,
  fetchPmTasksForEquipment,
} = vi.hoisted(() => ({
  fetchEquipment: vi.fn(),
  transitionEquipmentStatus: vi.fn(),
  downloadEquipmentLabel: vi.fn(),
  downloadEquipmentHistoryReport: vi.fn(),
  fetchCalibrationSchedule: vi.fn(),
  fetchCalibrationRecords: vi.fn(),
  fetchLogbook: vi.fn(),
  fetchMaintenanceTasksForEquipment: vi.fn(),
  fetchQualificationRecords: vi.fn(),
  fetchPmPlan: vi.fn(),
  fetchPmTasksForEquipment: vi.fn(),
}));
vi.mock('../../../lib/equipment-api', () => ({
  fetchEquipment,
  transitionEquipmentStatus,
  downloadEquipmentLabel,
  downloadEquipmentHistoryReport,
  fetchCalibrationSchedule,
  fetchCalibrationRecords,
  fetchLogbook,
  fetchMaintenanceTasksForEquipment,
  fetchQualificationRecords,
  fetchPmPlan,
  fetchPmTasksForEquipment,
}));

const { fetchAuditHistory } = vi.hoisted(() => ({ fetchAuditHistory: vi.fn() }));
vi.mock('../../../lib/audit-api', () => ({ fetchAuditHistory }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/equipment/eq-1']}>
          <Routes>
            <Route path="/equipment/:id" element={<EquipmentDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('EQP-1 EquipmentDetailPage', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ permissions: ['equipment:edit', 'equipment:approve'] }));
    fetchCalibrationSchedule.mockResolvedValue(null);
    fetchCalibrationRecords.mockResolvedValue([]);
    fetchLogbook.mockResolvedValue([]);
    fetchMaintenanceTasksForEquipment.mockResolvedValue([]);
    fetchQualificationRecords.mockResolvedValue([]);
    fetchPmPlan.mockResolvedValue(null);
    fetchPmTasksForEquipment.mockResolvedValue([]);
  });

  it('EQP-1/EQP-10: shows equipment metadata, HistoryTab, transitions status through the allowed map, and downloads the history report', async () => {
    const user = userEvent.setup();
    fetchEquipment.mockResolvedValue({
      id: 'eq-1',
      tenantId: 't1',
      equipmentCode: 'EQP-0001',
      name: 'pH Meter',
      make: 'Mettler',
      modelName: 'S220',
      serialNumber: 'SN-1',
      location: 'QC Lab',
      departmentId: 'dept-1',
      isGmpCritical: true,
      status: 'active',
      installDate: '2024-01-01T00:00:00.000Z',
      qr: { code: 'ABCDE23456', scanUrl: 'http://localhost:5173/s/ABCDE23456' },
      createdAt: '2026-07-11T00:00:00.000Z',
    });
    fetchAuditHistory.mockResolvedValue({
      data: [
        {
          id: 'evt-1', tenantId: 't1', actorId: 'u1', actorName: 'QA Executive',
          entityType: 'Equipment', entityId: 'eq-1', action: 'create', changes: [], reason: null,
          occurredAt: '2026-07-11T00:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });
    transitionEquipmentStatus.mockResolvedValue({ status: 'under_maintenance' });

    renderPage();

    await waitFor(() => expect(screen.getByText('pH Meter')).toBeInTheDocument());
    expect(screen.getByText('EQP-0001 — Active')).toBeInTheDocument();
    expect(await screen.findByText('QA Executive')).toBeInTheDocument();

    // Active -> Under Maintenance / Under Qualification / Retired are all offered.
    expect(screen.getByRole('button', { name: 'Under Maintenance' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retired' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Under Maintenance' }));
    await waitFor(() =>
      expect(transitionEquipmentStatus).toHaveBeenCalledWith('eq-1', { status: 'under_maintenance', reason: undefined }),
    );

    await user.click(screen.getByRole('button', { name: /download history report/i }));
    expect(downloadEquipmentHistoryReport).toHaveBeenCalledWith('eq-1');
  });
});

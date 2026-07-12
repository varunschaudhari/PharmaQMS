import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EquipmentStatusCard } from './equipment-status-card';

const { fetchEquipmentStatusCard, logUsageStart, logUsageStop, logCleaning, logBreakdown, createLogbookAmendment, openLogbookPhoto } = vi.hoisted(() => ({
  fetchEquipmentStatusCard: vi.fn(),
  logUsageStart: vi.fn(),
  logUsageStop: vi.fn(),
  logCleaning: vi.fn(),
  logBreakdown: vi.fn(),
  createLogbookAmendment: vi.fn(),
  openLogbookPhoto: vi.fn(),
}));
vi.mock('../../lib/equipment-api', () => ({
  fetchEquipmentStatusCard,
  logUsageStart,
  logUsageStop,
  logCleaning,
  logBreakdown,
  createLogbookAmendment,
  openLogbookPhoto,
}));

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <EquipmentStatusCard equipmentId="eq-1" />
    </QueryClientProvider>,
  );
}

describe('EQP-3 EquipmentStatusCard', () => {
  it('EQP-3: shows NOT SCHEDULED calibration, current status, and stub sections for qualification/PM/logbook', async () => {
    fetchEquipmentStatusCard.mockResolvedValue({
      id: 'eq-1',
      equipmentCode: 'EQP-0001',
      name: 'pH Meter',
      location: 'QC Lab — Bench 3',
      departmentId: 'dept-1',
      isGmpCritical: true,
      status: 'active',
      calibrationStatus: 'not_scheduled',
      calibrationNextDueDate: null,
      qualificationStatus: 'not_qualified',
      qualificationNextDueDate: null,
      pmStatus: 'not_scheduled',
      pmDueDate: null,
      recentLogbookEntries: [],
      availableActions: ['log_usage', 'log_cleaning', 'report_breakdown'],
    });

    renderCard();

    await waitFor(() => expect(screen.getByText('pH Meter')).toBeInTheDocument());
    expect(screen.getByText('EQP-0001')).toBeInTheDocument();
    expect(screen.getByText('NOT SCHEDULED')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Not qualified')).toBeInTheDocument();
    expect(screen.getByText('Not scheduled')).toBeInTheDocument();
    expect(screen.getByText('No logbook entries yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start Usage' })).toBeEnabled();
  });

  it('EQP-3: color-codes an OVERDUE calibration', async () => {
    fetchEquipmentStatusCard.mockResolvedValue({
      id: 'eq-1',
      equipmentCode: 'EQP-0001',
      name: 'Balance',
      location: 'QC Lab',
      departmentId: 'dept-1',
      isGmpCritical: false,
      status: 'active',
      calibrationStatus: 'overdue',
      calibrationNextDueDate: '2026-06-01T00:00:00.000Z',
      qualificationStatus: 'not_qualified',
      qualificationNextDueDate: null,
      pmStatus: 'not_scheduled',
      pmDueDate: null,
      recentLogbookEntries: [],
      availableActions: [],
    });

    renderCard();

    await waitFor(() => expect(screen.getByText('OVERDUE')).toBeInTheDocument());
    expect(screen.getByText('Valid until 2026-06-01')).toBeInTheDocument();
  });

  it('EQP-4: shows a usage-blocked warning when overdue calibration blocks usage', async () => {
    fetchEquipmentStatusCard.mockResolvedValue({
      id: 'eq-1',
      equipmentCode: 'EQP-0001',
      name: 'Balance',
      location: 'QC Lab',
      departmentId: 'dept-1',
      isGmpCritical: false,
      status: 'active',
      calibrationStatus: 'overdue',
      calibrationNextDueDate: '2026-06-01T00:00:00.000Z',
      calibrationBlocksUsage: true,
      qualificationStatus: 'not_qualified',
      qualificationNextDueDate: null,
      pmStatus: 'not_scheduled',
      pmDueDate: null,
      recentLogbookEntries: [],
      availableActions: [],
    });

    renderCard();

    await waitFor(() => expect(screen.getByText(/Usage logging is blocked/)).toBeInTheDocument());
  });

  it('EQP-5: shows a DO NOT USE banner when the equipment is quarantined', async () => {
    fetchEquipmentStatusCard.mockResolvedValue({
      id: 'eq-1',
      equipmentCode: 'EQP-0001',
      name: 'Balance',
      location: 'QC Lab',
      departmentId: 'dept-1',
      isGmpCritical: false,
      status: 'do_not_use',
      calibrationStatus: 'overdue',
      calibrationNextDueDate: '2026-06-01T00:00:00.000Z',
      calibrationBlocksUsage: true,
      qualificationStatus: 'not_qualified',
      qualificationNextDueDate: null,
      pmStatus: 'not_scheduled',
      pmDueDate: null,
      recentLogbookEntries: [],
      availableActions: [],
    });

    renderCard();

    await waitFor(() => expect(screen.getByText(/DO NOT USE/)).toBeInTheDocument());
    expect(screen.getByText('Do Not Use')).toBeInTheDocument();
  });

  function baseCard(overrides: Record<string, unknown> = {}) {
    return {
      id: 'eq-1',
      equipmentCode: 'EQP-0001',
      name: 'pH Meter',
      location: 'QC Lab',
      departmentId: 'dept-1',
      isGmpCritical: true,
      status: 'active',
      calibrationStatus: 'not_scheduled',
      calibrationNextDueDate: null,
      calibrationBlocksUsage: false,
      qualificationStatus: 'not_qualified',
      qualificationNextDueDate: null,
      pmStatus: 'not_scheduled',
      pmDueDate: null,
      recentLogbookEntries: [],
      availableActions: ['log_usage', 'log_cleaning', 'report_breakdown'],
      ...overrides,
    };
  }

  it('EQP-6: starts a usage session with a product/batch reference', async () => {
    const user = userEvent.setup();
    fetchEquipmentStatusCard.mockResolvedValue(baseCard());
    logUsageStart.mockResolvedValue({});

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start Usage' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Start Usage' }));
    await user.type(screen.getByPlaceholderText('Product / batch reference'), 'BATCH-100');
    await user.click(screen.getByRole('button', { name: 'Start' }));

    await waitFor(() => expect(logUsageStart).toHaveBeenCalledWith('eq-1', 'BATCH-100'));
  });

  it('EQP-6: stops usage immediately (no form) when a session is already open', async () => {
    const user = userEvent.setup();
    fetchEquipmentStatusCard.mockResolvedValue(
      baseCard({ recentLogbookEntries: [{ id: 'e1', entryType: 'usage_start', productBatchRef: 'BATCH-100', occurredAt: '2026-07-11T10:00:00.000Z', performedByUserFullName: 'Olive Operator' }] }),
    );
    logUsageStop.mockResolvedValue({});

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop Usage' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Stop Usage' }));

    await waitFor(() => expect(logUsageStop).toHaveBeenCalledWith('eq-1'));
  });

  it('EQP-6: logs a cleaning entry by type', async () => {
    const user = userEvent.setup();
    fetchEquipmentStatusCard.mockResolvedValue(baseCard());
    logCleaning.mockResolvedValue({});

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log Cleaning' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Log Cleaning' }));
    await user.click(screen.getByRole('button', { name: 'Full' }));

    await waitFor(() => expect(logCleaning).toHaveBeenCalledWith('eq-1', 'full'));
  });

  it('EQP-6/EQP-7: reports a breakdown with a description', async () => {
    const user = userEvent.setup();
    fetchEquipmentStatusCard.mockResolvedValue(baseCard());
    logBreakdown.mockResolvedValue({ entry: {}, maintenanceTask: {} });

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Report Breakdown' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Report Breakdown' }));
    await user.type(screen.getByPlaceholderText('What happened?'), 'Pump seal leaking.');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => expect(logBreakdown).toHaveBeenCalledWith('eq-1', 'Pump seal leaking.', undefined));
  });

  it('EQP-6: a correction logs a NEW amendment entry, never edits the original', async () => {
    const user = userEvent.setup();
    fetchEquipmentStatusCard.mockResolvedValue(
      baseCard({ recentLogbookEntries: [{ id: 'e1', entryType: 'cleaning', cleaningType: 'routine', occurredAt: '2026-07-11T10:00:00.000Z', performedByUserFullName: 'Olive Operator' }] }),
    );
    createLogbookAmendment.mockResolvedValue({});

    renderCard();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Correct this entry' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Correct this entry' }));
    await user.type(screen.getByPlaceholderText('What was wrong, and what is the correction?'), 'Should have been Full.');
    await user.click(screen.getByRole('button', { name: 'Log correction' }));

    await waitFor(() => expect(createLogbookAmendment).toHaveBeenCalledWith('eq-1', 'e1', 'Should have been Full.'));
  });
});

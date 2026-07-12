import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HistoryTab } from './history-tab';

const { downloadAuditRecordExport } = vi.hoisted(() => ({ downloadAuditRecordExport: vi.fn() }));

vi.mock('../../lib/audit-api', () => ({
  fetchAuditHistory: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'event-1',
        tenantId: 'tenant-1',
        actorId: 'user-1',
        actorName: 'QA Head',
        entityType: 'Document',
        entityId: 'doc-1',
        action: 'update',
        changes: [{ field: 'title', oldValue: 'Old Title', newValue: 'New Title' }],
        reason: 'Corrected typo',
        occurredAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    meta: { page: 1, limit: 20, total: 1 },
  }),
  downloadAuditRecordExport,
  downloadAuditModuleExport: vi.fn(),
}));

function renderWithQueryClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('PLT-2 HistoryTab', () => {
  it('PLT-2: renders audit events with actor, action, field-level changes, and reason', async () => {
    renderWithQueryClient(<HistoryTab entityType="Document" entityId="doc-1" />);

    await waitFor(() => expect(screen.getByText('QA Head')).toBeInTheDocument());
    expect(screen.getByText('update')).toBeInTheDocument();
    expect(screen.getByText('Corrected typo')).toBeInTheDocument();
    expect(screen.getByText(/title/)).toBeInTheDocument();
    expect(screen.getByText(/Old Title.*New Title/)).toBeInTheDocument();
  });

  it('PLT-2: the Export CSV button downloads this record\'s history for this entityType/entityId', async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<HistoryTab entityType="Document" entityId="doc-1" />);

    await user.click(await screen.findByRole('button', { name: 'Export CSV' }));
    expect(downloadAuditRecordExport).toHaveBeenCalledWith('Document', 'doc-1');
  });
});

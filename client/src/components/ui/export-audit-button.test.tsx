import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExportAuditButton } from './export-audit-button';

const { downloadAuditRecordExport, downloadAuditModuleExport } = vi.hoisted(() => ({
  downloadAuditRecordExport: vi.fn(),
  downloadAuditModuleExport: vi.fn(),
}));
vi.mock('../../lib/audit-api', () => ({ downloadAuditRecordExport, downloadAuditModuleExport }));

describe('PLT-2 ExportAuditButton', () => {
  beforeEach(() => {
    downloadAuditRecordExport.mockReset();
    downloadAuditModuleExport.mockReset();
  });

  it('PLT-2: with an entityId, exports that one record\'s history', async () => {
    const user = userEvent.setup();
    downloadAuditRecordExport.mockResolvedValue(undefined);
    render(<ExportAuditButton entityType="Document" entityId="doc-1" />);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(downloadAuditRecordExport).toHaveBeenCalledWith('Document', 'doc-1');
    expect(downloadAuditModuleExport).not.toHaveBeenCalled();
  });

  it('PLT-2: without an entityId, exports the whole module\'s history', async () => {
    const user = userEvent.setup();
    downloadAuditModuleExport.mockResolvedValue(undefined);
    render(<ExportAuditButton entityType="Equipment" label="Export audit history (CSV)" />);

    await user.click(screen.getByRole('button', { name: 'Export audit history (CSV)' }));

    expect(downloadAuditModuleExport).toHaveBeenCalledWith('Equipment');
    expect(downloadAuditRecordExport).not.toHaveBeenCalled();
  });

  it('PLT-2: shows an error message if the export request fails', async () => {
    const user = userEvent.setup();
    downloadAuditRecordExport.mockRejectedValue(new Error('network error'));
    render(<ExportAuditButton entityType="Document" entityId="doc-1" />);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(await screen.findByText('Failed to export audit history.')).toBeInTheDocument();
  });
});

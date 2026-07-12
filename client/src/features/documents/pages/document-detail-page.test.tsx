import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DocumentDetailPage } from './document-detail-page';

const {
  fetchDocument,
  fetchDocumentVersions,
  fetchVersionWorkflow,
  submitDocumentVersion,
  obsoleteDocument,
  downloadVersionFile,
  downloadControlledCopy,
  updateDocumentDistribution,
} = vi.hoisted(() => ({
  fetchDocument: vi.fn(),
  fetchDocumentVersions: vi.fn(),
  fetchVersionWorkflow: vi.fn(),
  submitDocumentVersion: vi.fn(),
  obsoleteDocument: vi.fn(),
  downloadVersionFile: vi.fn(),
  downloadControlledCopy: vi.fn(),
  updateDocumentDistribution: vi.fn(),
}));
const { fetchSignatures } = vi.hoisted(() => ({ fetchSignatures: vi.fn() }));
const { fetchAuditHistory } = vi.hoisted(() => ({ fetchAuditHistory: vi.fn() }));
const { fetchRoles, fetchDepartments } = vi.hoisted(() => ({ fetchRoles: vi.fn(), fetchDepartments: vi.fn() }));

vi.mock('../../../lib/documents-api', () => ({
  fetchDocument,
  fetchDocumentVersions,
  fetchVersionWorkflow,
  submitDocumentVersion,
  obsoleteDocument,
  downloadVersionFile,
  downloadControlledCopy,
  updateDocumentDistribution,
}));
vi.mock('../../../lib/esign-api', () => ({ fetchSignatures }));
vi.mock('../../../lib/audit-api', () => ({ fetchAuditHistory }));
vi.mock('../../../lib/admin-api', () => ({ fetchRoles, fetchDepartments }));

const draftVersion = {
  id: 'ver-1',
  tenantId: 't1',
  documentId: 'doc-1',
  majorVersion: 1,
  minorVersion: 0,
  versionLabel: '1.0',
  state: 'draft',
  changeSummary: null,
  fileName: 'sop.pdf',
  fileContentType: 'application/pdf',
  fileSize: 100,
  effectiveDate: null,
  createdByUserId: 'u1',
  createdAt: '2026-07-11T00:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/documents/doc-1']}>
        <Routes>
          <Route path="/documents/:id" element={<DocumentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DOC-3 DocumentDetailPage', () => {
  it('DOC-3: a draft document shows version history, HistoryTab, and submits for review', async () => {
    const user = userEvent.setup();
    fetchDocument.mockResolvedValue({
      id: 'doc-1',
      tenantId: 't1',
      docNumber: 'SOP-QA-001',
      title: 'Cleaning of pH meters',
      docType: 'sop',
      departmentId: 'dept-1',
      reviewFrequencyMonths: 12,
      authorId: 'u1',
      distributionRoleIds: [],
      distributionDepartmentIds: [],
      status: 'draft',
      effectiveVersion: null,
      latestVersion: draftVersion,
      nextReviewDate: null,
      createdAt: '2026-07-11T00:00:00.000Z',
    });
    fetchDocumentVersions.mockResolvedValue([draftVersion]);
    fetchSignatures.mockResolvedValue([]);
    fetchRoles.mockResolvedValue([{ id: 'role-1', name: 'Operator' }]);
    fetchDepartments.mockResolvedValue([{ id: 'dept-1', tenantId: 't1', name: 'Quality Assurance', code: 'QA', headUserId: null, isActive: true }]);
    fetchAuditHistory.mockResolvedValue({
      data: [
        {
          id: 'evt-1',
          tenantId: 't1',
          actorId: 'u1',
          actorName: 'QA Executive',
          entityType: 'Document',
          entityId: 'doc-1',
          action: 'create',
          changes: [],
          reason: null,
          occurredAt: '2026-07-11T00:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 20, total: 1 },
    });
    submitDocumentVersion.mockResolvedValue({ ...draftVersion, state: 'under_review' });

    renderPage();

    await waitFor(() => expect(screen.getByText('SOP-QA-001 — Cleaning of pH meters')).toBeInTheDocument());
    expect(screen.getByText('1.0')).toBeInTheDocument();
    expect(screen.getByText('Initial issue')).toBeInTheDocument();
    expect(await screen.findByText('QA Executive')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /submit for review/i }));
    await waitFor(() => expect(submitDocumentVersion).toHaveBeenCalledWith('doc-1', 'ver-1'));
  });
});

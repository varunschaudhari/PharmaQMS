import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsPage } from './documents-page';

const { fetchDocuments } = vi.hoisted(() => ({ fetchDocuments: vi.fn() }));
vi.mock('../../../lib/documents-api', () => ({ fetchDocuments }));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DOC-1 DOC-7 DocumentsPage', () => {
  it('DOC-1: lists documents with number, status, effective version, and next review date', async () => {
    fetchDocuments.mockResolvedValue({
      data: [
        {
          id: 'doc-1',
          tenantId: 't1',
          docNumber: 'SOP-QA-001',
          title: 'Cleaning of pH meters',
          docType: 'sop',
          departmentId: 'dept-1',
          reviewFrequencyMonths: 12,
          authorId: 'u1',
          status: 'effective',
          effectiveVersion: { versionLabel: '2.0' },
          latestVersion: { versionLabel: '2.0', state: 'effective' },
          nextReviewDate: '2027-07-11T00:00:00.000Z',
          createdAt: '2026-07-11T00:00:00.000Z',
        },
      ],
      meta: { page: 1, limit: 50, total: 1 },
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('SOP-QA-001')).toBeInTheDocument());
    expect(screen.getByText('Cleaning of pH meters')).toBeInTheDocument();
    expect(screen.getByText('effective')).toBeInTheDocument();
    expect(screen.getByText('2.0')).toBeInTheDocument();
    expect(screen.getByText('2027-07-11')).toBeInTheDocument();
    // DOC-7: obsolete documents are excluded from the default query.
    expect(fetchDocuments).toHaveBeenCalledWith(expect.objectContaining({ includeObsolete: false }));
  });
});

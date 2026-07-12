import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../features/auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../../lib/jwt.test-helpers';
import { ScanLandingPage } from './scan-landing-page';

const { resolveQrCode, checkDocVersion } = vi.hoisted(() => ({
  resolveQrCode: vi.fn(),
  checkDocVersion: vi.fn(),
}));
const { fetchEquipmentStatusCard } = vi.hoisted(() => ({ fetchEquipmentStatusCard: vi.fn() }));

vi.mock('../../lib/qr-api', () => ({
  resolveQrCode,
  checkDocVersion,
}));
vi.mock('../../lib/equipment-api', () => ({ fetchEquipmentStatusCard }));

function LoginProbe() {
  const location = useLocation();
  return <div>Login Page redirect={location.search}</div>;
}

function renderScan(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/login" element={<LoginProbe />} />
            <Route path="/s/:code" element={<ScanLandingPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthProvider>,
  );
}

describe('PLT-7 mobile scan landing (/s/:code)', () => {
  beforeEach(() => {
    localStorage.clear();
    resolveQrCode.mockReset();
    checkDocVersion.mockReset();
    // Default: not a document-version code — the authenticated resolution flow applies.
    checkDocVersion.mockResolvedValue(null);
  });

  it('PLT-7: an unauthenticated scan redirects to login PRESERVING the scanned target', async () => {
    renderScan('/s/ABCDE23456');

    await waitFor(() =>
      expect(screen.getByText(`Login Page redirect=?redirect=${encodeURIComponent('/s/ABCDE23456')}`)).toBeInTheDocument(),
    );
  });

  it('PLT-7: an authenticated scan of a non-equipment entity resolves and shows the persistent "Logged in as" banner (generic stub)', async () => {
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ fullName: 'Shop Floor Op' }));
    resolveQrCode.mockResolvedValue({
      code: 'ABCDE23456',
      entityType: 'TestRecord',
      entityId: 'tr-1',
      entityCode: 'TR-0042',
      entityName: 'Dummy record',
    });

    renderScan('/s/ABCDE23456');

    await waitFor(() => expect(screen.getByText('TR-0042')).toBeInTheDocument());
    expect(screen.getByText('Shop Floor Op')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch user/i })).toBeInTheDocument();
    expect(screen.getByText('Dummy record')).toBeInTheDocument();
    expect(resolveQrCode).toHaveBeenCalledWith('ABCDE23456');
  });

  it('EQP-3: an authenticated scan of an Equipment code renders the real status card, not the generic stub', async () => {
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ fullName: 'Shop Floor Op' }));
    resolveQrCode.mockResolvedValue({
      code: 'ABCDE23456',
      entityType: 'Equipment',
      entityId: 'eqp-1',
      entityCode: 'EQP-0042',
      entityName: 'pH Meter — QC Lab',
    });
    fetchEquipmentStatusCard.mockResolvedValue({
      id: 'eqp-1',
      equipmentCode: 'EQP-0042',
      name: 'pH Meter',
      location: 'QC Lab',
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
      availableActions: ['log_usage'],
    });

    renderScan('/s/ABCDE23456');

    await waitFor(() => expect(fetchEquipmentStatusCard).toHaveBeenCalledWith('eqp-1'));
    expect(await screen.findByText('NOT SCHEDULED')).toBeInTheDocument();
    // The generic stub's "arrives with its module" text must NOT appear for Equipment.
    expect(screen.queryByText(/arrives with its module/)).not.toBeInTheDocument();
  });

  it('DOC-5: scanning a CURRENT controlled copy shows the check WITHOUT any login', async () => {
    checkDocVersion.mockResolvedValue({
      status: 'current',
      docNumber: 'SOP-QA-001',
      scannedVersion: '3.0',
      scannedEffectiveDate: '2026-08-01T00:00:00.000Z',
      currentVersion: null,
      documentId: 'doc-1',
    });

    renderScan('/s/DOCCODE123');

    await waitFor(() => expect(screen.getByText('✔ CURRENT')).toBeInTheDocument());
    expect(screen.getByText('SOP-QA-001')).toBeInTheDocument();
    expect(screen.getByText(/v3\.0 — effective 2026-08-01/)).toBeInTheDocument();
    // Login is only needed to OPEN the document, not to check the version.
    expect(screen.getByRole('link', { name: /log in to open the document/i })).toBeInTheDocument();
    expect(resolveQrCode).not.toHaveBeenCalled();
  });

  it('DOC-5: scanning a stale printed copy shows OBSOLETE with the current version number', async () => {
    checkDocVersion.mockResolvedValue({
      status: 'obsolete',
      docNumber: 'SOP-QA-001',
      scannedVersion: '3.0',
      scannedEffectiveDate: '2026-01-01T00:00:00.000Z',
      currentVersion: '4.0',
      documentId: 'doc-1',
    });

    renderScan('/s/DOCCODE123');

    await waitFor(() => expect(screen.getByText('✘ OBSOLETE')).toBeInTheDocument());
    expect(screen.getByText(/current version is v4\.0/i)).toBeInTheDocument();
  });

  it('PLT-7: a code the tenant cannot resolve shows an error card, not a crash', async () => {
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest());
    resolveQrCode.mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'NOT_FOUND', message: 'QR code not found.' } } },
    });

    renderScan('/s/WRONGTENAN');

    await waitFor(() => expect(screen.getByText('QR code not found.')).toBeInTheDocument());
  });
});

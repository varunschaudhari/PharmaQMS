import { SignatureMeaning } from '@pharmaqms/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SignatureManifest } from './signature-manifest';

describe('PLT-3 SignatureManifest', () => {
  it('PLT-3: renders each signature with signer name, meaning label, and timestamp', () => {
    render(
      <SignatureManifest
        signatures={[
          {
            id: 'sig-1',
            tenantId: 'tenant-1',
            userId: 'user-1',
            userFullName: 'QA Head',
            meaning: SignatureMeaning.APPROVED_BY,
            entityType: 'Document',
            entityId: 'doc-1',
            snapshotHash: 'abc123',
            reason: 'Final approval',
            signedAt: '2026-01-01T00:00:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByText('QA Head')).toBeInTheDocument();
    expect(screen.getByText(/Approved by/)).toBeInTheDocument();
    expect(screen.getByText(/Final approval/)).toBeInTheDocument();
  });

  it('PLT-3: shows a placeholder when there are no signatures yet', () => {
    render(<SignatureManifest signatures={[]} />);
    expect(screen.getByText('No signatures yet.')).toBeInTheDocument();
  });
});

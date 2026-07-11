import { SignatureMeaning } from '@pharmaqms/shared';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SignatureDialog } from './signature-dialog';

const { challengeSignature } = vi.hoisted(() => ({
  challengeSignature: vi.fn(),
}));

vi.mock('../../lib/esign-api', () => ({
  challengeSignature,
}));

describe('PLT-3 SignatureDialog', () => {
  it('PLT-3: shows the signature meaning and hands the caller a signing token after a successful challenge', async () => {
    const user = userEvent.setup();
    challengeSignature.mockResolvedValue({ signingToken: 'signing-token-1', expiresAt: '2026-01-01T00:00:00.000Z' });

    const onSign = vi.fn().mockResolvedValue(undefined);
    render(<SignatureDialog meaning={SignatureMeaning.APPROVED_BY} onSign={onSign} onCancel={vi.fn()} />);

    expect(screen.getByText('Approved by')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(onSign).toHaveBeenCalledWith('signing-token-1'));
    expect(challengeSignature).toHaveBeenCalledWith('Correct1!');
  });

  it('PLT-3: shows an error message when the credential challenge fails', async () => {
    const user = userEvent.setup();
    challengeSignature.mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Incorrect password.' } } },
    });

    render(<SignatureDialog meaning={SignatureMeaning.REVIEWED_BY} onSign={vi.fn()} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: /^sign$/i }));

    await waitFor(() => expect(screen.getByText('Incorrect password.')).toBeInTheDocument());
  });
});

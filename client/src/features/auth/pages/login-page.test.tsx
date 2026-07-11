import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../context/auth-context';
import { LoginPage } from './login-page';

vi.mock('../api/auth-api', () => ({
  loginRequest: vi.fn().mockResolvedValue({
    tokens: { accessToken: 'access-token', refreshToken: 'refresh-token' },
    user: {
      userId: 'user-1',
      tenantId: 'tenant-1',
      roleId: 'role-1',
      email: 'qa.head@example.com',
      fullName: 'QA Head',
      permissions: [],
      isPlatformAdmin: false,
    },
    mustChangePassword: false,
  }),
}));

describe('PLT-1 LoginPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('PLT-1: submits credentials and navigates to the home page on success', async () => {
    const user = userEvent.setup();

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>Home Page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await user.type(screen.getByLabelText('Email'), 'qa.head@example.com');
    await user.type(screen.getByLabelText('Password'), 'Correct1!');
    await user.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() => expect(screen.getByText('Home Page')).toBeInTheDocument());
    expect(localStorage.getItem('pharmaqms.accessToken')).toBe('access-token');
  });
});

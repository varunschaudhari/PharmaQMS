import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../features/auth/context/auth-context';
import { signFakeAccessTokenForTest } from '../lib/jwt.test-helpers';
import { PlatformAdminRoute } from './platform-admin-route';

describe('PLT-8 PlatformAdminRoute', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('PLT-8: redirects a signed-in but non-platform-admin user to the home page', async () => {
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ isPlatformAdmin: false }));
    localStorage.setItem('pharmaqms.refreshToken', 'refresh-token');

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/tenants']}>
          <Routes>
            <Route path="/" element={<div>Home Page</div>} />
            <Route
              path="/admin/tenants"
              element={
                <PlatformAdminRoute>
                  <div>Tenants Page</div>
                </PlatformAdminRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Home Page')).toBeInTheDocument());
    expect(screen.queryByText('Tenants Page')).not.toBeInTheDocument();
  });

  it('PLT-8: allows a platform-admin user through', async () => {
    localStorage.setItem('pharmaqms.accessToken', signFakeAccessTokenForTest({ isPlatformAdmin: true }));
    localStorage.setItem('pharmaqms.refreshToken', 'refresh-token');

    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/admin/tenants']}>
          <Routes>
            <Route path="/" element={<div>Home Page</div>} />
            <Route
              path="/admin/tenants"
              element={
                <PlatformAdminRoute>
                  <div>Tenants Page</div>
                </PlatformAdminRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Tenants Page')).toBeInTheDocument());
  });
});

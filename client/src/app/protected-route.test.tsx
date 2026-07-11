import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthProvider } from '../features/auth/context/auth-context';
import { ProtectedRoute } from './protected-route';

describe('PLT-1 ProtectedRoute', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('PLT-1: redirects unauthenticated users to /login', async () => {
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/login" element={<div>Login Page</div>} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div>Secret Content</div>
                </ProtectedRoute>
              }
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Login Page')).toBeInTheDocument());
    expect(screen.queryByText('Secret Content')).not.toBeInTheDocument();
  });
});

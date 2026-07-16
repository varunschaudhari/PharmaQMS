import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersPage } from './users-page';

const { fetchUsers, fetchRoles, fetchDepartments, createUser, updateUser } = vi.hoisted(() => ({
  fetchUsers: vi.fn(),
  fetchRoles: vi.fn(),
  fetchDepartments: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../../../lib/admin-api', () => ({
  fetchUsers,
  fetchRoles,
  fetchDepartments,
  createUser,
  updateUser,
}));

function renderWithQueryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <UsersPage />
    </QueryClientProvider>,
  );
}

function baseUser() {
  return {
    id: 'user-1',
    tenantId: 'tenant-1',
    email: 'olive@example.com',
    fullName: 'Olive Operator',
    roleId: 'role-1',
    departmentId: null,
    isActive: true,
    isPlatformAdmin: false,
    whatsappPhoneNumber: null,
    whatsappOptIn: false,
  };
}

describe('PLT-6-WA UsersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PLT-6-WA: editing the WhatsApp number (on blur) and toggling opt-in both call updateUser with the audited fields', async () => {
    const user = userEvent.setup();
    fetchUsers.mockResolvedValue({ data: [baseUser()], meta: { page: 1, limit: 50, total: 1 } });
    fetchRoles.mockResolvedValue([{ id: 'role-1', name: 'Operator' }]);
    fetchDepartments.mockResolvedValue([]);
    updateUser.mockResolvedValue({ ...baseUser(), whatsappPhoneNumber: '+919876543210' });

    renderWithQueryClient();

    await waitFor(() => expect(screen.getByText('Olive Operator')).toBeInTheDocument());

    const phoneInput = screen.getByLabelText('WhatsApp number for Olive Operator');
    await user.type(phoneInput, '+919876543210');
    await user.tab(); // blur

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith('user-1', { whatsappPhoneNumber: '+919876543210' }),
    );

    await user.click(screen.getByLabelText('WhatsApp opt-in for Olive Operator'));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('user-1', { whatsappOptIn: true }));
  });

  it('PLT-6-WA: an unchanged phone number on blur does not call updateUser', async () => {
    const user = userEvent.setup();
    fetchUsers.mockResolvedValue({
      data: [{ ...baseUser(), whatsappPhoneNumber: '+919876543210' }],
      meta: { page: 1, limit: 50, total: 1 },
    });
    fetchRoles.mockResolvedValue([{ id: 'role-1', name: 'Operator' }]);
    fetchDepartments.mockResolvedValue([]);

    renderWithQueryClient();

    await waitFor(() => expect(screen.getByText('Olive Operator')).toBeInTheDocument());
    const phoneInput = screen.getByLabelText('WhatsApp number for Olive Operator');
    await user.click(phoneInput);
    await user.tab();

    expect(updateUser).not.toHaveBeenCalled();
  });
});

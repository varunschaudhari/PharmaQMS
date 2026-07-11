import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DepartmentsPage } from './departments-page';

const { fetchDepartments, createDepartment } = vi.hoisted(() => ({
  fetchDepartments: vi.fn(),
  createDepartment: vi.fn(),
}));

vi.mock('../../../lib/admin-api', () => ({
  fetchDepartments,
  createDepartment,
  updateDepartment: vi.fn(),
}));

function renderWithQueryClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DepartmentsPage />
    </QueryClientProvider>,
  );
}

describe('PLT-8 DepartmentsPage', () => {
  it('PLT-8: lists departments and creates a new one', async () => {
    const user = userEvent.setup();
    fetchDepartments.mockResolvedValue([{ id: 'dept-1', tenantId: 'tenant-1', name: 'Quality Assurance', code: 'QA', isActive: true }]);
    createDepartment.mockResolvedValue({ id: 'dept-2', tenantId: 'tenant-1', name: 'Production', code: 'PROD', isActive: true });

    renderWithQueryClient();

    await waitFor(() => expect(screen.getByText('Quality Assurance')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Name'), 'Production');
    await user.type(screen.getByLabelText('Code'), 'PROD');
    await user.click(screen.getByRole('button', { name: /add department/i }));

    // TanStack Query's mutationFn is invoked as (variables, context) — match the variables and
    // accept whatever internal context object TanStack passes as the second argument.
    await waitFor(() =>
      expect(createDepartment).toHaveBeenCalledWith({ name: 'Production', code: 'PROD' }, expect.anything()),
    );
  });
});

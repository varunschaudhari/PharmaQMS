import type {
  CreateDepartmentRequest,
  CreateNumberingSchemeRequest,
  CreateTenantRequest,
  CreateUserRequest,
  DepartmentData,
  NumberingSchemeData,
  PaginationMeta,
  RoleSummary,
  TenantData,
  UpdateDepartmentRequest,
  UpdateNumberingSchemeRequest,
  UpdateTenantSettingsRequest,
  UpdateUserRequest,
  UserAdminData,
} from '@pharmaqms/shared';
import { apiClient } from './api-client';

// Tenants (platform-admin only).
export async function fetchTenants(): Promise<TenantData[]> {
  const response = await apiClient.get('/tenants');
  return response.data.data;
}

export async function createTenant(payload: CreateTenantRequest): Promise<TenantData> {
  const response = await apiClient.post('/tenants', payload);
  return response.data.data;
}

export async function updateTenantSettings(tenantId: string, payload: UpdateTenantSettingsRequest): Promise<TenantData> {
  const response = await apiClient.patch(`/tenants/${tenantId}/settings`, payload);
  return response.data.data;
}

// Departments.
export async function fetchDepartments(): Promise<DepartmentData[]> {
  const response = await apiClient.get('/departments');
  return response.data.data;
}

export async function createDepartment(payload: CreateDepartmentRequest): Promise<DepartmentData> {
  const response = await apiClient.post('/departments', payload);
  return response.data.data;
}

export async function updateDepartment(id: string, payload: UpdateDepartmentRequest): Promise<DepartmentData> {
  const response = await apiClient.patch(`/departments/${id}`, payload);
  return response.data.data;
}

// Users + roles.
export interface FetchUsersResult {
  data: UserAdminData[];
  meta: PaginationMeta;
}

export async function fetchUsers(page = 1, limit = 20): Promise<FetchUsersResult> {
  const response = await apiClient.get('/admin/users', { params: { page, limit } });
  return response.data;
}

export async function fetchRoles(): Promise<RoleSummary[]> {
  const response = await apiClient.get('/admin/users/roles');
  return response.data.data;
}

export async function createUser(payload: CreateUserRequest): Promise<UserAdminData> {
  const response = await apiClient.post('/admin/users', payload);
  return response.data.data;
}

export async function updateUser(id: string, payload: UpdateUserRequest): Promise<UserAdminData> {
  const response = await apiClient.patch(`/admin/users/${id}`, payload);
  return response.data.data;
}

// Numbering schemes.
export async function fetchNumberingSchemes(): Promise<NumberingSchemeData[]> {
  const response = await apiClient.get('/numbering/schemes');
  return response.data.data;
}

export async function createNumberingScheme(payload: CreateNumberingSchemeRequest): Promise<NumberingSchemeData> {
  const response = await apiClient.post('/numbering/schemes', payload);
  return response.data.data;
}

export async function updateNumberingScheme(
  id: string,
  payload: UpdateNumberingSchemeRequest,
): Promise<NumberingSchemeData> {
  const response = await apiClient.patch(`/numbering/schemes/${id}`, payload);
  return response.data.data;
}

export async function previewNumber(entityType: string, departmentCode?: string): Promise<string> {
  const response = await apiClient.post('/numbering/generate', { entityType, departmentCode });
  return response.data.data.code;
}

// API request types are always imported from shared, never redefined (CLAUDE.md).
export {
  createTenantRequestSchema,
  updateTenantSettingsRequestSchema,
  createDepartmentRequestSchema,
  updateDepartmentRequestSchema,
  createUserRequestSchema,
  updateUserRequestSchema,
  type CreateTenantRequest,
  type UpdateTenantSettingsRequest,
  type CreateDepartmentRequest,
  type UpdateDepartmentRequest,
  type CreateUserRequest,
  type UpdateUserRequest,
} from '@pharmaqms/shared';

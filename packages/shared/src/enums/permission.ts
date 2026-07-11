// PLT-1: permission matrix — per-module actions, tenant-configurable via Role.permissions (SPEC.md §5.3).
export enum PermissionModule {
  DOCUMENTS = 'documents',
  TRAINING = 'training',
  EQUIPMENT = 'equipment',
  ADMIN = 'admin',
}

export enum PermissionAction {
  VIEW = 'view',
  CREATE = 'create',
  EDIT = 'edit',
  REVIEW = 'review',
  APPROVE = 'approve',
  ADMIN = 'admin',
}

export type PermissionKey = `${PermissionModule}:${PermissionAction}`;

export const ALL_PERMISSION_KEYS: PermissionKey[] = Object.values(PermissionModule).flatMap((permissionModule) =>
  Object.values(PermissionAction).map((action): PermissionKey => `${permissionModule}:${action}`),
);

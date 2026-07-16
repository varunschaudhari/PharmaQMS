// PLT-1: permission matrix — per-module actions, tenant-configurable via Role.permissions (SPEC.md §5.3).
export enum PermissionModule {
  DOCUMENTS = 'documents',
  TRAINING = 'training',
  EQUIPMENT = 'equipment',
  ADMIN = 'admin',
  // QRX-1 (SPEC.md §7.4): rooms are their own master entity with their own CRUD permissions —
  // not folded into EQUIPMENT, since a room isn't equipment (matches DOC/TRN/EQP's own separate
  // PermissionModule precedent).
  ROOMS = 'rooms',
  // QRX-2 (SPEC.md §7.4): material lots are their own master entity — same "own module, own
  // permissions" precedent as ROOMS.
  MATERIALS = 'materials',
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

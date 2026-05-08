import { SetMetadata } from '@nestjs/common';

export type TenantRole = 'owner' | 'admin' | 'superviseur' | 'member' | 'readonly';

/**
 * Hiérarchie : owner > admin > superviseur > member > readonly.
 * Un endpoint @Roles('admin') laisse passer owner ET admin (mais pas superviseur+).
 */
export const ROLE_HIERARCHY: Record<TenantRole, number> = {
  owner: 5,
  admin: 4,
  superviseur: 3,
  member: 2,
  readonly: 1,
};

export const ROLES_KEY = 'matix:required-min-role';

/**
 * Marque un endpoint comme nécessitant AU MINIMUM un certain rôle.
 * Le RolesGuard vérifie que le rôle de l'user (lu depuis tenant_members) est ≥ requis.
 */
export const RequiresRole = (minRole: TenantRole) => SetMetadata(ROLES_KEY, minRole);

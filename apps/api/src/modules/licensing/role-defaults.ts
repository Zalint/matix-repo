import type { TenantRole } from '../../common/auth/roles.decorator';
import type { ModuleAction } from './catalog';

/**
 * Permissions par défaut par rôle (ADR-0006 §"Permissions").
 * Le LicensingGuard consulte ces defaults sauf si une ligne `role_permissions`
 * surcharge pour le tenant (tier Enterprise).
 */
export const ROLE_DEFAULTS_FALLBACK: Record<TenantRole, ModuleAction[]> = {
  owner:       ['read', 'write', 'delete'],
  admin:       ['read', 'write', 'delete'],
  superviseur: ['read', 'write'],
  member:      ['read', 'write'],
  readonly:    ['read'],
};

/**
 * Restrictions ciblées par module : si un module est listé ici pour un rôle,
 * ces actions précisent (et REMPLACENT) le fallback ci-dessus pour CE module.
 *
 * Listes vides `[]` = pas d'accès du tout au module.
 */
export const ROLE_OVERRIDES: Partial<Record<TenantRole, Record<string, ModuleAction[]>>> = {
  member: {
    'finance.accounting.gl':         ['read'],
    'finance.accounting.statements': ['read'],
    'finance.accounting.tax':        ['read'],
    'platform.team':                 [],
    'platform.tenants_admin':        [],
    'platform.api_keys':             [],
    'analytics.reports.builder':     ['read'],
  },
  superviseur: {
    'platform.team':                 ['read'],
    'platform.tenants_admin':        [],
    'platform.api_keys':             ['read'],
    'finance.accounting.gl':         ['read'],
  },
  admin: {
    'platform.tenants_admin':        [],   // super-admin Matix only
  },
};

export function defaultPermissionsFor(
  role: TenantRole,
  moduleCode: string,
): ModuleAction[] {
  const override = ROLE_OVERRIDES[role]?.[moduleCode];
  if (override !== undefined) return override;
  return ROLE_DEFAULTS_FALLBACK[role];
}

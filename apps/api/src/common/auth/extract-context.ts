import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Pool } from 'pg';
import { validate as isUuid } from 'uuid';
import { verifyKeycloakJwt } from './keycloak-jwt';
import type { TenantRole } from './roles.decorator';

export type ResolvedAuth = {
  tenantId: string;
  userId: string;
  email?: string;
  /** Rôle effectif (depuis tenant_members en DB — source de vérité). */
  role: TenantRole;
};

/**
 * Source unique de vérité pour extraire (tenantId, userId, role) d'une requête,
 * quel que soit le mode d'auth.
 *
 * AUTH_MODE = 'dev'      → headers X-Dev-Tenant-Id / X-Dev-User-Id (Phase 0).
 * AUTH_MODE = 'keycloak' → JWT Bearer Keycloak vérifié + lookup tenant_members.
 *
 * Le rôle vient TOUJOURS de tenant_members (pas du JWT) — c'est la DB la source
 * de vérité. Le JWT/realm_access ne sert que pour les rôles plateforme transverses.
 *
 * Le tenantId n'est JAMAIS dérivé d'un param URL/body/query — uniquement
 * du JWT/header de session, pour empêcher un user authentifié de "voler"
 * le contexte d'un autre tenant.
 */
export async function extractAuthContext(req: Request, adminPool: Pool): Promise<ResolvedAuth> {
  const mode = process.env.AUTH_MODE ?? 'dev';

  if (mode === 'dev') {
    return extractDev(req, adminPool);
  }
  if (mode === 'keycloak') {
    return extractKeycloak(req, adminPool);
  }
  throw new UnauthorizedException(`AUTH_MODE inconnu: ${mode}`);
}

async function resolveRole(
  adminPool: Pool,
  tenantId: string,
  userId: string,
  fallback: TenantRole | null,
): Promise<TenantRole> {
  const { rows } = await adminPool.query<{ role: TenantRole }>(
    `SELECT role FROM tenant_members
     WHERE tenant_id = $1 AND user_id = $2 AND deactivated_at IS NULL
     LIMIT 1`,
    [tenantId, userId],
  );
  if (rows.length > 0) return rows[0].role;
  if (fallback) return fallback;
  throw new ForbiddenException('User non membre de ce tenant');
}

// ---------------------------------------------------------------------------
// Mode dev — Phase 0
// ---------------------------------------------------------------------------

async function extractDev(req: Request, adminPool: Pool): Promise<ResolvedAuth> {
  const tenantId = req.header('x-dev-tenant-id');
  const userId = req.header('x-dev-user-id');

  if (!tenantId || !isUuid(tenantId)) {
    throw new UnauthorizedException('tenant_id manquant ou invalide (mode dev)');
  }
  if (!userId || !isUuid(userId)) {
    throw new UnauthorizedException('user_id manquant ou invalide (mode dev)');
  }

  // Mode dev : si l'user n'est pas en tenant_members, on suppose 'owner' (test flexibility).
  // Permet de tester sans devoir insérer manuellement un membre pour chaque dev user_id.
  // L'X-Dev-Role header peut surcharger pour tester les autres rôles.
  const headerRole = req.header('x-dev-role') as TenantRole | undefined;
  const role = headerRole ?? (await resolveRole(adminPool, tenantId, userId, 'owner'));

  return { tenantId, userId, role };
}

// ---------------------------------------------------------------------------
// Mode keycloak — Phase 1+
// ---------------------------------------------------------------------------

async function extractKeycloak(req: Request, adminPool: Pool): Promise<ResolvedAuth> {
  const authHeader = req.header('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedException('Authorization Bearer manquant');
  }
  const token = authHeader.slice('Bearer '.length).trim();

  let claims;
  try {
    claims = await verifyKeycloakJwt(token);
  } catch (e) {
    throw new UnauthorizedException(`JWT invalide: ${(e as Error).message}`);
  }

  const userId = claims.sub;
  const tenantId = claims.tenant_id;
  if (!tenantId || !isUuid(tenantId)) {
    throw new UnauthorizedException('JWT sans claim tenant_id valide');
  }

  // Défense en profondeur : ce user est-il MEMBRE actif de ce tenant ?
  // Et quel est son rôle effectif ?
  const role = await resolveRole(adminPool, tenantId, userId, null);

  return {
    tenantId,
    userId,
    email: claims.email,
    role,
  };
}

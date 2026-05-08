import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Pool } from 'pg';
import { validate as isUuid } from 'uuid';
import { verifyKeycloakJwt } from './keycloak-jwt';

export type ResolvedAuth = {
  tenantId: string;
  userId: string;
  email?: string;
  roles?: string[];
};

/**
 * Source unique de vérité pour extraire (tenantId, userId) d'une requête,
 * quel que soit le mode d'auth.
 *
 * AUTH_MODE = 'dev'      → headers X-Dev-Tenant-Id / X-Dev-User-Id (Phase 0).
 * AUTH_MODE = 'keycloak' → JWT Bearer Keycloak vérifié + lookup tenant_members.
 *
 * Le tenantId n'est JAMAIS dérivé d'un param URL/body/query — uniquement
 * du JWT/header de session, pour empêcher un user authentifié de "voler"
 * le contexte d'un autre tenant.
 *
 * @param adminPool — pool admin (BYPASSRLS) pour vérifier l'appartenance user/tenant
 *                    en mode keycloak. Pas utilisé en mode dev.
 */
export async function extractAuthContext(req: Request, adminPool: Pool): Promise<ResolvedAuth> {
  const mode = process.env.AUTH_MODE ?? 'dev';

  if (mode === 'dev') {
    return extractDev(req);
  }
  if (mode === 'keycloak') {
    return await extractKeycloak(req, adminPool);
  }
  throw new UnauthorizedException(`AUTH_MODE inconnu: ${mode}`);
}

// ---------------------------------------------------------------------------
// Mode dev — Phase 0 only
// ---------------------------------------------------------------------------

function extractDev(req: Request): ResolvedAuth {
  const tenantId = req.header('x-dev-tenant-id');
  const userId = req.header('x-dev-user-id');

  if (!tenantId || !isUuid(tenantId)) {
    throw new UnauthorizedException('tenant_id manquant ou invalide (mode dev)');
  }
  if (!userId || !isUuid(userId)) {
    throw new UnauthorizedException('user_id manquant ou invalide (mode dev)');
  }
  return { tenantId, userId };
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

  // Défense en profondeur : même si le JWT est valide, on vérifie en DB que ce user
  // est BIEN membre de ce tenant. Empêche une claim falsifiée par un Keycloak compromis
  // OU un user qui aurait gardé son token après suppression de son appartenance.
  const { rows } = await adminPool.query<{ ok: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM tenant_members
       WHERE tenant_id = $1 AND user_id = $2
     ) AS ok`,
    [tenantId, userId],
  );
  if (!rows[0]?.ok) {
    throw new ForbiddenException('User non membre de ce tenant');
  }

  return {
    tenantId,
    userId,
    email: claims.email,
    roles: claims.realm_access?.roles,
  };
}

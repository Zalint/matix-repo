import { Injectable, NestMiddleware, UnauthorizedException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Request, Response, NextFunction } from 'express';
import { validate as isUuid } from 'uuid';

/**
 * Pose `tenantId` et `userId` dans le contexte CLS pour le reste de la requête.
 *
 * Phase 0 (dev) : extraction depuis les headers `X-Dev-Tenant-Id` et `X-Dev-User-Id`.
 *                  Permet de tester RLS sans Keycloak.
 * Phase 1+      : extraction depuis JWT Keycloak (claims `tenant_id`, `sub`).
 *
 * IMPORTANT : le tenant_id n'est JAMAIS dérivé d'un param URL, body ou query —
 *             uniquement du JWT/header de session, pour éviter qu'un user authentifié
 *             puisse "voler" le contexte d'un autre tenant.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const devEnabled = process.env.DEV_AUTH_ENABLED === 'true';

    let tenantId: string | undefined;
    let userId: string | undefined;

    if (devEnabled) {
      tenantId = req.header('x-dev-tenant-id');
      userId = req.header('x-dev-user-id');
    } else {
      // TODO Phase 1 : décoder JWT Keycloak ici, extraire claims tenant_id + sub
      throw new UnauthorizedException('Auth non implémentée (Phase 1)');
    }

    if (!tenantId || !isUuid(tenantId)) {
      throw new UnauthorizedException('tenant_id manquant ou invalide');
    }
    if (!userId || !isUuid(userId)) {
      throw new UnauthorizedException('user_id manquant ou invalide');
    }

    this.cls.set('tenantId', tenantId);
    this.cls.set('userId', userId);
    next();
  }
}

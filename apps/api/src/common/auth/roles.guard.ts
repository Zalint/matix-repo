import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { ROLE_HIERARCHY, ROLES_KEY, type TenantRole } from './roles.decorator';

/**
 * Vérifie le rôle de l'utilisateur courant contre le rôle minimum requis par l'endpoint.
 * Le rôle est posé dans le CLS par extractAuthContext (lu depuis tenant_members en DB).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly cls: ClsService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<TenantRole | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true; // pas d'annotation → libre

    const userRole = this.cls.get<TenantRole>('role');
    if (!userRole) {
      throw new ForbiddenException('Rôle utilisateur non résolu');
    }

    const userLevel = ROLE_HIERARCHY[userRole] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[required];

    if (userLevel < requiredLevel) {
      throw new ForbiddenException(
        `Rôle insuffisant : requiert ${required}, vous êtes ${userRole}`,
      );
    }
    return true;
  }
}

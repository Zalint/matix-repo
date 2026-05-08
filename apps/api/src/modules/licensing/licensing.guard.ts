import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import { Pool } from 'pg';
import { ADMIN_PG_POOL } from '../../common/database.module';
import type { TenantRole } from '../../common/auth/roles.decorator';
import { isValidModuleCode, type ModuleAction } from './catalog';
import { defaultPermissionsFor } from './role-defaults';
import {
  REQUIRES_MODULE_KEY,
  type RequiresModuleSpec,
} from './licensing.decorator';

@Injectable()
export class LicensingGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService,
    @Inject(ADMIN_PG_POOL) private readonly pool: Pool,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const spec = this.reflector.getAllAndOverride<RequiresModuleSpec | undefined>(
      REQUIRES_MODULE_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!spec) return true;

    if (!isValidModuleCode(spec.moduleCode)) {
      throw new Error(`@RequiresModule: code inconnu '${spec.moduleCode}' (catalog.ts ?)`);
    }

    const tenantId = this.cls.get<string>('tenantId');
    const role = this.cls.get<TenantRole>('role');
    if (!tenantId || !role) {
      throw new ForbiddenException('Contexte tenant/role manquant');
    }

    // 1. Licensing : module activé pour ce tenant ?
    const lic = await this.pool.query<{ enabled: boolean; expires_at: string | null }>(
      `SELECT enabled, expires_at FROM tenant_licenses
       WHERE tenant_id = $1 AND module_code = $2`,
      [tenantId, spec.moduleCode],
    );
    const license = lic.rows[0];
    const licensed =
      license?.enabled === true &&
      (!license.expires_at || new Date(license.expires_at) > new Date());

    if (!licensed) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          message: `Module '${spec.moduleCode}' non inclus dans votre plan`,
          module: spec.moduleCode,
          error: 'ModuleNotLicensed',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    // 2. Permissions : surcharge custom (Enterprise) ou défaut code
    const customPerms = await this.pool.query<{ actions: string[] }>(
      `SELECT actions FROM role_permissions
       WHERE tenant_id = $1 AND role = $2 AND module_code = $3`,
      [tenantId, role, spec.moduleCode],
    );
    const allowed: ModuleAction[] =
      customPerms.rows.length > 0
        ? (customPerms.rows[0].actions as ModuleAction[])
        : defaultPermissionsFor(role, spec.moduleCode);

    if (!allowed.includes(spec.action)) {
      throw new ForbiddenException(
        `Action '${spec.action}' non autorisée sur '${spec.moduleCode}' pour le rôle '${role}'`,
      );
    }

    return true;
  }
}

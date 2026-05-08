import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsString } from 'class-validator';
import { LicensingService } from './licensing.service';

class AssignPlanDto {
  @IsString() plan_code!: string;
}
class ToggleModuleDto {
  @IsString() module_code!: string;
  @IsBoolean() enabled!: boolean;
}

/**
 * Endpoints "publics" (côté tenant) — visibles par tous les membres actifs.
 * Le tenant_id et le role sont posés par le CLS (extractAuthContext).
 */
@Controller('licensing')
export class LicensingController {
  constructor(private readonly licensing: LicensingService) {}

  /** Catalogue global (i18n) — sert au frontend pour rendre la sidebar / page paramètres. */
  @Get('catalog')
  catalog() {
    return this.licensing.getCatalog();
  }

  /** Liste des plans publiables. */
  @Get('plans')
  plans() {
    return this.licensing.listPlans();
  }

  /** Modules activés pour MON tenant. */
  @Get('me')
  myLicenses() {
    return this.licensing.listMyLicenses();
  }

  /** Modules + actions autorisées pour MOI (rôle + overrides). */
  @Get('me/permissions')
  myPermissions() {
    return this.licensing.getMyEffectivePermissions();
  }
}

/**
 * Endpoints super-admin Matix — gère les licences de N'IMPORTE QUEL tenant.
 * Phase 0 : non protégé. Phase 1 : à protéger par AuthGuard super-admin.
 */
@Controller('admin/licensing')
export class LicensingAdminController {
  constructor(private readonly licensing: LicensingService) {}

  /**
   * Liste les modules activés pour un tenant donné.
   * Note : on utilise ':tenantId/licenses' plutôt que 'tenants/:tenantId' pour
   * éviter une collision routing observée avec NestJS quand un GET et un PATCH
   * partagent le même prefix avec param + suffix.
   */
  @Get(':tenantId/licenses')
  listForTenant(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.licensing.listLicensesForTenant(tenantId);
  }

  /** Assigne un plan (rematérialise les licences). */
  @Patch(':tenantId/plan')
  async assignPlan(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: AssignPlanDto,
  ) {
    await this.licensing.assignPlan(tenantId, dto.plan_code);
    return { ok: true };
  }

  /** Active/désactive un module spécifique (override manual). */
  @Post(':tenantId/modules')
  async toggle(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: ToggleModuleDto) {
    await this.licensing.toggleModule(tenantId, dto.module_code, dto.enabled);
    return { ok: true };
  }
}

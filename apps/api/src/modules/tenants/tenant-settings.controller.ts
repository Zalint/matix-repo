import { Body, Controller, Get, Patch } from '@nestjs/common';
import { IsNumber, IsOptional, Min } from 'class-validator';
import { TenantSettingsService } from './tenant-settings.service';

class UpdateTenantSettingsDto {
  @IsOptional() @IsNumber() @Min(0) default_gros_rebate_xof?: number;
}

/**
 * Settings du tenant courant. Accessible à tout user authentifié du tenant
 * (l'auth interceptor injecte le tenant_id via CLS). Pas de licensing module
 * dédié : les settings sont gratuits et toujours actifs.
 *
 * Pour l'instant on n'expose que default_gros_rebate_xof. Au fur et à mesure
 * d'autres settings transverses arriveront ici (devise affichage, timezone,
 * format dates, etc.).
 */
@Controller('settings/tenant')
export class TenantSettingsController {
  constructor(private readonly svc: TenantSettingsService) {}

  @Get()
  get() {
    return this.svc.getMine();
  }

  @Patch()
  update(@Body() dto: UpdateTenantSettingsDto) {
    return this.svc.updateMine(dto);
  }
}

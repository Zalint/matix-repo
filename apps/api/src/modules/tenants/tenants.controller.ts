import { Body, Controller, Get, Post } from '@nestjs/common';
import { TenantsService } from './tenants.service';

class ProvisionTenantDto {
  slug!: string;
  legal_name!: string;
}

/**
 * Routes admin plateforme. Exclues du TenantContextMiddleware.
 * Phase 1 : à protéger par AuthGuard super-admin (clé API ou JWT super-admin).
 */
@Controller('admin/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  provision(@Body() dto: ProvisionTenantDto) {
    return this.tenants.provision(dto);
  }
}

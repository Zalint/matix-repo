import { Body, Controller, Get, Post, ValidationPipe } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { ProvisionTenantDto } from './dto/provision-tenant.dto';

/**
 * Routes admin plateforme. Exclues du CLS tenant context.
 *
 * ⚠️ Phase 0 : non protégées (dev). Phase 1 : AuthGuard "super-admin Matix"
 * (clé API + IP whitelist OU compte Keycloak admin spécifique).
 */
@Controller('admin/tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get()
  list() {
    return this.tenants.list();
  }

  @Post()
  provision(@Body(new ValidationPipe({ whitelist: true, transform: true })) dto: ProvisionTenantDto) {
    return this.tenants.provision(dto);
  }
}

import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { KeycloakAdminService } from '../../common/keycloak/keycloak-admin.service';

@Module({
  controllers: [TenantsController],
  providers: [TenantsService, KeycloakAdminService],
})
export class TenantsModule {}

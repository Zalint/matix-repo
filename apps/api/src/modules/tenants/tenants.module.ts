import { Module } from '@nestjs/common';
import { TenantSettingsController } from './tenant-settings.controller';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';
import { KeycloakAdminService } from '../../common/keycloak/keycloak-admin.service';

@Module({
  controllers: [TenantsController, TenantSettingsController],
  providers: [TenantsService, KeycloakAdminService, TenantSettingsService],
  exports: [TenantSettingsService],
})
export class TenantsModule {}

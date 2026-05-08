import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  LicensingAdminController,
  LicensingController,
} from './licensing.controller';
import { LicensingService } from './licensing.service';
import { LicensingGuard } from './licensing.guard';

export const MODULE_MANIFEST = {
  name: 'licensing',
  pillar: 'platform' as const,
  tables: ['plans', 'tenant_licenses', 'role_permissions'] as const,
  emitsEvents: [] as const,
  publicFacade: 'LicensingService',
};

/**
 * Global pour que le LicensingGuard soit appliqué à TOUTE l'API
 * (mais uniquement aux endpoints décorés @RequiresModule).
 */
@Global()
@Module({
  controllers: [LicensingController, LicensingAdminController],
  providers: [
    LicensingService,
    {
      provide: APP_GUARD,
      useClass: LicensingGuard,
    },
  ],
  exports: [LicensingService],
})
export class LicensingModule {}

import { Module, UnauthorizedException } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import type { Request } from 'express';
import { validate as isUuid } from 'uuid';

import { DatabaseModule } from './common/database.module';
import { TenantTxInterceptor } from './common/tenant-tx.interceptor';

import { ProductsModule } from './modules/products/products.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [
    /**
     * Le CLS middleware setup() s'exécute DANS le contexte CLS, donc cls.set() y fonctionne.
     * Il joue aussi le rôle d'extraction tenant : équivalent du TenantContextMiddleware
     * mais sans problème d'ordre de mount.
     *
     * Phase 0 dev : extrait depuis header `X-Dev-Tenant-Id`.
     * Phase 1+    : extrait depuis JWT Keycloak (claims `tenant_id`, `sub`).
     *
     * Les routes /admin/* sont laissées sans contexte tenant (l'interceptor le détecte et n'ouvre pas de tx).
     */
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        setup: (cls, req: Request) => {
          // Routes admin : pas de tenant context (la logique admin utilise ADMIN_PG_POOL).
          if (req.url?.startsWith('/admin/') || req.url === '/admin') {
            return;
          }

          const devEnabled = process.env.DEV_AUTH_ENABLED === 'true';
          let tenantId: string | undefined;
          let userId: string | undefined;

          if (devEnabled) {
            tenantId = req.header('x-dev-tenant-id');
            userId = req.header('x-dev-user-id');
          } else {
            // TODO Phase 1 : décoder JWT Keycloak ici
            throw new UnauthorizedException('Auth non implémentée (Phase 1)');
          }

          if (!tenantId || !isUuid(tenantId)) {
            throw new UnauthorizedException('tenant_id manquant ou invalide');
          }
          if (!userId || !isUuid(userId)) {
            throw new UnauthorizedException('user_id manquant ou invalide');
          }

          cls.set('tenantId', tenantId);
          cls.set('userId', userId);
        },
      },
    }),
    DatabaseModule,
    TenantsModule,
    ProductsModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantTxInterceptor,
    },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR, ModuleRef } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';
import type { Request } from 'express';
import type { Pool } from 'pg';

import { ADMIN_PG_POOL, DatabaseModule } from './common/database.module';
import { TenantTxInterceptor } from './common/tenant-tx.interceptor';
import { extractAuthContext } from './common/auth/extract-context';

import { LoggerModule } from './common/logger/logger.module';
import { CustomersModule } from './modules/customers/customers.module';
import { HealthModule } from './modules/health/health.module';
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
    ClsModule.forRootAsync({
      global: true,
      imports: [DatabaseModule],
      inject: [ADMIN_PG_POOL],
      useFactory: (adminPool: Pool) => ({
        middleware: {
          mount: true,
          setup: async (cls, req: Request) => {
            // En NestJS + nestjs-cls, req.url est rebased à '/' par le mount du middleware
            // sur '*'. Toujours utiliser req.originalUrl pour le routing logique.
            const url = req.originalUrl ?? req.url ?? '';
            // Routes admin plateforme : pas de tenant context (utilisent ADMIN_PG_POOL).
            if (url.startsWith('/admin/') || url === '/admin' || url.startsWith('/admin?')) {
              return;
            }
            // Healthcheck routes — pas d'auth requise.
            if (url === '/health' || url === '/healthz' || url === '/readyz') {
              return;
            }

            const auth = await extractAuthContext(req, adminPool);
            cls.set('tenantId', auth.tenantId);
            cls.set('userId', auth.userId);
            cls.set('email', auth.email);
            cls.set('roles', auth.roles);
          },
        },
      }),
    }),
    LoggerModule,
    DatabaseModule,
    HealthModule,
    TenantsModule,
    ProductsModule,
    CustomersModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantTxInterceptor,
    },
  ],
})
export class AppModule {}

import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';

export const APP_PG_POOL = Symbol('APP_PG_POOL');
export const ADMIN_PG_POOL = Symbol('ADMIN_PG_POOL');

/**
 * Deux pools Postgres :
 * - APP_PG_POOL  : utilise matix_app, NON-superuser, soumis à RLS. Pour toutes les requêtes métier.
 * - ADMIN_PG_POOL: utilise matix_admin, BYPASSRLS. Pour migrations, provisioning, jobs cross-tenant uniquement.
 *
 * 99% du code applicatif passe par APP_PG_POOL via le TenantTxInterceptor.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_PG_POOL,
      useFactory: () =>
        new Pool({
          host: process.env.POSTGRES_HOST ?? 'localhost',
          port: Number(process.env.POSTGRES_PORT ?? 5432),
          database: process.env.POSTGRES_DB ?? 'matix',
          user: process.env.POSTGRES_APP_USER ?? 'matix_app',
          password: process.env.POSTGRES_APP_PASSWORD ?? 'matix_app_dev',
          max: 20,
        }),
    },
    {
      provide: ADMIN_PG_POOL,
      useFactory: () =>
        new Pool({
          host: process.env.POSTGRES_HOST ?? 'localhost',
          port: Number(process.env.POSTGRES_PORT ?? 5432),
          database: process.env.POSTGRES_DB ?? 'matix',
          user: process.env.POSTGRES_ADMIN_USER ?? 'matix_admin',
          password: process.env.POSTGRES_ADMIN_PASSWORD ?? 'matix_admin_dev',
          max: 5,
        }),
    },
  ],
  exports: [APP_PG_POOL, ADMIN_PG_POOL],
})
export class DatabaseModule {}

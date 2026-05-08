import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ClsModule } from 'nestjs-cls';

import { DatabaseModule } from './common/database.module';
import { TenantContextMiddleware } from './common/tenant-context.middleware';
import { TenantTxInterceptor } from './common/tenant-tx.interceptor';

import { ProductsModule } from './modules/products/products.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
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
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Pose le tenant_id dans le CLS pour TOUTES les routes métier.
    // Les routes admin (/admin/*) sont exclues — elles n'ont pas de tenant context.
    consumer.apply(TenantContextMiddleware).exclude('admin/(.*)').forRoutes('*');
  }
}

import { Module } from '@nestjs/common';
import { ProductCategoriesController } from './product-categories.controller';
import { ProductCategoriesService } from './product-categories.service';

export const MODULE_MANIFEST = {
  name: 'product-categories',
  pillar: 'commercial' as const,
  tables: ['product_categories'] as const,
  publicFacade: 'ProductCategoriesService',
};

@Module({
  controllers: [ProductCategoriesController],
  providers: [ProductCategoriesService],
  exports: [ProductCategoriesService],
})
export class ProductCategoriesModule {}

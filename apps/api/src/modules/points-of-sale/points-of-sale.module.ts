import { Module } from '@nestjs/common';
import { PointsOfSaleController } from './points-of-sale.controller';
import { PointsOfSaleService } from './points-of-sale.service';

export const MODULE_MANIFEST = {
  name: 'points-of-sale',
  pillar: 'commercial' as const,
  tables: ['points_of_sale'] as const,
  emitsEvents: [] as const,
  publicFacade: 'PointsOfSaleService',  // exporté pour le module Sales (qui valide qu'un PV existe)
};

@Module({
  controllers: [PointsOfSaleController],
  providers: [PointsOfSaleService],
  exports: [PointsOfSaleService],
})
export class PointsOfSaleModule {}

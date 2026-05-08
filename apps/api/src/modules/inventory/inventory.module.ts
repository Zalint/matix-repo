import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

export const MODULE_MANIFEST = {
  name: 'inventory',
  pillar: 'commercial' as const,
  tables: ['stock_levels', 'stock_movements'] as const,
  emitsEvents: [] as const,
  publicFacade: 'InventoryService',  // Sales l'utilisera pour décrémenter le stock
};

@Module({
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}

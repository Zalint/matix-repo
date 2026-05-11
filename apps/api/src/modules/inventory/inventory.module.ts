import { Module } from '@nestjs/common';
import { CuttingsController } from './cuttings.controller';
import { CuttingsService } from './cuttings.service';
import { DailyClosingController } from './daily-closing.controller';
import { DailyClosingService } from './daily-closing.service';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { StockCarryOverScheduler } from './stock-carry-over.scheduler';

export const MODULE_MANIFEST = {
  name: 'inventory',
  pillar: 'commercial' as const,
  tables: [
    'stock_levels',
    'stock_movements',
    'stock_daily_closings',
    'reconciliation_notes',
    'stock_cuttings',
    'stock_cutting_outputs',
  ] as const,
  emitsEvents: [] as const,
  publicFacade: 'InventoryService',  // Sales l'utilisera pour décrémenter le stock
};

@Module({
  controllers: [InventoryController, DailyClosingController, CuttingsController],
  providers: [InventoryService, DailyClosingService, StockCarryOverScheduler, CuttingsService],
  exports: [InventoryService, DailyClosingService, CuttingsService],
})
export class InventoryModule {}

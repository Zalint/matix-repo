import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { InventoryModule } from '../inventory/inventory.module';

export const MODULE_MANIFEST = {
  name: 'sales',
  pillar: 'commercial' as const,
  tables: ['sales', 'sale_items', 'sale_payments', 'document_sequences'] as const,
  emitsEvents: ['SalePostedEvent', 'SaleVoidedEvent'] as const,    // Phase 2 : Reporting s'y abonne
  publicFacade: 'SalesService',
};

@Module({
  imports: [InventoryModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}

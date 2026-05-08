import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateTransferDto, RecordMovementDto } from './dto/record-movement.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  /** Lecture : niveaux de stock (cache). */
  @Get('levels')
  listLevels(
    @Query('product_id') product_id?: string,
    @Query('point_of_sale_id') point_of_sale_id?: string,
  ) {
    return this.inv.listLevels({ product_id, point_of_sale_id });
  }

  /** Lecture : journal des mouvements (append-only). */
  @Get('movements')
  listMovements(
    @Query('product_id') product_id?: string,
    @Query('point_of_sale_id') point_of_sale_id?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.inv.listMovements({
      product_id,
      point_of_sale_id,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /**
   * Enregistre un mouvement (opening stock, ajustement, retour…).
   * Les ventes ne passent PAS par ici — Sales utilise InventoryService directement.
   */
  @Post('movements')
  recordMovement(@Body() dto: RecordMovementDto) {
    return this.inv.recordMovement(dto);
  }

  /** Transfert atomique entre deux PV. */
  @Post('transfers')
  recordTransfer(@Body() dto: CreateTransferDto) {
    return this.inv.recordTransfer(dto);
  }
}

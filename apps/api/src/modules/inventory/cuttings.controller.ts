import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { RequiresModule } from '../licensing/licensing.decorator';
import { CuttingsService } from './cuttings.service';
import { CreateCuttingDto } from './dto/cutting.dto';

/**
 * Endpoints découpes (cuttings). Gardés derrière operations.inventory.movements
 * — une découpe est conceptuellement une famille de mouvements de stock, on
 * réutilise le même module licensing.
 */
@Controller('inventory/cuttings')
export class CuttingsController {
  constructor(private readonly svc: CuttingsService) {}

  /**
   * Liste les découpes filtrables par date / PV / produit source.
   * Pagination basique limit/offset (max 500).
   */
  @Get()
  @RequiresModule('operations.inventory.movements', 'read')
  list(
    @Query('date') date?: string,
    @Query('point_of_sale_id') point_of_sale_id?: string,
    @Query('source_product_id') source_product_id?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.svc.list({
      date,
      point_of_sale_id,
      source_product_id,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Détail d'une découpe (header + outputs). */
  @Get(':id')
  @RequiresModule('operations.inventory.movements', 'read')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getById(id);
  }

  /**
   * Crée une découpe transactionnelle :
   *   - 1 ligne stock_cuttings + N lignes stock_cutting_outputs
   *   - 1 mouvement cutting_out sur la source + N mouvements cutting_in
   *
   * Calcule la chute et le pourcentage. Renvoie le détail complet.
   */
  @Post()
  @RequiresModule('operations.inventory.movements', 'write')
  create(@Body() dto: CreateCuttingDto) {
    return this.svc.create(dto);
  }

  /**
   * Statistiques de rendement par produit source sur une fenêtre.
   * Renvoie : nb découpes, total source, total sorties, chute totale, rendement %.
   */
  @Get('stats/yield')
  @RequiresModule('operations.inventory.movements', 'read')
  yieldStats(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('point_of_sale_id') point_of_sale_id?: string,
  ) {
    return this.svc.yieldStats({ from, to, point_of_sale_id });
  }
}

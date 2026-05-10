import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { RequiresModule } from '../licensing/licensing.decorator';
import { DailyClosingService } from './daily-closing.service';
import {
  RecomputeAutoDto,
  SetDailyClosingDto,
  SetReconciliationNoteDto,
} from './dto/daily-closing.dto';

/**
 * Endpoints "stock soir" + "notes de reconciliation".
 *
 * Le module operations.inventory.movements gere la lecture/ecriture des
 * mouvements unitaires. Ce controller ajoute la couche "vue quotidienne par
 * PV" + saisie manuelle du stock soir + recalcul auto.
 *
 * Toutes les routes sont gardees par RequiresModule sur
 * 'operations.inventory.movements'. Les routes de notes utilisent
 * 'commercial.sales.reconciliation' (Phase B).
 */
@Controller('inventory/daily-closing')
export class DailyClosingController {
  constructor(private readonly svc: DailyClosingService) {}

  /** Vue quotidienne : 1 ligne par (produit, pos) avec figures + closing eventuel. */
  @Get()
  @RequiresModule('operations.inventory.movements', 'read')
  list(
    @Query('date') date: string,
    @Query('point_of_sale_id') posId?: string,
  ) {
    return this.svc.getDailyView(date, posId);
  }

  /** Saisie manuelle d'un stock soir (force source='manual'). */
  @Put()
  @RequiresModule('operations.inventory.movements', 'write')
  setManual(@Body() dto: SetDailyClosingDto) {
    return this.svc.setManual(
      dto.closing_date,
      dto.point_of_sale_id,
      dto.product_id,
      dto.quantity,
    );
  }

  /** Recalcule les produits en mode 'automatique' pour un (date, pos?). */
  @Post('recompute-auto')
  @RequiresModule('operations.inventory.movements', 'write')
  recompute(@Body() dto: RecomputeAutoDto) {
    return this.svc.recomputeAuto(dto.closing_date, dto.point_of_sale_id);
  }

  // ---------------------------------------------------------------------------
  // Notes de reconciliation (Phase B : 1 note libre par (date, pos))
  // ---------------------------------------------------------------------------

  @Get('notes')
  @RequiresModule('commercial.sales.reconciliation', 'read')
  getNote(
    @Query('date') noteDate: string,
    @Query('point_of_sale_id') posId: string,
  ) {
    return this.svc.getNote(noteDate, posId);
  }

  @Put('notes')
  @RequiresModule('commercial.sales.reconciliation', 'write')
  setNote(@Body() dto: SetReconciliationNoteDto) {
    return this.svc.setNote(dto.note_date, dto.point_of_sale_id, dto.body ?? '');
  }
}

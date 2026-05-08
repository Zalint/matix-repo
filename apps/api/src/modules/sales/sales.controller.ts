import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { SalesService, SaleStatus } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';
import { RequiresModule } from '../licensing/licensing.decorator';

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  @RequiresModule('commercial.sales.pos', 'read')
  list(
    @Query('status') status?: SaleStatus,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.sales.list({
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Lignes de vente flat — utilisée par le mode Standard. */
  @Get('lines')
  @RequiresModule('commercial.sales.pos', 'read')
  listLines(
    @Query('date') date?: string,
    @Query('point_of_sale_id') point_of_sale_id?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.sales.listLines({
      date,
      point_of_sale_id,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  /** Stats journalières pour le bandeau "Résumé du jour" du POS. */
  @Get('daily-stats')
  @RequiresModule('commercial.sales.pos', 'read')
  dailyStats(
    @Query('date') date?: string,
    @Query('point_of_sale_id') point_of_sale_id?: string,
  ) {
    const today = new Date().toISOString().slice(0, 10);
    return this.sales.getDailyStats({ date: date ?? today, point_of_sale_id });
  }

  @Get(':id')
  @RequiresModule('commercial.sales.pos', 'read')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getById(id);
  }

  @Post()
  @RequiresModule('commercial.sales.pos', 'write')
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  @Post(':id/post')
  @HttpCode(200)
  @RequiresModule('commercial.sales.pos', 'write')
  post(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.post(id);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequiresModule('commercial.sales.pos', 'delete')
  voidSale(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSaleDto) {
    return this.sales.void(id, dto.reason);
  }
}

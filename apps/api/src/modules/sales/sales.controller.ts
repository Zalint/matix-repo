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

@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
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

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.getById(id);
  }

  @Post()
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  @Post(':id/post')
  @HttpCode(200)
  post(@Param('id', ParseUUIDPipe) id: string) {
    return this.sales.post(id);
  }

  @Post(':id/void')
  @HttpCode(200)
  voidSale(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidSaleDto) {
    return this.sales.void(id, dto.reason);
  }
}

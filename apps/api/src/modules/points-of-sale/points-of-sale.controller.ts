import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PointsOfSaleService } from './points-of-sale.service';
import { CreatePointOfSaleDto } from './dto/create-pos.dto';
import { UpdatePointOfSaleDto } from './dto/update-pos.dto';

@Controller('points-of-sale')
export class PointsOfSaleController {
  constructor(private readonly pos: PointsOfSaleService) {}

  @Get()
  list(@Query('active_only') active_only?: string) {
    return this.pos.list({ active_only: active_only === 'true' });
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.pos.getById(id);
  }

  @Post()
  create(@Body() dto: CreatePointOfSaleDto) {
    return this.pos.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePointOfSaleDto) {
    return this.pos.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.pos.softDelete(id);
  }
}

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
import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';
import { ProductsService, type StockMode } from './products.service';

class CreateProductDto {
  @IsString() sku!: string;
  @IsString() name!: string;
  @IsNumber() @Min(0) unit_price!: number;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) unit_price_gros?: number | null;
  @IsOptional() @IsUUID() category_id?: string;
}

class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) unit_price?: number;
  // unit_price_gros peut être null pour retirer le tarif gros
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) unit_price_gros?: number | null;
  // category_id peut être null pour retirer la catégorie
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() category_id?: string | null;
}

class SetStockModeDto {
  @IsIn(['manuel', 'automatique']) mode!: StockMode;
}

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Query('category_id') category_id?: string) {
    return this.products.list({ category_id });
  }

  @Get(':id')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.getById(id);
  }

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  /** Bascule le mode de gestion du stock soir : manuel <-> automatique. */
  @Patch(':id/stock-mode')
  setStockMode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetStockModeDto,
  ) {
    return this.products.setStockMode(id, dto.mode);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.products.softDelete(id);
  }
}

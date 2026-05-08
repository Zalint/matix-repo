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
import { IsNumber, IsOptional, IsString, IsUUID, Min, ValidateIf } from 'class-validator';
import { ProductsService } from './products.service';

class CreateProductDto {
  @IsString() sku!: string;
  @IsString() name!: string;
  @IsNumber() @Min(0) unit_price!: number;
  @IsOptional() @IsUUID() category_id?: string;
}

class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() @Min(0) unit_price?: number;
  // category_id peut être null pour retirer la catégorie
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() category_id?: string | null;
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

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.products.softDelete(id);
  }
}

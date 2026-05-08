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
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { ProductCategoriesService } from './product-categories.service';
import { RequiresModule } from '../licensing/licensing.decorator';

class CreateCategoryDto {
  @IsString() @MaxLength(50) code!: string;
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(50) family?: string;
  @IsOptional() @IsInt() @Min(0) display_order?: number;
}

class UpdateCategoryDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(50) family?: string;
  @IsOptional() @IsInt() @Min(0) display_order?: number;
  @IsOptional() @IsBoolean() is_active?: boolean;
}

@Controller('product-categories')
export class ProductCategoriesController {
  constructor(private readonly svc: ProductCategoriesService) {}

  @Get()
  @RequiresModule('commercial.crm.customers', 'read') // attaché au pillar commercial — pas de licence dédiée Phase 1
  list(@Query('active_only') activeOnly?: string) {
    return this.svc.list({ activeOnly: activeOnly === 'true' });
  }

  @Get(':id')
  @RequiresModule('commercial.crm.customers', 'read')
  getOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getById(id);
  }

  @Post()
  @RequiresModule('commercial.crm.customers', 'write')
  create(@Body() dto: CreateCategoryDto) {
    return this.svc.create(dto);
  }

  @Patch(':id')
  @RequiresModule('commercial.crm.customers', 'write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequiresModule('commercial.crm.customers', 'delete')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.svc.softDelete(id);
  }
}
